import {
  isCandidateCommand,
  type CandidateCommand,
  type CandidateEvent,
} from '@agent-music/contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const isSequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const isCandidateEvent = (value: unknown): value is CandidateEvent => {
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
