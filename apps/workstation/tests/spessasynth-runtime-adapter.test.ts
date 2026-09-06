import {
  TRACK_IDS,
  type CandidateId,
  type PlaybackCompilation,
  type Tick,
} from '../src/renderer/b-contracts/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalizeExternalAbc,
  compileComposition,
} from '../src/core/composition/index.js';

const mock = vi.hoisted(() => ({
  synths: [] as unknown[],
  sequencers: [] as unknown[],
  rejectSoundBank: false,
}));

interface SynthState {
  readonly midiChannels: readonly {
    readonly parameters: Map<string, boolean | number>;
  }[];
  readonly programChanges: [number, number][];
  readonly controllerChanges: [number, number, number][];
  readonly connected: AudioNode[];
  readonly destroyed: boolean;
}

interface SequencerState {
  currentTime: number;
}

vi.mock('spessasynth_lib', () => {
  class MockChannel {
    readonly parameters = new Map<string, boolean | number>();

    setSystemParameter(name: string, value: boolean | number): void {
      this.parameters.set(name, value);
    }
  }

  class WorkletSynthesizer {
    readonly midiChannels = Array.from({ length: 16 }, () => new MockChannel());
    readonly programChanges: [number, number][] = [];
    readonly controllerChanges: [number, number, number][] = [];
    readonly connected: AudioNode[] = [];
    readonly isReady = Promise.resolve();
    readonly soundBankManager = {
      addSoundBank: vi.fn(async () => {
        if (mock.rejectSoundBank) throw new Error('bad soundfont');
      }),
    };
    destroyed = false;

    constructor() {
      mock.synths.push(this);
    }

    connect(output: AudioNode): void {
      this.connected.push(output);
    }

    programChange(channel: number, program: number): void {
      this.programChanges.push([channel, program]);
    }

    controllerChange(channel: number, controller: number, value: number): void {
      this.controllerChanges.push([channel, controller, value]);
    }

    stopAll(): void {}

    destroy(): void {
      this.destroyed = true;
    }
  }

  class Sequencer {
    currentTime = 0;
    playing = false;
    readonly loaded: ArrayBuffer[] = [];

    constructor() {
      mock.sequencers.push(this);
    }

    loadNewSongList(songs: readonly { binary: ArrayBuffer }[]): void {
      const song = songs[0];
      if (song !== undefined) this.loaded.push(song.binary);
    }

    async getMIDI(): Promise<void> {}

    play(): void {
      this.playing = true;
    }

    pause(): void {
      this.playing = false;
    }
  }

  return { Sequencer, WorkletSynthesizer };
});

import {
  SpessaSynthRuntimeAdapter,
  type SpessaSynthSnapshot,
} from '../src/renderer/opendaw-runtime/spessasynth-runtime-adapter.js';
import { createPlaybackRuntime } from '../src/renderer/opendaw-runtime/playback-runtime.js';

const tick = (value: number): Tick => value as Tick;

class MockAudioContext {
  state: AudioContextState = 'suspended';
  readonly destination = { kind: 'destination' } as unknown as AudioNode;
  readonly audioWorklet = {
    addModule: vi.fn(async (): Promise<void> => undefined),
  };
  readonly close = vi.fn(async () => {
    this.state = 'closed';
  });
  readonly resume = vi.fn(async () => {
    this.state = 'running';
  });
}

const compilation = (
  channels: readonly number[] = [9, 0, 1, 2, 3, 4],
): PlaybackCompilation => {
  const abc = `X:1
T:Adapter fixture
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map((trackId) => `[V:${trackId}] C4 |`).join('\n')}
`;
  const playback = compileComposition(canonicalizeExternalAbc(abc)).playback;
  return {
    ...playback,
    tempoMap: [
      { tick: tick(0), bpm: 120 },
      { tick: tick(960), bpm: 60 },
    ],
    midiDocument: {
      ...playback.midiDocument,
      tracks: playback.midiDocument.tracks.map((track, index) => ({
        ...track,
        channel: channels[index] ?? index,
      })),
    },
  };
};

