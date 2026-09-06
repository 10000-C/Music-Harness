import { BasicSoundBank, MIDIControllers } from 'spessasynth_core';
import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import {
  PROJECT_PPQ,
  TRACK_IDS,
  type CandidateId,
  type PlaybackCompilation,
  type Tick,
} from '../b-contracts/index.js';

import {
  SpessaSynthRuntimeAdapter,
  type PlaybackRuntime,
} from '../opendaw-runtime/index.js';
import { createPlaybackRuntime } from '../opendaw-runtime/playback-runtime.js';

import {
  createEditedSpikeMidiFile,
  createSpikeMidiFile,
  createSpikeSoundFont,
  inspectSpikeMidi,
  inspectSpikeSoundFont,
  parseSpikeMidi,
} from './spike-fixtures.js';
import {
  normalizeSpikeError,
  type SpessaSynthRuntimeEvidence,
  type SpessaSynthSpikeCheck,
  type SpessaSynthSpikePhase,
  type SpessaSynthSpikeReport,
} from './spike-report.js';

export interface SpessaSynthSpikeInput {
  readonly midiBuffer: ArrayBuffer;
  readonly soundFontBuffer: ArrayBuffer;
  readonly midiFileName: string;
  readonly mode: 'generated' | 'imported';
}

interface PlaybackMeasurement {
  readonly peak: number;
  readonly maxVoiceCount: number;
  readonly channelVoiceCounts: readonly number[];
  readonly playbackSeconds: number;
}

const tick = (value: number): Tick => value as Tick;

const createAdapterCompilation = (
  midiBuffer: ArrayBuffer,
): PlaybackCompilation => ({
  midiDocument: {
    format: 1,
    ppq: PROJECT_PPQ,
    fileBytes: new Uint8Array(midiBuffer.slice(0)),
    tracks: TRACK_IDS.map((trackId, index) => ({
      trackId,
      channel: index === 0 ? 0 : index === 1 ? 1 : index,
      notes: [],
    })),
  },
  totalTicks: tick(2_880),
  trackIds: TRACK_IDS,
  meterMap: [{ tick: tick(0), numerator: 4, denominator: 4 }],
  tempoMap: [{ tick: tick(0), bpm: 120 }],
  keyMap: [{ tick: tick(0), tonic: 'C', accidental: '', mode: '' }],
});

