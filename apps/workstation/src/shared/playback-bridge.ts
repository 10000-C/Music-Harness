import {
  isPlaybackCompilation,
  isTimelineViewModel,
  type PlaybackCompilation,
  type TimelineViewModel,
} from '@agent-music/contracts';
import type { CandidateId, ProjectId } from '@agent-music/contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Read-only B3 request. It deliberately exposes only authoritative Current. */
export type CorePlaybackRequest = Readonly<{
  type: 'playback.readCurrent';
  protocolVersion: 1;
  requestId: string;
}>;

export type CorePlaybackResponse =
  | Readonly<{
      type: 'playback.current';
      protocolVersion: 1;
      requestId: string;
      revision: string;
      compilation: PlaybackCompilation;
      timeline: TimelineViewModel;
    }>
  | Readonly<{
      type: 'playback.failed';
      protocolVersion: 1;
      requestId: string;
      code: 'CURRENT_UNAVAILABLE' | 'COMPILATION_FAILED';
      userMessage: string;
    }>;

export type PlaybackSnapshotSource =
  | Readonly<{ kind: 'current'; revision: string }>
  | Readonly<{
      kind: 'candidate';
      candidateId: CandidateId;
      revision: string;
    }>;

export type CorePlaybackSnapshotRequest = Readonly<{
  type: 'playback.readSnapshot';
  protocolVersion: 1;
  requestId: string;
  projectId: ProjectId;
  source: PlaybackSnapshotSource;
}>;

export type CorePlaybackSnapshot = Readonly<{
  type: 'playback.snapshot';
  protocolVersion: 1;
  requestId: string;
  projectId: ProjectId;
  source: PlaybackSnapshotSource;
  revision: string;
  compilation: PlaybackCompilation;
  timeline: TimelineViewModel;
}>;

export type CorePlaybackSnapshotResponse =
  | CorePlaybackSnapshot
  | Readonly<{
      type: 'playback.snapshotFailed';
      protocolVersion: 1;
      requestId: string;
      code:
        'CURRENT_UNAVAILABLE' | 'CANDIDATE_UNAVAILABLE' | 'COMPILATION_FAILED';
      userMessage: string;
    }>;

const isPlaybackSnapshotSource = (
  value: unknown,
): value is PlaybackSnapshotSource => {
  if (typeof value !== 'object' || value === null) return false;
  const source = value as {
    kind?: unknown;
    revision?: unknown;
    candidateId?: unknown;
  };
  if (
    (source.kind !== 'current' && source.kind !== 'candidate') ||
    typeof source.revision !== 'string' ||
    source.revision.length === 0
  )
    return false;
  return (
    source.kind === 'current' ||
    (typeof source.candidateId === 'string' &&
      UUID_PATTERN.test(source.candidateId))
  );
};

export { isPlaybackSnapshotSource };

export const isCorePlaybackSnapshotRequest = (
  value: unknown,
): value is CorePlaybackSnapshotRequest =>
  isRecord(value) &&
  value.type === 'playback.readSnapshot' &&
  value.protocolVersion === 1 &&
  isRequestId(value.requestId) &&
  typeof value.projectId === 'string' &&
  UUID_PATTERN.test(value.projectId) &&
  isPlaybackSnapshotSource(value.source) &&
  Object.keys(value).length === 5;

export const isCorePlaybackSnapshotResponse = (
  value: unknown,
): value is CorePlaybackSnapshotResponse => {
  if (
    !isRecord(value) ||
    value.protocolVersion !== 1 ||
    !isRequestId(value.requestId)
  )
    return false;
  if (value.type === 'playback.snapshotFailed') {
    return (
      (value.code === 'CURRENT_UNAVAILABLE' ||
        value.code === 'CANDIDATE_UNAVAILABLE' ||
        value.code === 'COMPILATION_FAILED') &&
      typeof value.userMessage === 'string' &&
      value.userMessage.length > 0 &&
      Object.keys(value).length === 5
    );
  }
  return (
    value.type === 'playback.snapshot' &&
    typeof value.projectId === 'string' &&
    UUID_PATTERN.test(value.projectId) &&
    isPlaybackSnapshotSource(value.source) &&
    typeof value.revision === 'string' &&
    value.revision.length > 0 &&
    isPlaybackCompilation(value.compilation) &&
    isTimelineViewModel(value.timeline) &&
    Object.keys(value).length === 8
  );
};

export const isCorePlaybackRequest = (
  value: unknown,
): value is CorePlaybackRequest =>
  isRecord(value) &&
  value.type === 'playback.readCurrent' &&
  value.protocolVersion === 1 &&
  isRequestId(value.requestId) &&
  Object.keys(value).length === 3;

export const isCorePlaybackResponse = (
  value: unknown,
): value is CorePlaybackResponse =>
  isRecord(value) && value.protocolVersion === 1 && isRequestId(value.requestId)
    ? value.type === 'playback.current'
      ? typeof value.revision === 'string' &&
        value.revision.length > 0 &&
        isPlaybackCompilation(value.compilation) &&
        isTimelineViewModel(value.timeline) &&
        Object.keys(value).length === 6
      : value.type === 'playback.failed' &&
        (value.code === 'CURRENT_UNAVAILABLE' ||
          value.code === 'COMPILATION_FAILED') &&
        typeof value.userMessage === 'string' &&
        value.userMessage.length > 0 &&
        Object.keys(value).length === 5
    : false;
