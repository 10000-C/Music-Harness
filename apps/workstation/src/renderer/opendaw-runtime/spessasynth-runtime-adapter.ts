import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import type { MIDIController } from 'spessasynth_core';
import type {
  PlaybackCompilation,
  Tick,
  TickRange,
  TrackId,
} from '../b-contracts/index.js';
import type { PlaybackRuntimeEnginePort } from './playback-runtime.js';
import type { Unsubscribe } from './types.js';

export interface SpessaSynthSnapshot {
  readonly compilation: PlaybackCompilation;
  readonly midiBuffer: ArrayBuffer;
  readonly channels: ReadonlyMap<TrackId, number>;
}

export interface SpessaSynthRuntimeAdapterOptions {
  readonly processorUrl: string;
  readonly soundFontBuffer: ArrayBuffer;
  readonly audioContext?: AudioContext;
  readonly output?: AudioNode;
}

const copyBuffer = (buffer: ArrayBufferLike): ArrayBuffer =>
  Uint8Array.from(new Uint8Array(buffer)).buffer;

export class SpessaSynthRuntimeAdapter implements PlaybackRuntimeEnginePort<SpessaSynthSnapshot> {
  readonly #options: SpessaSynthRuntimeAdapterOptions;
  readonly #context: AudioContext;
  readonly #ownsContext: boolean;
  readonly #channels = new Map<TrackId, number>();
  readonly #mutedTrackIds = new Set<TrackId>();
  readonly #soloTrackIds = new Set<TrackId>();
  readonly #listeners = new Set<(tick: Tick) => void>();
  #synth: WorkletSynthesizer | null = null;
  #sequencer: Sequencer | null = null;
  #timer: number | null = null;
  #loopRange: TickRange | null = null;
  #activeCompilation: PlaybackCompilation | null = null;
  #initialization: Promise<void> | null = null;
  #disposed = false;

  constructor(options: SpessaSynthRuntimeAdapterOptions) {
    this.#options = options;
    this.#context =
      options.audioContext ?? new AudioContext({ latencyHint: 'interactive' });
    this.#ownsContext = options.audioContext === undefined;
  }

  async buildSnapshot(
    compilation: PlaybackCompilation,
    signal: AbortSignal,
  ): Promise<SpessaSynthSnapshot> {
    this.#assertLive();
    signal.throwIfAborted();
    const channels = new Map<TrackId, number>();
    for (const track of compilation.midiDocument.tracks) {
      if (track.channel < 0 || track.channel > 15)
        throw new Error('Invalid MIDI channel.');
      channels.set(track.trackId, track.channel);
    }
    await Promise.resolve();
    signal.throwIfAborted();
    return {
      compilation,
      midiBuffer: Uint8Array.from(compilation.midiDocument.fileBytes).buffer,
      channels,
    };
  }

  async loadSnapshot(snapshot: SpessaSynthSnapshot): Promise<void> {
    await this.#ensureEngine();
    const seq = this.#sequencer;
    if (seq === null) throw new Error('Sequencer unavailable.');
    seq.pause();
    seq.loadNewSongList([
      { binary: copyBuffer(snapshot.midiBuffer), fileName: 'playback.mid' },
    ]);
    await seq.getMIDI();
    this.#assertLive();
    this.#channels.clear();
    for (const [trackId, channel] of snapshot.channels)
      this.#channels.set(trackId, channel);
    this.#activeCompilation = snapshot.compilation;
    seq.currentTime = 0;
    this.#applyEffectiveMutes();
  }

  async play(): Promise<void> {
    await this.#ensureEngine();
    await this.#context.resume();
    this.#sequencer?.play();
  }

