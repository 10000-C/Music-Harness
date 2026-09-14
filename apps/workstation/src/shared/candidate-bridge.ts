import {
  isCandidateCommand,
  type CandidateCommand,
  type CandidateEvent,
  type CandidateId,
  type CandidateView,
  type ProjectId,
  type TaskContextView,
} from '@agent-music/contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const isProjectId = (value: unknown): value is ProjectId =>
  typeof value === 'string' && UUID_PATTERN.test(value);
export const isCandidatePlaybackSnapshotReference = (
  value: unknown,
): value is CandidatePlaybackSnapshotReference => {
  if (!isRecord(value)) return false;
  return (
    typeof value.candidateId === 'string' &&
    UUID_PATTERN.test(value.candidateId) &&
    typeof value.revision === 'string' &&
    value.revision.length > 0
  );
};
const isCandidatePlaybackSnapshotReferenceOrNull = (
  value: unknown,
): value is CandidatePlaybackSnapshotReference | null =>
  value === null || isCandidatePlaybackSnapshotReference(value);
const isSequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export const isCandidateEvent = (value: unknown): value is CandidateEvent => {
  if (
    !isRecord(value) ||
    !isRequestId(value.requestId) ||
    !isSequence(value.sequence)
  )
    return false;
  switch (value.type) {
    case 'candidate.changed':
      return (
        (hasOnlyKeys(value, ['type', 'requestId', 'sequence']) ||
          hasOnlyKeys(value, ['type', 'requestId', 'sequence', 'candidate'])) &&
        (value.candidate === undefined || isRecord(value.candidate))
      );
    case 'task.changed':
      return (
        (hasOnlyKeys(value, ['type', 'requestId', 'sequence']) ||
          hasOnlyKeys(value, ['type', 'requestId', 'sequence', 'task'])) &&
        (value.task === undefined || isRecord(value.task))
      );
    case 'candidate.scopeExtensionRequested':
      return (
        hasOnlyKeys(value, ['type', 'requestId', 'sequence', 'request']) &&
        isRecord(value.request)
      );
    case 'candidate.validationResult':
      return (
        hasOnlyKeys(value, [
          'type',
          'requestId',
          'sequence',
          'taskId',
          'candidateId',
          'validation',
        ]) && isRecord(value.validation)
      );
    case 'candidate.currentCommitted':
      return (
        hasOnlyKeys(value, ['type', 'requestId', 'sequence', 'result']) &&
        isRecord(value.result)
      );
    case 'candidate.invalidated':
      return (
        hasOnlyKeys(value, ['type', 'requestId', 'sequence', 'candidateId']) &&
        typeof value.candidateId === 'string'
      );
    case 'candidate.failed':
      return (
        (hasOnlyKeys(value, [
          'type',
          'requestId',
          'sequence',
          'code',
          'message',
        ]) ||
          hasOnlyKeys(value, [
            'type',
            'requestId',
            'sequence',
            'code',
            'message',
            'details',
          ])) &&
        typeof value.code === 'string' &&
        typeof value.message === 'string'
      );
    default:
      return false;
  }
};

/**
 * Candidate control is deliberately a separate Core message family. Renderer
 * code never receives a Candidate worktree, branch, or checkpoint detail.
 */
export type CoreCandidateRequest = Readonly<{
  type: 'candidateCommand';
  protocolVersion: 1;
  command: CandidateCommand;
}>;

export type CoreCandidateResponse = Readonly<{
  type: 'candidateEvents';
  protocolVersion: 1;
  requestId: string;
  events: readonly CandidateEvent[];
}>;

/**
 * The minimal Core → Main/Preload seam for bootstrapping Candidate state.
 * Core implementation and event emission remain an A-side handoff.
 */
export type CandidateStateSnapshot = Readonly<{
  projectId: ProjectId;
  sequence: number;
  candidate: CandidateView | null;
  task: TaskContextView | null;
  /**
   * Core-owned version of the compiled Candidate playback snapshot. This is
   * intentionally separate from CandidateView.baseRevision: a Candidate may
   * be regenerated while its base Current revision stays unchanged.
   */
  candidatePlaybackSnapshot: CandidatePlaybackSnapshotReference | null;
}>;

/**
 * Renderer usage: build RuntimeSource from this reference, never from
 * CandidateView.baseRevision. A null reference means the Candidate has no
 * readable playback snapshot yet.
 */
