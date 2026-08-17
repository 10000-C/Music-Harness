declare const projectIdBrand: unique symbol;
declare const taskIdBrand: unique symbol;
declare const candidateIdBrand: unique symbol;
declare const tickBrand: unique symbol;

export type ProjectId = string & {
  readonly [projectIdBrand]: true;
};

export type TaskId = string & {
  readonly [taskIdBrand]: true;
};

export type CandidateId = string & {
  readonly [candidateIdBrand]: true;
};

export type Tick = number & {
  readonly [tickBrand]: true;
};

export const TRACK_IDS = [
  'track.drums',
  'track.bass',
  'track.guitar',
  'track.keys',
  'track.strings',
  'track.winds',
] as const;

export type TrackId = (typeof TRACK_IDS)[number];

export interface TickRange {
  readonly startTick: Tick;
  readonly endTick: Tick;
}

export interface WholeProjectScope {
  readonly type: 'wholeProject';
  readonly trackIds: readonly TrackId[];
}

export interface TimeRangeScope extends TickRange {
  readonly type: 'timeRange';
  readonly trackIds: readonly TrackId[];
}

export type TaskScope = WholeProjectScope | TimeRangeScope;

const TRACK_ID_SET: ReadonlySet<string> = new Set(TRACK_IDS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTrackIdArray = (value: unknown): value is TrackId[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  const uniqueTrackIds = new Set<TrackId>();

  for (const item of value) {
    if (!isTrackId(item) || uniqueTrackIds.has(item)) {
      return false;
    }

    uniqueTrackIds.add(item);
  }

  return true;
};

export const isTrackId = (value: unknown): value is TrackId =>
  typeof value === 'string' && TRACK_ID_SET.has(value);

export const isTick = (value: unknown): value is Tick =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= 0;

export const isTickRange = (value: unknown): value is TickRange =>
  isRecord(value) &&
  isTick(value.startTick) &&
  isTick(value.endTick) &&
  value.startTick < value.endTick;

export const isTaskScope = (value: unknown): value is TaskScope => {
  if (!isRecord(value) || !isTrackIdArray(value.trackIds)) {
    return false;
  }

  switch (value.type) {
    case 'wholeProject':
      return true;
    case 'timeRange':
      return isTickRange(value);
    default:
      return false;
  }
};
