import {
  TRACK_IDS,
  isTick,
  isTrackId,
  type Tick,
  type TrackId,
} from './domain.js';
import { isMidiNoteNumber, type MidiNoteNumber } from './music-values.js';
import { PROJECT_PPQ } from './project.js';

export interface MeterEvent {
  readonly tick: Tick;
  readonly numerator: number;
  readonly denominator: number;
}

export interface TempoEvent {
  readonly tick: Tick;
  readonly bpm: number;
}

export interface KeyEvent {
  readonly tick: Tick;
  readonly tonic: string;
  readonly accidental: '' | '#' | 'b';
  readonly mode: string;
}

export interface MidiNoteEvent {
  readonly startTick: Tick;
  readonly durationTick: Tick;
  readonly pitch: MidiNoteNumber;
  readonly velocity: number;
}

export interface StandardMidiTrack {
  readonly trackId: TrackId;
  readonly channel: number;
  readonly notes: readonly MidiNoteEvent[];
}

export interface StandardMidiDocument {
  readonly format: 1;
  readonly ppq: typeof PROJECT_PPQ;
  readonly fileBytes: Uint8Array;
  readonly tracks: readonly StandardMidiTrack[];
}

export interface PlaybackCompilation {
  readonly midiDocument: StandardMidiDocument;
  readonly totalTicks: Tick;
  readonly trackIds: typeof TRACK_IDS;
  readonly meterMap: readonly MeterEvent[];
  readonly tempoMap: readonly TempoEvent[];
  readonly keyMap: readonly KeyEvent[];
}

export interface TimelineClip {
  readonly startTick: Tick;
  readonly endTick: Tick;
}

export interface TimelineTrack {
  readonly trackId: TrackId;
  readonly clips: readonly TimelineClip[];
}

export interface TimelineViewModel {
  readonly totalTicks: Tick;
  readonly meterMap: readonly MeterEvent[];
  readonly tempoMap: readonly TempoEvent[];
  readonly tracks: readonly TimelineTrack[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasFixedTracksInOrder = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === TRACK_IDS.length &&
  TRACK_IDS.every((trackId, index) => value[index] === trackId);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isMeterEvent = (value: unknown): value is MeterEvent =>
  isRecord(value) &&
  isTick(value.tick) &&
  isPositiveInteger(value.numerator) &&
  isPositiveInteger(value.denominator);

const isTempoEvent = (value: unknown): value is TempoEvent =>
  isRecord(value) &&
  isTick(value.tick) &&
  typeof value.bpm === 'number' &&
  Number.isFinite(value.bpm) &&
  value.bpm > 0;

const isKeyEvent = (value: unknown): value is KeyEvent =>
  isRecord(value) &&
  isTick(value.tick) &&
  typeof value.tonic === 'string' &&
  value.tonic.length > 0 &&
  (value.accidental === '' ||
    value.accidental === '#' ||
    value.accidental === 'b') &&
  typeof value.mode === 'string';

const isMidiNoteEvent = (
  value: unknown,
  totalTicks: number,
): value is MidiNoteEvent =>
  isRecord(value) &&
  isTick(value.startTick) &&
  isPositiveInteger(value.durationTick) &&
  value.startTick + value.durationTick <= totalTicks &&
  isMidiNoteNumber(value.pitch) &&
  typeof value.velocity === 'number' &&
  Number.isInteger(value.velocity) &&
  value.velocity >= 1 &&
  value.velocity <= 127;

const isStandardMidiDocument = (
  value: unknown,
  totalTicks: number,
): value is StandardMidiDocument =>
  isRecord(value) &&
  value.format === 1 &&
  value.ppq === PROJECT_PPQ &&
  value.fileBytes instanceof Uint8Array &&
  Array.isArray(value.tracks) &&
  value.tracks.length === TRACK_IDS.length &&
  value.tracks.every(
    (track, index) =>
      isRecord(track) &&
      track.trackId === TRACK_IDS[index] &&
      isTrackId(track.trackId) &&
      typeof track.channel === 'number' &&
      Number.isInteger(track.channel) &&
      track.channel >= 0 &&
      track.channel <= 15 &&
      Array.isArray(track.notes) &&
      track.notes.every((note) => isMidiNoteEvent(note, totalTicks)),
  );

const areMapsValid = (value: Record<string, unknown>): boolean =>
  Array.isArray(value.meterMap) &&
  value.meterMap.every(isMeterEvent) &&
  Array.isArray(value.tempoMap) &&
  value.tempoMap.every(isTempoEvent);

export const isPlaybackCompilation = (
  value: unknown,
): value is PlaybackCompilation => {
  if (
    !isRecord(value) ||
    !isTick(value.totalTicks) ||
    value.totalTicks === 0 ||
    !hasFixedTracksInOrder(value.trackIds) ||
    !areMapsValid(value) ||
    !Array.isArray(value.keyMap) ||
    !value.keyMap.every(isKeyEvent)
  ) {
    return false;
  }

  return isStandardMidiDocument(value.midiDocument, value.totalTicks);
};

export const isTimelineViewModel = (
  value: unknown,
): value is TimelineViewModel => {
  if (
    !isRecord(value) ||
    !isTick(value.totalTicks) ||
    value.totalTicks === 0 ||
    !areMapsValid(value) ||
    !Array.isArray(value.tracks) ||
    value.tracks.length !== TRACK_IDS.length
  ) {
    return false;
  }

  const totalTicks = value.totalTicks;

  return value.tracks.every(
    (track, index) =>
      isRecord(track) &&
      track.trackId === TRACK_IDS[index] &&
      Array.isArray(track.clips) &&
      track.clips.every(
        (clip) =>
          isRecord(clip) &&
          isTick(clip.startTick) &&
          isTick(clip.endTick) &&
          clip.startTick < clip.endTick &&
          clip.endTick <= totalTicks,
      ),
  );
};
