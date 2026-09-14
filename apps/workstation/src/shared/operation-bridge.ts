import type {
  GenerationPlanOperationView,
  OperationId,
  OperationView,
  ProjectId,
  TaskContextView,
} from '@agent-music/contracts';
import { TRACK_IDS, isTaskScope } from '@agent-music/contracts';

/**
 * Core-owned Operation state exposed to B4. The Core decides which Operation
 * records are recoverable for the active Project; Renderer never reads the
 * Operation store directly.
 */
export type CoreOperationStateSnapshot = Readonly<{
  projectId: ProjectId;
  sequence: number;
  operations: readonly OperationView[];
}>;

export type CoreOperationEventNotification = Readonly<{
  type: 'operationState.event';
  protocolVersion: 1;
  projectId: ProjectId;
  sequence: number;
  operation: OperationView;
}>;

export type OperationControlCommand = Readonly<{
  type: 'operation.resolve';
  protocolVersion: 1;
  requestId: string;
  operationId: OperationId;
  decision: 'approve' | 'reject';
}>;

export type OperationControlResult =
  | Readonly<{ ok: true; operation: OperationView }>
  | Readonly<{ ok: false; code: string; userMessage: string }>;

export type OperationStateResult =
  | Readonly<{ ok: true; state: CoreOperationStateSnapshot }>
  | Readonly<{ ok: false; code: string; userMessage: string }>;

/** Core request used by Main to read the recoverable Operation state. */
export type CoreOperationStateRequest = Readonly<{
  type: 'operationState.read';
  protocolVersion: 1;
  requestId: string;
  projectId: ProjectId;
}>;

export type CoreOperationStateResponse =
  | Readonly<{
      type: 'operationState.readResult';
      protocolVersion: 1;
      requestId: string;
      state: CoreOperationStateSnapshot;
    }>
  | Readonly<{
      type: 'operationState.readFailed';
      protocolVersion: 1;
      requestId: string;
      code: string;
      userMessage: string;
    }>;

/** Core response envelope for an approve/reject decision. */
export type CoreOperationControlResponse = Readonly<{
  type: 'operation.resolveResult';
  protocolVersion: 1;
  requestId: string;
  result: OperationControlResult;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isSequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isTaskContextView = (value: unknown): value is TaskContextView => {
  if (!isRecord(value)) return false;
  if (
    !isUuid(value.taskId) ||
    !isUuid(value.projectId) ||
    !isUuid(value.candidateId) ||
    !isNonEmptyString(value.baseRevision) ||
    !isTaskScope(value.scope) ||
    !isSequence(value.scopeRevision) ||
    (value.state !== 'editing' && value.state !== 'validating') ||
    !['active', 'ready', 'accepting', 'stale'].includes(
      value.candidateState as string,
    ) ||
    !Array.isArray(value.allowedOperations) ||
    !value.allowedOperations.every((operation) =>
      [
        'replaceScopedMusic',
        'updateMusicalProperties',
        'resizeComposition',
      ].includes(operation as string),
    ) ||
    !Array.isArray(value.trackIds) ||
    value.trackIds.length !== TRACK_IDS.length ||
    value.trackIds.some((trackId, index) => trackId !== TRACK_IDS[index]) ||
    !isNonEmptyString(value.createdAt)
  )
    return false;
  if (value.pendingScopeExtension !== undefined) {
    if (!isPendingScopeExtensionView(value.pendingScopeExtension)) return false;
  }
  return true;
};

const isPendingScopeExtensionView = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.operationId) &&
    isUuid(value.taskId) &&
    isNonEmptyString(value.requestId) &&
    isSequence(value.fromScopeRevision) &&
    isTaskScope(value.requestedScope) &&
    isNonEmptyString(value.createdAt)
  );
};

const isOperationId = (value: unknown): value is OperationId =>
  isNonEmptyString(value);

const isOperationFailure = (
  value: unknown,
): value is Readonly<{ code: string; message: string }> =>
  isRecord(value) &&
  isNonEmptyString(value.code) &&
  isNonEmptyString(value.message);

const isOperationViewBase = (value: Record<string, unknown>): boolean =>
  isOperationId(value.operationId) &&
  (value.type === 'generationPlan' || value.type === 'scopeExtension') &&
  (value.state === 'pending' ||
    value.state === 'succeeded' ||
    value.state === 'rejected' ||
    value.state === 'cancelled' ||
    value.state === 'failed') &&
  isNonEmptyString(value.createdAt);

