import {
  isTaskScope,
  type CandidateId,
  type ProjectId,
  type TaskId,
  type TaskScope,
} from '@agent-music/contracts';
import {
  hasExactKeys,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
} from './guard-utils.js';
import { isTimelineViewModel, type TimelineViewModel } from './timeline.js';

export const CORE_BOOTSTRAP_SCHEMA_VERSION = 1 as const;

export const TASK_STAGES = [
  'planning',
  'awaiting_confirmation',
  'preparing_candidate',
  'editing',
  'compiling',
  'validating',
  'repairing',
  'candidate_ready',
] as const;

export type TaskStage = (typeof TASK_STAGES)[number];
export type CurrentSafety = 'safe' | 'unknown' | 'requiresRecovery';
export type CandidateAvailability =
  'available' | 'unavailable' | 'notApplicable' | 'unknown';

export interface StructuredUiError {
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly currentSafety: CurrentSafety;
  readonly candidateAvailability: CandidateAvailability;
  readonly nextAction: string;
}

export type ProjectDisplayState =
  | Readonly<{ status: 'closed' }>
  | Readonly<{ status: 'opening'; displayName: string }>
  | Readonly<{ status: 'open'; projectId: ProjectId; name: string }>
  | Readonly<{
      status: 'blocked';
      projectId: ProjectId | null;
      displayName: string;
      error: StructuredUiError;
    }>;

export type CurrentDisplayState =
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{
      status: 'ready';
      revision: string;
      label: string;
      isEmpty: boolean;
    }>
  | Readonly<{
      status: 'recoveryRequired';
      revision: string | null;
      error: StructuredUiError;
    }>;

export type TaskDisplayState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{
      status: 'active';
      taskId: TaskId;
      stage: TaskStage;
      title: string;
      detail: string;
      scope: TaskScope;
      scopeRevision: number;
      cancellable: boolean;
    }>
  | Readonly<{
      status: 'failed';
      taskId: TaskId;
      title: string;
      scope: TaskScope;
      scopeRevision: number;
      error: StructuredUiError;
    }>;

export type CandidateDisplayState =
  | Readonly<{ status: 'none' }>
  | Readonly<{
      status: 'building';
      candidateId: CandidateId;
      taskId: TaskId;
      summary: string;
    }>
  | Readonly<{
      status: 'ready';
      candidateId: CandidateId;
      taskId: TaskId;
      summary: string;
    }>
  | Readonly<{
      status: 'failed';
      candidateId: CandidateId;
      taskId: TaskId;
      error: StructuredUiError;
    }>;

export interface CoreBootstrapState {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly project: ProjectDisplayState;
  readonly current: CurrentDisplayState;
  readonly task: TaskDisplayState;
  readonly candidate: CandidateDisplayState;
  readonly timeline: TimelineViewModel | null;
  readonly errors: readonly StructuredUiError[];
}

const TASK_STAGE_SET: ReadonlySet<string> = new Set(TASK_STAGES);
const CURRENT_SAFETY_SET: ReadonlySet<string> = new Set([
  'safe',
  'unknown',
  'requiresRecovery',
]);
const CANDIDATE_AVAILABILITY_SET: ReadonlySet<string> = new Set([
  'available',
  'unavailable',
  'notApplicable',
  'unknown',
]);

const isNullableNonEmptyString = (value: unknown): value is string | null =>
  value === null || isNonEmptyString(value);

export const isRendererTaskScope = (value: unknown): value is TaskScope => {
  if (!isRecord(value) || !isTaskScope(value)) return false;

  return value.type === 'wholeProject'
    ? hasExactKeys(value, ['type', 'trackIds'])
    : hasExactKeys(value, ['type', 'trackIds', 'startTick', 'endTick']);
};

export const isStructuredUiError = (
  value: unknown,
): value is StructuredUiError =>
  isRecord(value) &&
  hasExactKeys(value, [
    'code',
    'title',
    'message',
    'currentSafety',
    'candidateAvailability',
    'nextAction',
  ]) &&
  isNonEmptyString(value.code) &&
  isNonEmptyString(value.title) &&
  isNonEmptyString(value.message) &&
  typeof value.currentSafety === 'string' &&
  CURRENT_SAFETY_SET.has(value.currentSafety) &&
  typeof value.candidateAvailability === 'string' &&
  CANDIDATE_AVAILABILITY_SET.has(value.candidateAvailability) &&
  isNonEmptyString(value.nextAction);