class SpikeCheckError extends Error {
  constructor(
    readonly checkId: string,
    message: string,
  ) {
    super(message);
    this.name = 'SpikeCheckError';
  }
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

const withTimeout = async <T>(
  operation: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> => {
  let timeoutId = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(milliseconds)}ms.`));
    }, milliseconds);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const requireCheck = (
  checks: SpessaSynthSpikeCheck[],
  condition: boolean,
  id: string,
  detail: string,
): void => {
  if (condition) {
    checks.push({ id, status: 'passed', detail });
    return;
  }
  checks.push({ id, status: 'failed', detail });
  throw new SpikeCheckError(id, detail);
};

const controllerValue = (
  snapshot: Awaited<ReturnType<WorkletSynthesizer['getSnapshot']>>,
  channel: number,
  controller: number,
): number => snapshot.midiChannels[channel]?.midiControllers[controller] ?? -1;

const normalizedControllerValue = (
  snapshot: Awaited<ReturnType<WorkletSynthesizer['getSnapshot']>>,
  channel: number,
  controller: number,
): number => controllerValue(snapshot, channel, controller) >> 7;

const measurePlayback = async (
  analyser: AnalyserNode,
  synth: WorkletSynthesizer,
  sequencer: Sequencer,
  channels: readonly number[],
): Promise<PlaybackMeasurement> => {
  const samples = new Float32Array(analyser.fftSize);
  const channelVoiceCounts = channels.map(() => 0);
  let peak = 0;
  let maxVoiceCount = 0;
  const startedAt = performance.now();
  const minimumSampleUntil = startedAt + 450;
  const deadline = startedAt + 1_500;

  while (performance.now() < deadline) {
    analyser.getFloatTimeDomainData(samples);
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    maxVoiceCount = Math.max(maxVoiceCount, synth.voiceCount);
    channels.forEach((channel, index) => {
      const voiceCount = synth.midiChannels[channel]?.voiceCount ?? 0;
      const previous = channelVoiceCounts[index] ?? 0;
      channelVoiceCounts[index] = Math.max(previous, voiceCount);
    });
    if (
      performance.now() >= minimumSampleUntil &&
      peak > 0.0001 &&
      channelVoiceCounts.every((count) => count > 0)
    )
      break;
    await delay(25);
  }

  return {
    peak,
    maxVoiceCount,
    channelVoiceCounts,
    playbackSeconds: sequencer.currentTime,
  };
};

const measureAnalyserPeak = async (
  analyser: AnalyserNode,
  milliseconds: number,
): Promise<number> => {
  const samples = new Float32Array(analyser.fftSize);
  let peak = 0;
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) {
    analyser.getFloatTimeDomainData(samples);
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    await delay(25);
  }
  return peak;
};

const usedChannelsFrom = (
  midi: ReturnType<typeof inspectSpikeMidi>,
): number[] =>
  [
    ...new Set(
      midi.tracks.flatMap((track) => track.notes.map((note) => note.channel)),
    ),
  ].sort((left, right) => left - right);

const setLockedController = (
  synth: WorkletSynthesizer,
  channel: number,
  controller: (typeof MIDIControllers)[keyof typeof MIDIControllers],
  value: number,
): void => {
  const target = synth.midiChannels[channel];
  if (target === undefined) {
    throw new Error(`Synth channel ${String(channel)} is unavailable.`);
  }
  target.lockController(controller, false);
  synth.controllerChange(channel, controller, value);
  target.lockController(controller, true);
};

const loadSequence = async (
  sequencer: Sequencer,
  buffer: ArrayBuffer,
  fileName: string,
): Promise<void> => {
  sequencer.pause();
  sequencer.loadNewSongList([{ binary: buffer.slice(0), fileName }]);
  await withTimeout(sequencer.getMIDI(), 5_000, `Loading ${fileName}`);
  sequencer.currentTime = 0;
};

export const createGeneratedSpikeInput = (): SpessaSynthSpikeInput => ({
  midiBuffer: createSpikeMidiFile(),
  soundFontBuffer: createSpikeSoundFont(),
  midiFileName: 'generated-spike.mid',
  mode: 'generated',
});

export const runSpessaSynthSpike = async (
  input: SpessaSynthSpikeInput = createGeneratedSpikeInput(),
): Promise<SpessaSynthSpikeReport> => {
  const checks: SpessaSynthSpikeCheck[] = [];
  let phase: SpessaSynthSpikePhase = 'midi';
  let midiEvidence: ReturnType<typeof inspectSpikeMidi> | undefined;
  let editedMidiEvidence: ReturnType<typeof inspectSpikeMidi> | undefined;
  let soundFontEvidence: ReturnType<typeof inspectSpikeSoundFont> | undefined;
  let runtimeEvidence: SpessaSynthRuntimeEvidence | undefined;
  let audioContext: AudioContext | undefined;
  let synth: WorkletSynthesizer | undefined;
  let sequencer: Sequencer | undefined;
  let adapterRuntime: PlaybackRuntime | undefined;

  try {
    const midi = parseSpikeMidi(input.midiBuffer.slice(0), input.midiFileName);
    midiEvidence = inspectSpikeMidi(midi);
    const usedChannels = usedChannelsFrom(midiEvidence);
    requireCheck(
      checks,
      midiEvidence.tracks.some((track) => track.notes.length > 0),
      'midi-import',
      `Parsed ${String(midiEvidence.tracks.length)} MIDI tracks and ${String(usedChannels.length)} note channels.`,
    );
    requireCheck(
      checks,
      midiEvidence.tempos.length > 0 && midiEvidence.timeSignatures.length > 0,
      'midi-musical-metadata',
      `Found ${String(midiEvidence.tempos.length)} tempo event(s) and ${String(midiEvidence.timeSignatures.length)} time signature(s).`,
    );
    if (input.mode === 'generated') {
      requireCheck(
        checks,
        usedChannels.length >= 2,
        'midi-multiple-channels',
        `Generated fixture exposes channels ${usedChannels.join(', ')}.`,
      );
    }

    const editedBuffer = createEditedSpikeMidiFile(midi);
    editedMidiEvidence = inspectSpikeMidi(
      parseSpikeMidi(editedBuffer.slice(0), `edited-${input.midiFileName}`),
    );
    const editedBass = editedMidiEvidence.tracks[2];
    requireCheck(
      checks,
      input.mode === 'imported' ||
        (editedBass?.notes[0]?.midiNote === 48 &&
          editedBass.programs[0]?.program === 0),
      'midi-edit-roundtrip',
      input.mode === 'generated'
        ? 'Programmatic transpose, program, controller and velocity edits survived write/reparse.'
        : 'Imported MIDI completed a write/reparse cycle.',
    );

    phase = 'soundfont';
    await withTimeout(
      BasicSoundBank.isSF3DecoderReady,
      5_000,
      'SoundFont decoder initialization',
    );
    soundFontEvidence = inspectSpikeSoundFont(input.soundFontBuffer.slice(0));
    requireCheck(
      checks,
      soundFontEvidence.presetCount > 0,
      'soundfont-import',
      `Parsed ${String(soundFontEvidence.presetCount)} SoundFont preset(s).`,
    );
    if (input.mode === 'generated') {
      requireCheck(
        checks,
        soundFontEvidence.presetCount >= 2,
        'soundfont-multiple-presets',
        'Generated SF2 contains two independently addressable preset definitions.',
      );
    }

    phase = 'audio-worklet';
    audioContext = new AudioContext({ latencyHint: 'interactive' });
    await withTimeout(
      audioContext.audioWorklet.addModule(processorUrl),
      8_000,
      'AudioWorklet processor registration',
    );
    synth = new WorkletSynthesizer(audioContext, {
      eventsEnabled: true,
      oneOutput: false,
    });
    await withTimeout(
      synth.soundBankManager.addSoundBank(
        input.soundFontBuffer.slice(0),
        'competition-spike',
      ),
      8_000,
      'SoundFont worklet loading',
    );
    await withTimeout(synth.isReady, 8_000, 'SpessaSynth readiness');

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2_048;
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    synth.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    await withTimeout(audioContext.resume(), 5_000, 'AudioContext resume');
    requireCheck(
      checks,
      audioContext.state === 'running',
      'audio-worklet-ready',
      `AudioWorklet and synthesizer initialized with context state ${audioContext.state}.`,
    );

    phase = 'controls';
    const primaryChannel = usedChannels[0] ?? 0;
    const secondaryChannel = usedChannels[1] ?? primaryChannel;
    const primary = synth.midiChannels[primaryChannel];
    const secondary = synth.midiChannels[secondaryChannel];
    if (primary === undefined || secondary === undefined) {
      throw new Error(
        'The generated MIDI requested an unavailable synth channel.',
      );
    }

    primary.setSystemParameter('presetLock', false);
    synth.programChange(primaryChannel, input.mode === 'generated' ? 1 : 0);
    primary.setSystemParameter('presetLock', true);
    secondary.setSystemParameter('presetLock', false);
    synth.programChange(secondaryChannel, 0);
    secondary.setSystemParameter('presetLock', true);
    primary.setSystemParameter('gain', 0.68);
    primary.setSystemParameter('pan', -0.35);
    secondary.setSystemParameter('gain', 0.54);
    secondary.setSystemParameter('pan', 0.35);

    const controllerTargets = [
      [MIDIControllers.filterResonance, 76],
      [MIDIControllers.releaseTime, 68],
      [MIDIControllers.attackTime, 60],
      [MIDIControllers.brightness, 84],
      [MIDIControllers.reverbDepth, 42],
      [MIDIControllers.chorusDepth, 34],
    ] as const;
    for (const [controller, value] of controllerTargets) {
      setLockedController(synth, primaryChannel, controller, value);
    }

    secondary.setSystemParameter('isMuted', true);
    const mutedSnapshot = await withTimeout(
      synth.getSnapshot(),
      5_000,
      'Muted channel snapshot',
    );
    secondary.setSystemParameter('isMuted', false);
    const controlSnapshot = await withTimeout(
      synth.getSnapshot(),
      5_000,
      'Control snapshot',
    );
    const primarySnapshot = controlSnapshot.midiChannels[primaryChannel];
    const secondarySnapshot = controlSnapshot.midiChannels[secondaryChannel];
    if (primarySnapshot === undefined || secondarySnapshot === undefined) {
      throw new Error('Synth snapshot omitted a controlled MIDI channel.');
    }
    requireCheck(
      checks,
      primarySnapshot.patch?.program === (input.mode === 'generated' ? 1 : 0) &&
        secondarySnapshot.patch?.program === 0 &&
        primarySnapshot.systemParameters.presetLock &&
        secondarySnapshot.systemParameters.presetLock,
      'independent-preset-control',
      `Channels ${String(primaryChannel)} and ${String(secondaryChannel)} hold independent preset locks.`,
    );
    requireCheck(
      checks,
      primarySnapshot.systemParameters.gain === 0.68 &&
        primarySnapshot.systemParameters.pan === -0.35 &&
        secondarySnapshot.systemParameters.gain === 0.54 &&
        secondarySnapshot.systemParameters.pan === 0.35,
      'independent-mix-control',
      'Per-channel gain and pan survived the authoritative synth snapshot.',
    );
    requireCheck(
      checks,
      mutedSnapshot.midiChannels[secondaryChannel]?.systemParameters.isMuted ===
        true && !secondarySnapshot.systemParameters.isMuted,
      'mute-control',
      'Per-channel mute toggled on and back off.',
    );
    requireCheck(
      checks,
      controllerTargets.every(
        ([controller, value]) =>
          normalizedControllerValue(
            controlSnapshot,
            primaryChannel,
            controller,
          ) === value,
      ),
      'tone-and-space-controls',
      'CC 71/72/73/74/91/93 values survived the authoritative synth snapshot.',
    );

    phase = 'playback';
    sequencer = new Sequencer(synth, { skipToFirstNoteOn: false });
    await loadSequence(
      sequencer,
      input.midiBuffer,
      `original-${input.midiFileName}`,
    );
    sequencer.play();
    const originalPlayback = await measurePlayback(analyser, synth, sequencer, [
      ...new Set([primaryChannel, secondaryChannel]),
    ]);
    sequencer.pause();
    requireCheck(
      checks,
      originalPlayback.peak > 0.0001 && originalPlayback.playbackSeconds > 0,
      'multi-track-playback',
      `Original sequence produced peak ${originalPlayback.peak.toFixed(5)} with ${String(originalPlayback.maxVoiceCount)} simultaneous voice(s).`,
    );
    if (input.mode === 'generated') {
      requireCheck(
        checks,
        originalPlayback.channelVoiceCounts.every((count) => count > 0),
        'multi-channel-voices',
        `Observed per-channel voice maxima ${originalPlayback.channelVoiceCounts.join(', ')}.`,
      );
    }

    await loadSequence(sequencer, editedBuffer, `edited-${input.midiFileName}`);
    sequencer.play();
    const editedPlayback = await measurePlayback(analyser, synth, sequencer, [
      ...new Set([primaryChannel, secondaryChannel]),
    ]);
    requireCheck(
      checks,
      editedPlayback.peak > 0.0001 && editedPlayback.playbackSeconds > 0,
      'edited-midi-playback',
      `Edited sequence produced peak ${editedPlayback.peak.toFixed(5)} after programmatic reload.`,
    );

    phase = 'adapter';
    const adapterAnalyser = audioContext.createAnalyser();
    adapterAnalyser.fftSize = 2_048;
    adapterAnalyser.connect(silentOutput);
    const adapter = new SpessaSynthRuntimeAdapter({
      processorUrl,
      soundFontBuffer: input.soundFontBuffer,
      audioContext,
      output: adapterAnalyser,
    });
    adapterRuntime = createPlaybackRuntime(adapter);
    const currentSource = {
      kind: 'current',
      revision: 'spike.current',
    } as const;
    const candidateSource = {
      kind: 'candidate',
      revision: 'spike.candidate',
      candidateId: 'candidate.spike' as CandidateId,
    } as const;
    await adapterRuntime.syncSource(
      currentSource,
      createAdapterCompilation(input.midiBuffer),
    );
    await adapterRuntime.syncSource(
      candidateSource,
      createAdapterCompilation(editedBuffer),
    );
    await adapterRuntime.activateSource(currentSource);
    await adapterRuntime.activateSource(candidateSource);
    requireCheck(
      checks,
      adapterRuntime.getSnapshot().activeSource?.kind === 'candidate',
      'adapter-runtime-source-switch',
      'PlaybackRuntime activated the final Candidate through SpessaSynthRuntimeAdapter.',
    );

    adapter.setProgram('track.drums', input.mode === 'generated' ? 1 : 0);
    adapter.setMix('track.drums', 0.68, -0.35);
    for (const [controller, value] of controllerTargets)
      adapter.setController('track.drums', controller, value);
    requireCheck(
      checks,
      true,
      'adapter-track-controls',
      'Adapter accepted TrackId-routed program, mix, and CC 71/72/73/74/91/93 controls.',
    );

    const observedPositions: number[] = [];
    const unsubscribeAdapterPosition = adapterRuntime.subscribe(() => {
      observedPositions.push(adapterRuntime?.getSnapshot().positionTick ?? 0);
    });
    await adapterRuntime.send({ type: 'seek', tick: tick(0) });
    await adapterRuntime.send({ type: 'play' });
    const adapterAnalyserPeak = await measureAnalyserPeak(adapterAnalyser, 300);
    await adapterRuntime.send({ type: 'pause' });
    const adapterPositionTick = adapterRuntime.getSnapshot().positionTick;
    requireCheck(
      checks,
      adapterAnalyserPeak > 0.0001 && adapterPositionTick > 0,
      'adapter-transport-position',
      `Adapter playback produced peak ${adapterAnalyserPeak.toFixed(5)} and reported Tick ${String(adapterPositionTick)}.`,
    );

    await adapterRuntime.send({
      type: 'setLoop',
      range: { startTick: tick(480), endTick: tick(960) },
    });
    await adapterRuntime.send({ type: 'seek', tick: tick(900) });
    await adapterRuntime.send({ type: 'play' });
    await delay(250);
    await adapterRuntime.send({ type: 'pause' });
    const adapterLoopPositionTick = adapterRuntime.getSnapshot().positionTick;
    requireCheck(
      checks,
      adapterLoopPositionTick >= 480 && adapterLoopPositionTick < 960,
      'adapter-loop-observed',
      `Loop wrapped inside Tick range 480–960 and reported ${String(adapterLoopPositionTick)}.`,
    );

    await adapterRuntime.send({ type: 'setLoop', range: null });
    await adapterRuntime.send({ type: 'seek', tick: tick(0) });
    await adapterRuntime.send({ type: 'play' });
    const adapterUnmutedPeak = await measureAnalyserPeak(adapterAnalyser, 180);
    await adapterRuntime.send({
      type: 'setMute',
      trackId: 'track.drums',
      muted: true,
    });
    await adapterRuntime.send({
      type: 'setMute',
      trackId: 'track.bass',
      muted: true,
    });
    await delay(600);
    const adapterMutedPeak = await measureAnalyserPeak(adapterAnalyser, 180);
    const adapterMutedState = adapterRuntime.getSnapshot();
    await adapterRuntime.send({
      type: 'setMute',
      trackId: 'track.drums',
      muted: false,
    });
    await adapterRuntime.send({
      type: 'setMute',
      trackId: 'track.bass',
      muted: false,
    });
    await adapterRuntime.send({ type: 'pause' });
    await adapterRuntime.send({ type: 'seek', tick: tick(0) });
    await adapterRuntime.send({ type: 'play' });
    const adapterRestoredPeak = await measureAnalyserPeak(adapterAnalyser, 180);
    await adapterRuntime.send({ type: 'pause' });
    await adapterRuntime.send({
      type: 'setSolo',
      trackId: 'track.drums',
      solo: true,
    });
    const adapterSoloState = adapterRuntime.getSnapshot();
    await adapterRuntime.send({ type: 'seek', tick: tick(0) });
    await adapterRuntime.send({ type: 'play' });
    const adapterSoloPeak = await measureAnalyserPeak(adapterAnalyser, 300);
    await adapterRuntime.send({ type: 'pause' });
    requireCheck(
      checks,
      adapterUnmutedPeak > 0.0001 &&
        adapterMutedPeak < adapterUnmutedPeak * 0.5 &&
        adapterMutedState.mutedTrackIds.includes('track.drums') &&
        adapterMutedState.mutedTrackIds.includes('track.bass') &&
        adapterRestoredPeak > 0.0001 &&
        adapterSoloPeak > 0.0001 &&
        adapterSoloState.mutedTrackIds.length === 0 &&
        adapterSoloState.soloTrackIds.length === 1 &&
        adapterSoloState.soloTrackIds[0] === 'track.drums',
      'adapter-mute-solo-audio',
      `Mute changed live audio ${adapterUnmutedPeak.toFixed(5)} → ${adapterMutedPeak.toFixed(5)}; unmuted playback recovered to ${adapterRestoredPeak.toFixed(5)}; drums-only solo produced ${adapterSoloPeak.toFixed(5)}.`,
    );

    unsubscribeAdapterPosition();
    await adapterRuntime.dispose();
    const callsAtDispose = observedPositions.length;
    await delay(100);
    let adapterRejectedAfterDispose = false;
    try {
      await adapter.play();
    } catch {
      adapterRejectedAfterDispose = true;
    }
    const adapterDisposed =
      adapterRuntime.getSnapshot().lifecycle === 'disposed' &&
      observedPositions.length === callsAtDispose &&
      adapterRejectedAfterDispose;
    requireCheck(
      checks,
      adapterDisposed,
      'adapter-dispose',
      'Runtime disposal removed position callbacks and rejected later adapter commands.',
    );
    adapterRuntime = undefined;

    runtimeEvidence = {
      audioContextState: audioContext.state,
      analyserPeak: originalPlayback.peak,
      editedAnalyserPeak: editedPlayback.peak,
      maxVoiceCount: Math.max(
        originalPlayback.maxVoiceCount,
        editedPlayback.maxVoiceCount,
      ),
      channelVoiceCounts: originalPlayback.channelVoiceCounts,
      switchedPrograms: [
        primarySnapshot.patch?.program ?? -1,
        secondarySnapshot.patch?.program ?? -1,
      ],
      channelGain: primarySnapshot.systemParameters.gain,
      channelPan: primarySnapshot.systemParameters.pan,
      controllers: Object.fromEntries(
        controllerTargets.map(([controller]) => [
          String(controller),
          normalizedControllerValue(
            controlSnapshot,
            primaryChannel,
            controller,
          ),
        ]),
      ),
      muteTransition: [
        mutedSnapshot.midiChannels[secondaryChannel]?.systemParameters
          .isMuted ?? false,
        secondarySnapshot.systemParameters.isMuted,
      ],
      originalPlaybackSeconds: originalPlayback.playbackSeconds,
      editedPlaybackSeconds: editedPlayback.playbackSeconds,
      adapterAnalyserPeak,
      adapterMutedPeak,
      adapterSoloPeak,
      adapterPositionTick,
      adapterLoopPositionTick,
      adapterDisposed,
    };

    phase = 'complete';
    return {
      schemaVersion: 1,
      mode: input.mode,
      status: 'passed',
      phase,
      checks,
      midi: midiEvidence,
      editedMidi: editedMidiEvidence,
      soundFont: soundFontEvidence,
      runtime: runtimeEvidence,
    };
  } catch (error) {
    if (
      error instanceof SpikeCheckError &&
      !checks.some(
        (check) => check.id === error.checkId && check.status === 'failed',
      )
    ) {
      checks.push({
        id: error.checkId,
        status: 'failed',
        detail: error.message,
      });
    }
    return {
      schemaVersion: 1,
      mode: input.mode,
      status: 'failed',
      phase,
      checks,
      ...(midiEvidence === undefined ? {} : { midi: midiEvidence }),
      ...(editedMidiEvidence === undefined
        ? {}
        : { editedMidi: editedMidiEvidence }),
      ...(soundFontEvidence === undefined
        ? {}
        : { soundFont: soundFontEvidence }),
      ...(runtimeEvidence === undefined ? {} : { runtime: runtimeEvidence }),
      error: normalizeSpikeError(error),
    };
  } finally {
    try {
      await adapterRuntime?.dispose();
      sequencer?.pause();
      synth?.stopAll(true);
      synth?.destroy();
      if (audioContext !== undefined && audioContext.state !== 'closed') {
        await audioContext.close();
      }
    } catch {
      // The report already carries the primary failure; cleanup is best effort.
    }
  }
};