const createAdapter = (
  context: MockAudioContext = new MockAudioContext(),
): SpessaSynthRuntimeAdapter =>
  new SpessaSynthRuntimeAdapter({
    processorUrl: 'processor.js',
    soundFontBuffer: new Uint8Array([1, 2, 3]).buffer,
    audioContext: context as unknown as AudioContext,
  });

const build = async (
  adapter: SpessaSynthRuntimeAdapter,
  input: PlaybackCompilation,
): Promise<SpessaSynthSnapshot> =>
  adapter.buildSnapshot(input, new AbortController().signal);

const synthAt = (index: number): SynthState | undefined =>
  mock.synths[index] as SynthState | undefined;

const sequencerAt = (index: number): SequencerState | undefined =>
  mock.sequencers[index] as SequencerState | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  mock.synths.length = 0;
  mock.sequencers.length = 0;
  mock.rejectSoundBank = false;
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SpessaSynthRuntimeAdapter', () => {
  it('keeps track/channel routing inside each snapshot and isolates track controls', async () => {
    const context = new MockAudioContext();
    const adapter = createAdapter(context);
    const current = await build(adapter, compilation([5, 2, 8, 3, 11, 1]));
    await build(adapter, compilation([12, 13, 14, 15, 7, 6]));

    await adapter.loadSnapshot(current);
    adapter.setProgram('track.drums', 17);
    adapter.setMix('track.bass', 0.4, -0.25);
    adapter.setController('track.keys', 74, 81);

    const synth = synthAt(0);
    expect(synth?.connected).toEqual([context.destination]);
    expect(synth?.programChanges).toEqual([[5, 17]]);
    expect(synth?.midiChannels[2]?.parameters.get('gain')).toBe(0.4);
    expect(synth?.midiChannels[2]?.parameters.get('pan')).toBe(-0.25);
    expect(synth?.controllerChanges).toEqual([[3, 74, 81]]);
    await adapter.dispose();
  });

  it('composes mute and multiple solo states without cross-track resets', async () => {
    const adapter = createAdapter();
    await adapter.loadSnapshot(await build(adapter, compilation()));

    await adapter.setMute('track.drums', true);
    await adapter.setSolo('track.keys', true);
    await adapter.setSolo('track.bass', true);
    await adapter.setSolo('track.keys', false);

    const synth = synthAt(0);
    expect(synth?.midiChannels[9]?.parameters.get('isMuted')).toBe(true);
    expect(synth?.midiChannels[0]?.parameters.get('isMuted')).toBe(false);
    expect(synth?.midiChannels[1]?.parameters.get('isMuted')).toBe(true);

    await adapter.setSolo('track.bass', false);
    expect(synth?.midiChannels[9]?.parameters.get('isMuted')).toBe(true);
    expect(synth?.midiChannels[1]?.parameters.get('isMuted')).toBe(false);
    await adapter.dispose();
  });

  it('converts Tick and seconds across tempo changes for seek, loop, and observation', async () => {
    const adapter = createAdapter();
    await adapter.loadSnapshot(await build(adapter, compilation()));
    const sequencer = sequencerAt(0);

    await adapter.seek(tick(1_920));
    expect(sequencer?.currentTime).toBeCloseTo(1.5);

    const positions: Tick[] = [];
    const unsubscribe = adapter.observePosition((position) => {
      positions.push(position);
    });
    if (sequencer !== undefined) sequencer.currentTime = 1.25;
    await vi.advanceTimersByTimeAsync(50);
    expect(positions).toEqual([tick(1_680)]);

    await adapter.setLoop({ startTick: tick(960), endTick: tick(1_920) });
    if (sequencer !== undefined) sequencer.currentTime = 1.5;
    await vi.advanceTimersByTimeAsync(50);
    expect(sequencer?.currentTime).toBeCloseTo(0.5);
    expect(positions.at(-1)).toBe(tick(960));
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    await adapter.dispose();
  });

  it('aborts a stale build before it can affect the loaded snapshot', async () => {
    const adapter = createAdapter();
    const controller = new AbortController();
    const stale = adapter.buildSnapshot(compilation(), controller.signal);
    controller.abort();
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });

    const latest = await build(adapter, compilation([4, 3, 2, 1, 0, 9]));
    await adapter.loadSnapshot(latest);
    adapter.setProgram('track.drums', 9);
    expect(synthAt(0)?.programChanges).toEqual([[4, 9]]);
    await adapter.dispose();
  });

  it('serializes Current/Candidate activation through initialization and leaves only Candidate effective', async () => {
    const context = new MockAudioContext();
    let releaseModule = (): void => undefined;
    let signalModuleStarted = (): void => undefined;
    const moduleStarted = new Promise<void>((resolve) => {
      signalModuleStarted = resolve;
    });
    context.audioWorklet.addModule.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          signalModuleStarted();
          releaseModule = resolve;
        }),
    );
    const adapter = createAdapter(context);
    const runtime = createPlaybackRuntime(adapter);
    const current = { kind: 'current', revision: 'current.fast' } as const;
    const candidate = {
      kind: 'candidate',
      revision: 'candidate.fast',
      candidateId: 'candidate.fast' as CandidateId,
    } as const;
    await runtime.syncSource(current, compilation([5, 2, 8, 3, 11, 1]));
    await runtime.syncSource(candidate, compilation([12, 13, 14, 15, 7, 6]));

    const activateCurrent = runtime.activateSource(current);
    const activateCandidate = runtime.activateSource(candidate);
    await moduleStarted;
    releaseModule();
    await expect(activateCurrent).resolves.toEqual({ status: 'applied' });
    await expect(activateCandidate).resolves.toEqual({ status: 'applied' });

    expect(runtime.getSnapshot().activeSource).toEqual(candidate);
    adapter.setProgram('track.drums', 23);
    expect(synthAt(0)?.programChanges).toEqual([[12, 23]]);
    await runtime.dispose();
  });

  it('dispose joins in-flight initialization and prevents late engine or callbacks', async () => {
    const context = new MockAudioContext();
    let releaseModule = (): void => undefined;
    context.audioWorklet.addModule.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseModule = resolve;
        }),
    );
    const adapter = createAdapter(context);
    const listener = vi.fn();
    adapter.observePosition(listener);
    const loading = adapter.loadSnapshot(await build(adapter, compilation()));
    await Promise.resolve();

    const disposal = adapter.dispose();
    releaseModule();
    await expect(loading).rejects.toThrow('disposed');
    await disposal;
    await vi.advanceTimersByTimeAsync(100);

    expect(mock.synths).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    await expect(adapter.play()).rejects.toThrow('disposed');
    expect(() => {
      adapter.setProgram('track.drums', 1);
    }).toThrow('disposed');
  });

  it('owns and closes its context, destroys the partial synth, and removes listeners after init failure', async () => {
    const contexts: MockAudioContext[] = [];
    vi.stubGlobal(
      'AudioContext',
      class extends MockAudioContext {
        constructor() {
          super();
          contexts.push(this);
        }
      },
    );
    mock.rejectSoundBank = true;
    const adapter = new SpessaSynthRuntimeAdapter({
      processorUrl: 'processor.js',
      soundFontBuffer: new Uint8Array([1]).buffer,
    });
    const listener = vi.fn();
    adapter.observePosition(listener);

    await expect(
      adapter.loadSnapshot(await build(adapter, compilation())),
    ).rejects.toThrow('bad soundfont');
    await vi.advanceTimersByTimeAsync(100);

    expect(synthAt(0)?.destroyed).toBe(true);
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    await expect(adapter.play()).rejects.toThrow('disposed');
  });
});