export const isProjectDisplayState = (
  value: unknown,
): value is ProjectDisplayState => {
  if (!isRecord(value)) return false;

  switch (value.status) {
    case 'closed':
      return hasExactKeys(value, ['status']);
    case 'opening':
      return (
        hasExactKeys(value, ['status', 'displayName']) &&
        isNonEmptyString(value.displayName)
      );
    case 'open':
      return (
        hasExactKeys(value, ['status', 'projectId', 'name']) &&
        isNonEmptyString(value.projectId) &&
        isNonEmptyString(value.name)
      );
    case 'blocked':
      return (
        hasExactKeys(value, ['status', 'projectId', 'displayName', 'error']) &&
        isNullableNonEmptyString(value.projectId) &&
        isNonEmptyString(value.displayName) &&
        isStructuredUiError(value.error)
      );
    default:
      return false;
  }
};

export const isCurrentDisplayState = (
  value: unknown,
): value is CurrentDisplayState => {
  if (!isRecord(value)) return false;

  switch (value.status) {
    case 'unavailable':
      return hasExactKeys(value, ['status']);
    case 'ready':
      return (
        hasExactKeys(value, ['status', 'revision', 'label', 'isEmpty']) &&
        isNonEmptyString(value.revision) &&
        isNonEmptyString(value.label) &&
        typeof value.isEmpty === 'boolean'
      );
    case 'recoveryRequired':
      return (
        hasExactKeys(value, ['status', 'revision', 'error']) &&
        isNullableNonEmptyString(value.revision) &&
        isStructuredUiError(value.error)
      );
    default:
      return false;
  }
};

export const isTaskDisplayState = (
  value: unknown,
): value is TaskDisplayState => {
  if (!isRecord(value)) return false;

  switch (value.status) {
    case 'idle':
      return hasExactKeys(value, ['status']);
    case 'active':
      return (
        hasExactKeys(value, [
          'status',
          'taskId',
          'stage',
          'title',
          'detail',
          'scope',
          'scopeRevision',
          'cancellable',
        ]) &&
        isNonEmptyString(value.taskId) &&
        typeof value.stage === 'string' &&
        TASK_STAGE_SET.has(value.stage) &&
        isNonEmptyString(value.title) &&
        isNonEmptyString(value.detail) &&
        isRendererTaskScope(value.scope) &&
        isNonNegativeInteger(value.scopeRevision) &&
        typeof value.cancellable === 'boolean'
      );
    case 'failed':
      return (
        hasExactKeys(value, [
          'status',
          'taskId',
          'title',
          'scope',
          'scopeRevision',
          'error',
        ]) &&
        isNonEmptyString(value.taskId) &&
        isNonEmptyString(value.title) &&
        isRendererTaskScope(value.scope) &&
        isNonNegativeInteger(value.scopeRevision) &&
        isStructuredUiError(value.error)
      );
    default:
      return false;
  }
};

export const isCandidateDisplayState = (
  value: unknown,
): value is CandidateDisplayState => {
  if (!isRecord(value)) return false;

  switch (value.status) {
    case 'none':
      return hasExactKeys(value, ['status']);
    case 'building':
    case 'ready':
      return (
        hasExactKeys(value, ['status', 'candidateId', 'taskId', 'summary']) &&
        isNonEmptyString(value.candidateId) &&
        isNonEmptyString(value.taskId) &&
        isNonEmptyString(value.summary)
      );
    case 'failed':
      return (
        hasExactKeys(value, ['status', 'candidateId', 'taskId', 'error']) &&
        isNonEmptyString(value.candidateId) &&
        isNonEmptyString(value.taskId) &&
        isStructuredUiError(value.error)
      );
    default:
      return false;
  }
};

export const isCoreBootstrapState = (
  value: unknown,
): value is CoreBootstrapState =>
  isRecord(value) &&
  hasExactKeys(value, [
    'schemaVersion',
    'sequence',
    'project',
    'current',
    'task',
    'candidate',
    'timeline',
    'errors',
  ]) &&
  value.schemaVersion === CORE_BOOTSTRAP_SCHEMA_VERSION &&
  isNonNegativeInteger(value.sequence) &&
  isProjectDisplayState(value.project) &&
  isCurrentDisplayState(value.current) &&
  isTaskDisplayState(value.task) &&
  isCandidateDisplayState(value.candidate) &&
  (value.timeline === null || isTimelineViewModel(value.timeline)) &&
  Array.isArray(value.errors) &&
  value.errors.every(isStructuredUiError);