/** Validate Operation data before it crosses Main/Preload into Renderer. */
export const isOperationView = (value: unknown): value is OperationView => {
  if (!isRecord(value) || !isOperationViewBase(value)) return false;
  if (value.state === 'failed') return isOperationFailure(value.error);
  if (value.state === 'succeeded') {
    return isRecord(value.result) && isTaskContextView(value.result.task);
  }
  if (value.state === 'pending' && value.type === 'generationPlan') {
    return isNonEmptyString(value.summary) && isTaskScope(value.scope);
  }
  if (value.state === 'pending' && value.type === 'scopeExtension') {
    return (
      value.request === undefined || isPendingScopeExtensionView(value.request)
    );
  }
  return value.state === 'rejected' || value.state === 'cancelled';
};

export const isCoreOperationStateSnapshot = (
  value: unknown,
): value is CoreOperationStateSnapshot =>
  isRecord(value) &&
  isUuid(value.projectId) &&
  isSequence(value.sequence) &&
  Array.isArray(value.operations) &&
  value.operations.every(isOperationView);

export const isCoreOperationEventNotification = (
  value: unknown,
): value is CoreOperationEventNotification =>
  isRecord(value) &&
  value.type === 'operationState.event' &&
  value.protocolVersion === 1 &&
  isUuid(value.projectId) &&
  isSequence(value.sequence) &&
  isOperationView(value.operation);

export const isCoreOperationStateRequest = (
  value: unknown,
): value is CoreOperationStateRequest =>
  isRecord(value) &&
  value.type === 'operationState.read' &&
  value.protocolVersion === 1 &&
  isNonEmptyString(value.requestId) &&
  isUuid(value.projectId) &&
  hasOnlyKeys(value, ['type', 'protocolVersion', 'requestId', 'projectId']);

export const isOperationControlCommand = (
  value: unknown,
): value is OperationControlCommand =>
  isRecord(value) &&
  value.type === 'operation.resolve' &&
  value.protocolVersion === 1 &&
  isNonEmptyString(value.requestId) &&
  isOperationId(value.operationId) &&
  (value.decision === 'approve' || value.decision === 'reject');

const isErrorResult = (value: Record<string, unknown>): boolean =>
  value.ok === false &&
  isNonEmptyString(value.code) &&
  isNonEmptyString(value.userMessage);

export const isOperationControlResult = (
  value: unknown,
): value is OperationControlResult =>
  isRecord(value) &&
  (isErrorResult(value) ||
    (value.ok === true && isOperationView(value.operation)));

export const isCoreOperationStateResponse = (
  value: unknown,
): value is CoreOperationStateResponse => {
  if (
    !isRecord(value) ||
    value.protocolVersion !== 1 ||
    !isNonEmptyString(value.requestId)
  )
    return false;
  if (value.type === 'operationState.readFailed') {
    return (
      hasOnlyKeys(value, [
        'type',
        'protocolVersion',
        'requestId',
        'code',
        'userMessage',
      ]) &&
      isNonEmptyString(value.code) &&
      isNonEmptyString(value.userMessage)
    );
  }
  return (
    value.type === 'operationState.readResult' &&
    hasOnlyKeys(value, ['type', 'protocolVersion', 'requestId', 'state']) &&
    isCoreOperationStateSnapshot(value.state)
  );
};

export const isCoreOperationControlResponse = (
  value: unknown,
): value is CoreOperationControlResponse =>
  isRecord(value) &&
  value.type === 'operation.resolveResult' &&
  value.protocolVersion === 1 &&
  isNonEmptyString(value.requestId) &&
  hasOnlyKeys(value, ['type', 'protocolVersion', 'requestId', 'result']) &&
  isOperationControlResult(value.result);

export const isOperationStateResult = (
  value: unknown,
): value is OperationStateResult =>
  isRecord(value) &&
  (isErrorResult(value) ||
    (value.ok === true && isCoreOperationStateSnapshot(value.state)));

/** The narrow Renderer seam used by the generation-plan confirmation adapter. */
export interface LiveOperationBridge {
  readOperationState(projectId: ProjectId): Promise<OperationStateResult>;
  dispatchOperation(
    command: OperationControlCommand,
  ): Promise<OperationControlResult>;
  onOperationEvent(
    listener: (notification: CoreOperationEventNotification) => void,
  ): () => void;
}

export const generationPlanFromOperations = (
  operations: readonly OperationView[],
): GenerationPlanOperationView | null => {
  let latest: GenerationPlanOperationView | null = null;
  for (const operation of operations) {
    if (operation.type !== 'generationPlan') continue;
    if (operation.state === 'pending') return operation;
    latest = operation;
  }
  return latest;
};