  async pause(): Promise<void> {
    this.#assertLive();
    this.#sequencer?.pause();
    await Promise.resolve();
  }
  async stop(): Promise<void> {
    this.#assertLive();
    this.#sequencer?.pause();
    this.#synth?.stopAll(true);
    if (this.#sequencer) this.#sequencer.currentTime = 0;
    await Promise.resolve();
  }
  async seek(tick: Tick): Promise<void> {
    this.#assertLive();
    if (this.#sequencer)
      this.#sequencer.currentTime = this.#secondsAtTick(tick);
    await Promise.resolve();
  }
  async setLoop(range: TickRange | null): Promise<void> {
    this.#assertLive();
    this.#loopRange = range;
    if (this.#sequencer) {
      if (
        range !== null &&
        this.#tickAtSeconds(this.#sequencer.currentTime) >= range.endTick
      )
        this.#sequencer.currentTime = this.#secondsAtTick(range.startTick);
    }
    await Promise.resolve();
  }

  async setMute(trackId: TrackId, muted: boolean): Promise<void> {
    this.#assertLive();
    this.#channel(trackId);
    if (muted) this.#mutedTrackIds.add(trackId);
    else this.#mutedTrackIds.delete(trackId);
    this.#applyEffectiveMutes();
    await Promise.resolve();
  }

  async setSolo(trackId: TrackId, solo: boolean): Promise<void> {
    this.#assertLive();
    this.#channel(trackId);
    if (solo) this.#soloTrackIds.add(trackId);
    else this.#soloTrackIds.delete(trackId);
    this.#applyEffectiveMutes();
    await Promise.resolve();
  }

  setProgram(trackId: TrackId, program: number): void {
    const channel = this.#channel(trackId);
    this.#synth?.midiChannels[channel]?.setSystemParameter('presetLock', false);
    this.#synth?.programChange(channel, program);
    this.#synth?.midiChannels[channel]?.setSystemParameter('presetLock', true);
  }

  setMix(trackId: TrackId, gain: number, pan: number): void {
    const channel = this.#channel(trackId);
    this.#synth?.midiChannels[channel]?.setSystemParameter('gain', gain);
    this.#synth?.midiChannels[channel]?.setSystemParameter('pan', pan);
  }

  setController(trackId: TrackId, controller: number, value: number): void {
    this.#synth?.controllerChange(
      this.#channel(trackId),
      controller as MIDIController,
      value,
    );
  }

  observePosition(listener: (tick: Tick) => void): Unsubscribe {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    if (this.#timer === null)
      this.#timer = window.setInterval(() => {
        if (this.#disposed || this.#sequencer === null) return;
        if (
          this.#loopRange !== null &&
          this.#tickAtSeconds(this.#sequencer.currentTime) >=
            this.#loopRange.endTick
        ) {
          this.#sequencer.currentTime = this.#secondsAtTick(
            this.#loopRange.startTick,
          );
        }
        for (const callback of [...this.#listeners])
          callback(this.#tickAtSeconds(this.#sequencer.currentTime));
      }, 50);
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0 && this.#timer !== null) {
        window.clearInterval(this.#timer);
        this.#timer = null;
      }
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== null) window.clearInterval(this.#timer);
    this.#timer = null;
    this.#listeners.clear();
    this.#sequencer?.pause();
    this.#synth?.stopAll(true);
    this.#synth?.destroy();
    this.#sequencer = null;
    this.#synth = null;
    this.#activeCompilation = null;
    const initialization = this.#initialization;
    if (initialization !== null) await Promise.allSettled([initialization]);
    if (this.#ownsContext && this.#context.state !== 'closed')
      await this.#context.close();
  }

  #channel(trackId: TrackId): number {
    this.#assertLive();
    const channel = this.#channels.get(trackId);
    if (channel === undefined)
      throw new Error(`Unknown playback track ${trackId}.`);
    return channel;
  }

  async #ensureEngine(): Promise<void> {
    this.#assertLive();
    if (this.#synth !== null) return;
    if (this.#initialization === null)
      this.#initialization = this.#initialize().finally(() => {
        this.#initialization = null;
      });
    await this.#initialization;
  }

  async #initialize(): Promise<void> {
    let synth: WorkletSynthesizer | null = null;
    try {
      await this.#context.audioWorklet.addModule(this.#options.processorUrl);
      this.#assertLive();
      synth = new WorkletSynthesizer(this.#context, {
        eventsEnabled: true,
        oneOutput: false,
      });
      await synth.soundBankManager.addSoundBank(
        copyBuffer(this.#options.soundFontBuffer),
        'workstation',
      );
      await synth.isReady;
      this.#assertLive();
      synth.connect(this.#options.output ?? this.#context.destination);
      this.#synth = synth;
      this.#sequencer = new Sequencer(synth, { skipToFirstNoteOn: false });
    } catch (error) {
      synth?.stopAll(true);
      synth?.destroy();
      if (!this.#disposed) {
        this.#disposed = true;
        if (this.#timer !== null) window.clearInterval(this.#timer);
        this.#timer = null;
        this.#listeners.clear();
        if (this.#ownsContext && this.#context.state !== 'closed')
          await this.#context.close();
      }
      throw error;
    }
  }

  #applyEffectiveMutes(): void {
    const hasSolo = this.#soloTrackIds.size > 0;
    for (const [trackId, channel] of this.#channels) {
      const muted =
        this.#mutedTrackIds.has(trackId) ||
        (hasSolo && !this.#soloTrackIds.has(trackId));
      this.#synth?.midiChannels[channel]?.setSystemParameter('isMuted', muted);
    }
  }

  #secondsAtTick(targetTick: Tick): number {
    const compilation = this.#activeCompilation;
    if (compilation === null) return 0;
    const tempos = [...compilation.tempoMap].sort(
      (left, right) => left.tick - right.tick,
    );
    let seconds = 0;
    let cursor = 0;
    const initialTempo = tempos.at(0);
    let bpm = initialTempo?.tick === 0 ? initialTempo.bpm : 120;
    for (const tempo of tempos) {
      if (tempo.tick <= cursor) {
        bpm = tempo.bpm;
        continue;
      }
      if (tempo.tick >= targetTick) break;
      seconds +=
        ((tempo.tick - cursor) * 60) / (bpm * compilation.midiDocument.ppq);
      cursor = tempo.tick;
      bpm = tempo.bpm;
    }
    return (
      seconds +
      ((targetTick - cursor) * 60) / (bpm * compilation.midiDocument.ppq)
    );
  }

  #tickAtSeconds(targetSeconds: number): Tick {
    const compilation = this.#activeCompilation;
    if (compilation === null) return 0 as Tick;
    const tempos = [...compilation.tempoMap].sort(
      (left, right) => left.tick - right.tick,
    );
    let seconds = 0;
    let cursor = 0;
    const initialTempo = tempos.at(0);
    let bpm = initialTempo?.tick === 0 ? initialTempo.bpm : 120;
    for (const tempo of tempos) {
      if (tempo.tick <= cursor) {
        bpm = tempo.bpm;
        continue;
      }
      const segmentSeconds =
        ((tempo.tick - cursor) * 60) / (bpm * compilation.midiDocument.ppq);
      if (seconds + segmentSeconds >= targetSeconds) break;
      seconds += segmentSeconds;
      cursor = tempo.tick;
      bpm = tempo.bpm;
    }
    return Math.max(
      0,
      Math.round(
        cursor +
          ((targetSeconds - seconds) * bpm * compilation.midiDocument.ppq) / 60,
      ),
    ) as Tick;
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('SpessaSynth adapter is disposed.');
  }
}
