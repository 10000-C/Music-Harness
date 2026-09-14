import {
  TRACK_IDS,
  isTick,
  isTickRange,
  isTrackId,
  type Tick,
  type TrackId,
} from '@agent-music/contracts';
import {
  hasExactKeys,
  isFiniteNumberInRange,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from './guard-utils.js';

export const TIMELINE_VIEW_MODEL_SCHEMA_VERSION = 1 as const;

export const KEY_TONICS = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export type KeyTonic = (typeof KEY_TONICS)[number];
export type KeyMode = 'major' | 'minor';
export type MeterDenominator = 1 | 2 | 4 | 8 | 16 | 32;

export interface TempoEvent {
  readonly tick: Tick;
  readonly bpm: number;
}

export interface MeterEvent {
  readonly tick: Tick;
  readonly numerator: number;
  readonly denominator: MeterDenominator;
}

export interface KeyEvent {
  readonly tick: Tick;
  readonly tonic: KeyTonic;
  readonly mode: KeyMode;
}

export interface TimelineNoteMarker {
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly pitch: number;
  readonly velocity: number;
}

export interface TimelineClip {
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly label: string;
  readonly density: number;
  readonly noteMarkers: readonly TimelineNoteMarker[];
}

export interface TimelineTrackViewModel {
  readonly trackId: TrackId;
  readonly label: string;
  readonly clips: readonly TimelineClip[];
}

export interface TimelineViewModel {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly totalTicks: Tick;
  readonly ticksPerQuarter: number;
  readonly tempoMap: readonly TempoEvent[];
  readonly meterMap: readonly MeterEvent[];
  readonly keyMap: readonly KeyEvent[];
  readonly tracks: readonly TimelineTrackViewModel[];
}

const KEY_TONIC_SET: ReadonlySet<string> = new Set(KEY_TONICS);
const METER_DENOMINATOR_SET: ReadonlySet<number> = new Set([
  1, 2, 4, 8, 16, 32,
]);

const isStrictlyOrderedMap = <T>(
  value: unknown,
  isEvent: (event: unknown) => event is T,
  getTick: (event: T) => number,
  totalTicks: number,
): value is readonly T[] => {
  if (!Array.isArray(value) || value.length === 0) return false;

  let previousTick = -1;
  for (const event of value) {
    if (!isEvent(event)) return false;
    const tick = getTick(event);
    if (tick <= previousTick || tick >= totalTicks) return false;
    previousTick = tick;
  }

  return getTick(value[0] as T) === 0;
};

export const isTempoEvent = (value: unknown): value is TempoEvent =>
  isRecord(value) &&
  hasExactKeys(value, ['tick', 'bpm']) &&
  isTick(value.tick) &&
  isFiniteNumberInRange(value.bpm, 1, 400);

export const isMeterEvent = (value: unknown): value is MeterEvent =>
  isRecord(value) &&
  hasExactKeys(value, ['tick', 'numerator', 'denominator']) &&
  isTick(value.tick) &&
  isPositiveInteger(value.numerator) &&
  value.numerator <= 32 &&
  typeof value.denominator === 'number' &&
  METER_DENOMINATOR_SET.has(value.denominator);

export const isKeyEvent = (value: unknown): value is KeyEvent =>
  isRecord(value) &&
  hasExactKeys(value, ['tick', 'tonic', 'mode']) &&
  isTick(value.tick) &&
  typeof value.tonic === 'string' &&
  KEY_TONIC_SET.has(value.tonic) &&
  (value.mode === 'major' || value.mode === 'minor');

export const isTimelineNoteMarker = (
  value: unknown,
): value is TimelineNoteMarker =>
  isRecord(value) &&
  hasExactKeys(value, ['startTick', 'endTick', 'pitch', 'velocity']) &&
  isTickRange(value) &&
  isFiniteNumberInRange(value.pitch, 0, 127) &&
  Number.isInteger(value.pitch) &&
  isFiniteNumberInRange(value.velocity, 1, 127) &&
  Number.isInteger(value.velocity);

const isTimelineClipWithin = (
  value: unknown,
  totalTicks: number,
): value is TimelineClip => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'startTick',
      'endTick',
      'label',
      'density',
      'noteMarkers',
    ]) ||
    !isTickRange(value) ||
    value.endTick > totalTicks ||
    !isNonEmptyString(value.label) ||
    !isFiniteNumberInRange(value.density, 0, 1) ||
    !Array.isArray(value.noteMarkers)
  ) {
    return false;
  }

  let previousStartTick = -1;
  for (const marker of value.noteMarkers) {
    if (
      !isTimelineNoteMarker(marker) ||
      marker.startTick < value.startTick ||
      marker.endTick > value.endTick ||
      marker.startTick < previousStartTick
    ) {
      return false;
    }
    previousStartTick = marker.startTick;
  }

  return true;
};

export const isTimelineClip = (value: unknown): value is TimelineClip =>
  isTimelineClipWithin(value, Number.MAX_SAFE_INTEGER);

const isTimelineTrackWithin = (
  value: unknown,
  expectedTrackId: TrackId,
  totalTicks: number,
): value is TimelineTrackViewModel => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['trackId', 'label', 'clips']) ||
    !isTrackId(value.trackId) ||
    value.trackId !== expectedTrackId ||
    !isNonEmptyString(value.label) ||
    !Array.isArray(value.clips)
  ) {
    return false;
  }

  let previousEndTick = -1;
  for (const clip of value.clips) {
    if (
      !isTimelineClipWithin(clip, totalTicks) ||
      clip.startTick < previousEndTick
    ) {
      return false;
    }
    previousEndTick = clip.endTick;
  }

  return true;
};

export const isTimelineViewModel = (
  value: unknown,
): value is TimelineViewModel => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'revision',
      'totalTicks',
      'ticksPerQuarter',
      'tempoMap',
      'meterMap',
      'keyMap',
      'tracks',
    ]) ||
    value.schemaVersion !== TIMELINE_VIEW_MODEL_SCHEMA_VERSION ||
    !isNonEmptyString(value.revision) ||
    !isTick(value.totalTicks) ||
    value.totalTicks === 0 ||
    !isPositiveInteger(value.ticksPerQuarter) ||
    value.ticksPerQuarter > 9_600 ||
    !isStrictlyOrderedMap(
      value.tempoMap,
      isTempoEvent,
      (event) => event.tick,
      value.totalTicks,
    ) ||
    !isStrictlyOrderedMap(
      value.meterMap,
      isMeterEvent,
      (event) => event.tick,
      value.totalTicks,
    ) ||
    !isStrictlyOrderedMap(
      value.keyMap,
      isKeyEvent,
      (event) => event.tick,
      value.totalTicks,
    ) ||
    !Array.isArray(value.tracks) ||
    value.tracks.length !== TRACK_IDS.length
  ) {
    return false;
  }

  const tracks = value.tracks;
  const totalTicks = value.totalTicks;

  return TRACK_IDS.every((trackId, index) =>
    isTimelineTrackWithin(tracks[index], trackId, totalTicks),
  );
};
