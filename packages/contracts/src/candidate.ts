import {
  TRACK_IDS,
  isTaskScope,
  type CandidateId,
  type ProjectId,
  type TaskId,
  type TaskScope,
} from './domain.js';

declare const scopeExtensionRequestIdBrand: unique symbol;

export type ScopeExtensionRequestId = string & {
  readonly [scopeExtensionRequestIdBrand]: true;
};

export type CandidateState = 'active' | 'ready' | 'accepting' | 'stale';
export type TaskState = 'editing' | 'validating';
export type CandidateOperation = 'replaceScopedMusic' | 'updateGlobalMeter';

export interface TaskExecutionEnvelope {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly candidateId: CandidateId;
  readonly baseRevision: string;
  readonly expectedScopeRevision: number;
}

export interface CandidateView {
  readonly candidateId: CandidateId;
  readonly projectId: ProjectId;
  readonly baseRevision: string;
  readonly state: CandidateState;
}

export interface TaskContextView {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly candidateId: CandidateId;
  readonly baseRevision: string;
  readonly scope: TaskScope;
  readonly scopeRevision: number;
  readonly state: TaskState;
  readonly candidateState: CandidateState;
  readonly allowedOperations: readonly CandidateOperation[];
  readonly trackIds: typeof TRACK_IDS;
  readonly createdAt: string;
}

export interface PendingScopeExtensionView {
  readonly taskId: TaskId;
  readonly requestId: ScopeExtensionRequestId;
  readonly fromScopeRevision: number;
  readonly requestedScope: TaskScope;
}

export interface CandidateValidationIssue {
  readonly code: string;
  readonly message: string;
}

export interface CandidateValidationReport {
  readonly valid: boolean;
  readonly issues: readonly CandidateValidationIssue[];
}

export interface FinishTaskResult {
  readonly candidate: CandidateView;
  readonly validation: CandidateValidationReport;
}

export interface CurrentCommittedResult {
  readonly projectId: ProjectId;
  readonly candidateId: CandidateId;
  readonly currentRevision: string;
}

export interface CandidateRecoveryReport {
  readonly cleanedCandidateIds: readonly CandidateId[];
  readonly pendingCandidateIds: readonly CandidateId[];
  readonly orphanCandidateIds: readonly CandidateId[];
}

export const CANDIDATE_ERROR_CODES = [
  'TASK_BUSY',
  'TASK_NOT_ACTIVE',
  'TASK_PROJECT_MISMATCH',
  'TASK_CANDIDATE_MISMATCH',
  'TASK_BASE_REVISION_MISMATCH',
  'TASK_SCOPE_EXTENSION_PENDING',
  'STALE_SCOPE_REVISION',
  'STALE_SCOPE_EXTENSION_REQUEST',
  'SCOPE_EXTENSION_NOT_SUPERSET',
  'OPERATION_NOT_ALLOWED',
  'CANDIDATE_NOT_FOUND',
  'CANDIDATE_NOT_READY',
  'CANDIDATE_STALE',
  'CURRENT_NOT_CLEAN',
  'CANDIDATE_BASELINE_CHANGED',
  'UNEXPECTED_CANDIDATE_CHANGE',
  'VALIDATION_FAILED',
  'CANDIDATE_TRANSACTION_FAILED',
  'ORPHAN_CANDIDATE_RESOURCE',
] as const;

export type CandidateErrorCode = (typeof CANDIDATE_ERROR_CODES)[number];

interface CandidateCommandBase {
  readonly requestId: string;
}

export type CandidateCommand =
  | (CandidateCommandBase & {
      readonly type: 'candidate.startTask';
      readonly projectId: ProjectId;
      readonly scope: TaskScope;
    })
  | (CandidateCommandBase & {
      readonly type: 'candidate.cancelTask';
      readonly projectId: ProjectId;
      readonly candidateId: CandidateId;
      readonly taskId: TaskId;
    })
  | (CandidateCommandBase & {
      readonly type: 'candidate.cancelActiveTaskForAgentLoss';
      readonly projectId: ProjectId;
    })
  | (CandidateCommandBase & {
      readonly type: 'candidate.approveScopeExtension';
      readonly taskId: TaskId;
      readonly requestIdToApprove: ScopeExtensionRequestId;
    })
  | (CandidateCommandBase & {
      readonly type: 'candidate.rejectScopeExtension';
      readonly taskId: TaskId;
      readonly requestIdToReject: ScopeExtensionRequestId;
    })
  | (CandidateCommandBase & {
      readonly type: 'candidate.accept';
      readonly projectId: ProjectId;
      readonly candidateId: CandidateId;
    })
  | (CandidateCommandBase & {
      readonly type: 'candidate.reject';
      readonly projectId: ProjectId;
      readonly candidateId: CandidateId;
    });

interface CandidateEventBase {
  readonly requestId: string;
  readonly sequence: number;
}

export type CandidateEvent =
  | (CandidateEventBase & {
      readonly type: 'candidate.changed';
      readonly candidate?: CandidateView | undefined;
    })
  | (CandidateEventBase & {
      readonly type: 'task.changed';
      readonly task?: TaskContextView | undefined;
    })
  | (CandidateEventBase & {
      readonly type: 'candidate.scopeExtensionRequested';
      readonly request: PendingScopeExtensionView;
    })
  | (CandidateEventBase & {
      readonly type: 'candidate.validationResult';
      readonly taskId: TaskId;
      readonly candidateId: CandidateId;
      readonly validation: CandidateValidationReport;
    })
  | (CandidateEventBase & {
      readonly type: 'candidate.currentCommitted';
      readonly result: CurrentCommittedResult;
    })
  | (CandidateEventBase & {
      readonly type: 'candidate.invalidated';
      readonly candidateId: CandidateId;
    })
  | (CandidateEventBase & {
      readonly type: 'candidate.failed';
      readonly code: CandidateErrorCode;
      readonly message: string;
      readonly details?: Readonly<Record<string, unknown>>;
    });

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const isTaskExecutionEnvelope = (
  value: unknown,
): value is TaskExecutionEnvelope =>
  isRecord(value) &&
  isUuid(value.taskId) &&
  isUuid(value.projectId) &&
  isUuid(value.candidateId) &&
  typeof value.baseRevision === 'string' &&
  value.baseRevision.length > 0 &&
  isNonNegativeInteger(value.expectedScopeRevision);

export const isCandidateCommand = (
  value: unknown,
): value is CandidateCommand => {
  if (!isRecord(value) || typeof value.requestId !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'candidate.startTask':
      return isUuid(value.projectId) && isTaskScope(value.scope);
    case 'candidate.cancelTask':
      return (
        isUuid(value.projectId) &&
        isUuid(value.candidateId) &&
        isUuid(value.taskId)
      );
    case 'candidate.cancelActiveTaskForAgentLoss':
      return isUuid(value.projectId);
    case 'candidate.approveScopeExtension':
      return isUuid(value.taskId) && isUuid(value.requestIdToApprove);
    case 'candidate.rejectScopeExtension':
      return isUuid(value.taskId) && isUuid(value.requestIdToReject);
    case 'candidate.accept':
    case 'candidate.reject':
      return isUuid(value.projectId) && isUuid(value.candidateId);
    default:
      return false;
  }
};