export type CandidatePlaybackSnapshotReference = Readonly<{
  candidateId: CandidateId;
  revision: string;
}>;

export type CoreCandidateStateRequest = Readonly<{
  type: 'candidateState.read';
  protocolVersion: 1;
  requestId: string;
  projectId: ProjectId;
}>;

export type CoreCandidateStateResponse =
  | Readonly<{
      type: 'candidateState.readResult';
      protocolVersion: 1;
      requestId: string;
      state: CandidateStateSnapshot;
    }>
  | Readonly<{
      type: 'candidateState.readFailed';
      protocolVersion: 1;
      requestId: string;
      code: string;
      userMessage: string;
    }>;

/** Unsolicited Candidate/Task event notification, scoped to one project. */
export type CoreCandidateEventNotification = Readonly<{
  type: 'candidateState.event';
  protocolVersion: 1;
  projectId: ProjectId;
  event: CandidateEvent;
  /** Snapshot version after applying this event; null when no Candidate exists. */
  candidatePlaybackSnapshot: CandidatePlaybackSnapshotReference | null;
}>;

export const isCoreCandidateStateRequest = (
  value: unknown,
): value is CoreCandidateStateRequest =>
  isRecord(value) &&
  value.type === 'candidateState.read' &&
  value.protocolVersion === 1 &&
  isRequestId(value.requestId) &&
  isProjectId(value.projectId) &&
  Object.keys(value).length === 4;

export const isCoreCandidateStateResponse = (
  value: unknown,
): value is CoreCandidateStateResponse => {
  if (
    !isRecord(value) ||
    value.protocolVersion !== 1 ||
    !isRequestId(value.requestId)
  )
    return false;
  if (value.type === 'candidateState.readFailed') {
    return (
      hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'requestId',
        'code',
        'userMessage',
      ]) &&
      typeof value.code === 'string' &&
      value.code.length > 0 &&
      typeof value.userMessage === 'string' &&
      value.userMessage.length > 0
    );
  }
  if (
    value.type !== 'candidateState.readResult' ||
    !isRecord(value.state) ||
    !isProjectId(value.state.projectId) ||
    !isSequence(value.state.sequence) ||
    !(value.state.candidate === null || isRecord(value.state.candidate)) ||
    !(value.state.task === null || isRecord(value.state.task)) ||
    !isCandidatePlaybackSnapshotReferenceOrNull(
      value.state.candidatePlaybackSnapshot,
    )
  )
    return false;
  if (
    value.state.candidatePlaybackSnapshot !== null &&
    typeof value.state.candidate?.candidateId === 'string' &&
    value.state.candidatePlaybackSnapshot.candidateId !==
      value.state.candidate.candidateId
  )
    return false;
  return hasOnlyKeys(value, ['type', 'protocolVersion', 'requestId', 'state']);
};

export const isCoreCandidateEventNotification = (
  value: unknown,
): value is CoreCandidateEventNotification => {
  if (
    !isRecord(value) ||
    value.type !== 'candidateState.event' ||
    value.protocolVersion !== 1 ||
    !isProjectId(value.projectId) ||
    !isCandidateEvent(value.event) ||
    !isCandidatePlaybackSnapshotReferenceOrNull(
      value.candidatePlaybackSnapshot,
    ) ||
    Object.keys(value).length !== 5
  )
    return false;
  if (
    value.event.type === 'candidate.changed' &&
    value.event.candidate !== undefined &&
    value.candidatePlaybackSnapshot !== null &&
    value.candidatePlaybackSnapshot.candidateId !==
      value.event.candidate.candidateId
  )
    return false;
  return true;
};

export const isCoreCandidateRequest = (
  value: unknown,
): value is CoreCandidateRequest =>
  isRecord(value) &&
  value.type === 'candidateCommand' &&
  value.protocolVersion === 1 &&
  Object.keys(value).length === 3 &&
  isCandidateCommand(value.command);

/**
 * CandidateEvent is emitted only by the trusted Core process. Validate every
 * event envelope before it crosses Main or Preload, while preserving the
 * complete typed payload for the Renderer-facing adapter to interpret.
 */
export const isCoreCandidateResponse = (
  value: unknown,
): value is CoreCandidateResponse =>
  isRecord(value) &&
  value.type === 'candidateEvents' &&
  value.protocolVersion === 1 &&
  isRequestId(value.requestId) &&
  Array.isArray(value.events) &&
  value.events.every(isCandidateEvent) &&
  Object.keys(value).length === 4;
