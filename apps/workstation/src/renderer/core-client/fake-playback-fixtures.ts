import { writeMidi, type MidiData, type MidiEvent } from 'midi-file';

import {
  PROJECT_PPQ,
  TRACK_IDS,
  type CoreBootstrapState,
  type RendererKeyEvent,
  type PlaybackCompilation,
  type PreviewSource,
  type StandardMidiDocument,
  type StandardMidiTrack,
} from '../b-contracts/index.js';
import {
  FAKE_CANDIDATE_PLAYBACK_REVISION,
  FAKE_CANDIDATE_CLIPS,
  FAKE_CURRENT_PLAYBACK_REVISION,
  FAKE_KEY_MAP,
  FAKE_METER_MAP,
  FAKE_STABLE_CLIPS,
  FAKE_TEMPO_MAP,
  FAKE_TOTAL_TICKS,
  fakeTick,
} from './fake-composition-fixture.js';
import { FAKE_CANDIDATE_ID } from './fake-core-fixtures.js';
import type { PlaybackBundle } from './workstation-core-client.js';

const TRACK_CHANNELS = [9, 0, 1, 2, 3, 4] as const;

type WithoutDelta<T> = T extends unknown ? Omit<T, 'deltaTime'> : never;
type MidiEventInput = WithoutDelta<MidiEvent>;

interface AbsoluteMidiEvent {
  readonly tick: number;
  readonly order: number;
  readonly event: MidiEventInput;
}

const toDeltaEvents = (
  absoluteEvents: readonly AbsoluteMidiEvent[],
): MidiEvent[] => {
  const events = [...absoluteEvents].sort(
    (left, right) => left.tick - right.tick || left.order - right.order,
  );
  const result: MidiEvent[] = [];
  let cursor = 0;

  for (const absolute of events) {
    result.push({
      ...absolute.event,
      deltaTime: absolute.tick - cursor,
    });
    cursor = absolute.tick;
  }

  result.push({
    deltaTime: Math.max(0, FAKE_TOTAL_TICKS - cursor),
    meta: true,
    type: 'endOfTrack',
  });
  return result;
};

const keyFifths = (key: RendererKeyEvent): number => {
  const majorFifths: Readonly<Record<string, number>> = {
    C: 0,
    D: 2,
    E: 4,
    F: -1,
    G: 1,
    A: 3,
    B: 5,
  };
  const natural = majorFifths[key.tonic.toUpperCase()] ?? 0;
  const accidental = key.tonic.includes('#') ? 7 : 0;
  const modeAdjustment = ['m', 'min', 'minor', 'aeo'].includes(
    key.mode.toLowerCase(),
  )
    ? -3
    : 0;
  return natural + accidental + modeAdjustment;
};

const createMetaTrack = (): MidiEvent[] => {
  const events: AbsoluteMidiEvent[] = [];

  for (const meter of FAKE_METER_MAP) {
    events.push({
      tick: meter.tick,
      order: 0,
      event: {
        meta: true,
        type: 'timeSignature',
        numerator: meter.numerator,
        denominator: meter.denominator,
        metronome: 24,
        thirtyseconds: 8,
      },
    });
  }
  for (const tempo of FAKE_TEMPO_MAP) {
    events.push({
      tick: tempo.tick,
      order: 1,
      event: {
        meta: true,
        type: 'setTempo',
        microsecondsPerBeat: Math.round(60_000_000 / tempo.bpm),
      },
    });
  }
  for (const key of FAKE_KEY_MAP) {
    events.push({
      tick: key.tick,
      order: 2,
      event: {
        meta: true,
        type: 'keySignature',
        key: keyFifths(key),
        scale: ['m', 'min', 'minor', 'aeo'].includes(key.mode.toLowerCase())
          ? 1
          : 0,
      },
    });
  }

  return toDeltaEvents(events);
};

const createSemanticTracks = (
  clips: typeof FAKE_STABLE_CLIPS,
): readonly StandardMidiTrack[] =>
  TRACK_IDS.map((trackId, index) => ({
    trackId,
    channel: TRACK_CHANNELS[index] ?? index,
    notes: clips[trackId].flatMap((clip) => clip.notes),
  }));

const createMidiTrackEvents = (track: StandardMidiTrack): MidiEvent[] => {
  const events: AbsoluteMidiEvent[] = [
    {
      tick: 0,
      order: 0,
      event: { meta: true, type: 'trackName', text: track.trackId },
    },
  ];

  for (const note of track.notes) {
    events.push(
      {
        tick: note.startTick,
        order: 2,
        event: {
          type: 'noteOn',
          channel: track.channel,
          noteNumber: note.pitch,
          velocity: note.velocity,
        },
      },
      {
        tick: note.startTick + note.durationTick,
        order: 1,
        event: {
          type: 'noteOff',
          channel: track.channel,
          noteNumber: note.pitch,
          velocity: 0,
        },
      },
    );
  }

  return toDeltaEvents(events);
};

const createMidiDocument = (
  clips: typeof FAKE_STABLE_CLIPS,
): StandardMidiDocument => {
  const tracks = createSemanticTracks(clips);
  const midi: MidiData = {
    header: {
      format: 1,
      numTracks: tracks.length + 1,
      ticksPerBeat: PROJECT_PPQ,
    },
    tracks: [createMetaTrack(), ...tracks.map(createMidiTrackEvents)],
  };

  return {
    format: 1,
    ppq: PROJECT_PPQ,
    fileBytes: Uint8Array.from(writeMidi(midi)),
    tracks,
  };
};

const compilation = (clips: typeof FAKE_STABLE_CLIPS): PlaybackCompilation => ({
  midiDocument: createMidiDocument(clips),
  totalTicks: fakeTick(FAKE_TOTAL_TICKS),
  trackIds: TRACK_IDS,
  meterMap: FAKE_METER_MAP,
  tempoMap: FAKE_TEMPO_MAP,
  keyMap: FAKE_KEY_MAP.map((key) => ({ ...key, accidental: '' })),
});

const currentBundle: PlaybackBundle = {
  source: { kind: 'current' },
  revision: FAKE_CURRENT_PLAYBACK_REVISION,
  compilation: compilation(FAKE_STABLE_CLIPS),
};

const candidateBundle: PlaybackBundle = {
  source: { kind: 'candidate', candidateId: FAKE_CANDIDATE_ID },
  revision: FAKE_CANDIDATE_PLAYBACK_REVISION,
  compilation: compilation(FAKE_CANDIDATE_CLIPS),
};

const hasKnownCurrentPlayback = (state: CoreBootstrapState): boolean =>
  state.project.status === 'open' &&
  state.current.status === 'ready' &&
  !state.current.isEmpty &&
  state.current.revision === FAKE_CURRENT_PLAYBACK_REVISION;

const hasKnownCandidatePlayback = (
  state: CoreBootstrapState,
  source: Extract<PreviewSource, { kind: 'candidate' }>,
): boolean =>
  state.project.status === 'open' &&
  state.candidate.status === 'ready' &&
  state.candidate.candidateId === FAKE_CANDIDATE_ID &&
  source.candidateId === state.candidate.candidateId;

/** Resolves only playback represented by the supplied authoritative snapshot. */
export const readFakePlaybackBundle = (
  state: CoreBootstrapState,
  source: PreviewSource,
): PlaybackBundle | null => {
  if (source.kind === 'current') {
    return hasKnownCurrentPlayback(state)
      ? structuredClone(currentBundle)
      : null;
  }

  return hasKnownCandidatePlayback(state, source)
    ? structuredClone(candidateBundle)
    : null;
};
