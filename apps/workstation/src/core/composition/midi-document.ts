import { writeMidi, type MidiData, type MidiEvent } from 'midi-file';

import {
  PROJECT_PPQ,
  TRACK_IDS,
  type KeyEvent,
  type MidiNoteEvent,
  type StandardMidiDocument,
  type StandardMidiTrack,
  type Tick,
} from '@agent-music/contracts';

import type { CanonicalAbcCompilation } from './composition-types.js';

const TRACK_CHANNELS = [9, 0, 1, 2, 3, 4] as const;

type WithoutDelta<T> = T extends unknown ? Omit<T, 'deltaTime'> : never;
type MidiEventInput = WithoutDelta<MidiEvent>;

interface AbsoluteMidiEvent {
  readonly tick: number;
  readonly order: number;
  readonly event: MidiEventInput;
}

const tick = (value: number): Tick => value as Tick;

const toDeltaEvents = (
  absoluteEvents: readonly AbsoluteMidiEvent[],
  totalTicks: number,
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
    deltaTime: Math.max(0, totalTicks - cursor),
    meta: true,
    type: 'endOfTrack',
  });
  return result;
};

const modeFifthsAdjustment = (mode: string): number => {
  switch (mode.toLowerCase()) {
    case '':
    case 'ion':
    case 'maj':
      return 0;
    case 'dor':
      return -2;
    case 'phr':
      return -4;
    case 'lyd':
      return 1;
    case 'mix':
      return -1;
    case 'm':
    case 'min':
    case 'aeo':
      return -3;
    case 'loc':
      return -5;
    default:
      throw new Error(`Unsupported MIDI key mode: ${mode}`);
  }
};

const keyFifths = (key: KeyEvent): number => {
  const majorFifths: Readonly<Record<string, number>> = {
    C: 0,
    D: 2,
    E: 4,
    F: -1,
    G: 1,
    A: 3,
    B: 5,
  };
  const natural = majorFifths[key.tonic.toUpperCase()];
  if (natural === undefined) {
    throw new Error(`Unsupported MIDI key tonic: ${key.tonic}`);
  }
  const accidental =
    key.accidental === '#' ? 7 : key.accidental === 'b' ? -7 : 0;
  const fifths = natural + accidental + modeFifthsAdjustment(key.mode);
  if (fifths < -7 || fifths > 7) {
    throw new Error(
      `MIDI key signature is outside the standard range: ${key.tonic}${key.accidental}${key.mode}`,
    );
  }
  return fifths;
};

const createMetaTrack = (compilation: CanonicalAbcCompilation): MidiEvent[] => {
  const events: AbsoluteMidiEvent[] = [];

  for (const meter of compilation.meterMap) {
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
  for (const tempo of compilation.tempoMap) {
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
  for (const key of compilation.keyMap) {
    events.push({
      tick: key.tick,
      order: 2,
      event: {
        meta: true,
        type: 'keySignature',
        key: keyFifths(key),
        scale: ['m', 'min', 'aeo'].includes(key.mode.toLowerCase()) ? 1 : 0,
      },
    });
  }

  return toDeltaEvents(events, compilation.totalTicks);
};

const createSemanticTrack = (
  compilation: CanonicalAbcCompilation,
  trackIndex: number,
): StandardMidiTrack => {
  const domainTrack = compilation.tracks[trackIndex];
  const trackId = TRACK_IDS[trackIndex];
  if (domainTrack === undefined || trackId === undefined) {
    throw new Error(`Missing fixed MIDI track at index ${String(trackIndex)}`);
  }

  const notes: MidiNoteEvent[] = [];
  for (const event of domainTrack.events) {
    if (event.type !== 'note') {
      continue;
    }
    for (const pitch of event.pitches) {
      notes.push({
        startTick: event.startTick,
        durationTick: event.durationTick,
        pitch,
        velocity: event.velocity,
      });
    }
  }

  return {
    trackId,
    channel: TRACK_CHANNELS[trackIndex] ?? trackIndex,
    notes,
  };
};

const createMidiTrackEvents = (
  track: StandardMidiTrack,
  totalTicks: number,
): MidiEvent[] => {
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

  return toDeltaEvents(events, totalTicks);
};

export const createStandardMidiDocument = (
  compilation: CanonicalAbcCompilation,
): StandardMidiDocument => {
  const tracks = TRACK_IDS.map((_trackId, index) =>
    createSemanticTrack(compilation, index),
  );
  const midi: MidiData = {
    header: {
      format: 1,
      numTracks: tracks.length + 1,
      ticksPerBeat: PROJECT_PPQ,
    },
    tracks: [
      createMetaTrack(compilation),
      ...tracks.map((track) =>
        createMidiTrackEvents(track, compilation.totalTicks),
      ),
    ],
  };

  return {
    format: 1,
    ppq: PROJECT_PPQ,
    fileBytes: Uint8Array.from(writeMidi(midi)),
    tracks,
  };
};

export const midiDocumentEndTick = (document: StandardMidiDocument): Tick =>
  tick(
    Math.max(
      0,
      ...document.tracks.flatMap((track) =>
        track.notes.map((note) => note.startTick + note.durationTick),
      ),
    ),
  );
