import type { CandidateId, ProjectId, TaskId, TaskScope } from '@agent-music/contracts';
import {
  hasExactKeys,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from './guard-utils.js';
import {
  isCandidateDisplayState,
  isCoreBootstrapState,
  isCurrentDisplayState,
  isProjectDisplayState,
  isRendererTaskScope,
  isStructuredUiError,
  isTaskDisplayState,
  type CandidateDisplayState,
  type CoreBootstrapState,
  type CurrentDisplayState,
  type ProjectDisplayState,
  type StructuredUiError,
  type TaskDisplayState,
} from './state.js';
import { isTimelineViewModel, type TimelineViewModel } from './timeline.js';

export type PreviewSource =
  | Readonly<{ kind: 'current' }>
  | Readonly<{ kind: 'candidate'; candidateId: CandidateId }>;

export type CurrentExportFormat = 'abc' | 'midi' | 'wav';

export type RendererCommand =
  | Readonly<{
      type: 'createScope';
      requestId: string;
      projectId: ProjectId;
      scope: TaskScope;
    }>
  | Readonly<{
      type: 'startTask';
      requestId: string;
      projectId: ProjectId;
      prompt: string;
      scope: TaskScope;
      scopeRevision: number;
    }>
  | Readonly<{
      type: 'cancelTask';
      requestId: string;
      projectId: ProjectId;
      taskId: TaskId;
    }>
  | Readonly<{
      type: 'acceptCandidate';
      requestId: string;
      projectId: ProjectId;
      candidateId: CandidateId;
    }>
  | Readonly<{
      type: 'rejectCandidate';
      requestId: string;
      projectId: ProjectId;
      candidateId: CandidateId;
    }>
  | Readonly<{
      type: 'loadPreview';
      requestId: string;
      projectId: ProjectId;
      source: PreviewSource;
    }>
  | Readonly<{
      type: 'exportCurrent';
      requestId: string;
      projectId: ProjectId;
      format: CurrentExportFormat;
      suggestedName: string;
    }>;

interface CoreEventEnvelope {
  readonly projectId: ProjectId;
  readonly sequence: number;
}

export type CoreEvent =
  | (CoreEventEnvelope &
      Readonly<{ type: 'bootstrapChanged'; state: CoreBootstrapState }>)
  | (CoreEventEnvelope &
      Readonly<{
        type: 'projectChanged';
        project: ProjectDisplayState;
        current: CurrentDisplayState;
        timeline: TimelineViewModel | null;
      }>)
  | (CoreEventEnvelope &
      Readonly<{
        type: 'currentChanged';
        current: CurrentDisplayState;
        timeline: TimelineViewModel | null;
      }>)
  | (CoreEventEnvelope &
      Readonly<{
        type: 'timelineChanged';
        source: PreviewSource;
        timeline: TimelineViewModel;
      }>)
  | (CoreEventEnvelope &
      Readonly<{ type: 'taskChanged'; task: TaskDisplayState }>)
  | (CoreEventEnvelope &
      Readonly<{
        type: 'candidateChanged';
        candidate: CandidateDisplayState;
      }>)
  | (CoreEventEnvelope &
      Readonly<{ type: 'errorOccurred'; error: StructuredUiError }>);

const isRequestEnvelope = (value: Record<string, unknown>): boolean =>
  isNonEmptyString(value.requestId) && isNonEmptyString(value.projectId);

const isPreviewSource = (value: unknown): value is PreviewSource => {
  if (!isRecord(value)) return false;

  return value.kind === 'current'
    ? hasExactKeys(value, ['kind'])
    : value.kind === 'candidate' &&
        hasExactKeys(value, ['kind', 'candidateId']) &&
        isNonEmptyString(value.candidateId);
};

const isSuggestedFileName = (value: unknown): value is string =>
  isNonEmptyString(value) &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\');

export const isRendererCommand = (value: unknown): value is RendererCommand => {
  if (!isRecord(value) || !isRequestEnvelope(value)) return false;

  switch (value.type) {
    case 'createScope':
      return (
        hasExactKeys(value, ['type', 'requestId', 'projectId', 'scope']) &&
        isRendererTaskScope(value.scope)
      );
    case 'startTask':
      return (
        hasExactKeys(value, [
          'type',
          'requestId',
          'projectId',
          'prompt',
          'scope',
          'scopeRevision',
        ]) &&
        isNonEmptyString(value.prompt) &&
        isRendererTaskScope(value.scope) &&
        isPositiveInteger(value.scopeRevision)
      );
    case 'cancelTask':
      return (
        hasExactKeys(value, ['type', 'requestId', 'projectId', 'taskId']) &&
        isNonEmptyString(value.taskId)
      );
    case 'acceptCandidate':
    case 'rejectCandidate':
      return (
        hasExactKeys(value, [
          'type',
          'requestId',
          'projectId',
          'candidateId',
        ]) && isNonEmptyString(value.candidateId)
      );
    case 'loadPreview':
      return (
        hasExactKeys(value, ['type', 'requestId', 'projectId', 'source']) &&
        isPreviewSource(value.source)
      );
    case 'exportCurrent':
      return (
        hasExactKeys(value, [
          'type',
          'requestId',
          'projectId',
          'format',
          'suggestedName',
        ]) &&
        (value.format === 'abc' ||
          value.format === 'midi' ||
          value.format === 'wav') &&
        isSuggestedFileName(value.suggestedName)
      );
    default:
      return false;
  }
};

const isCoreEventEnvelope = (value: Record<string, unknown>): boolean =>
  isNonEmptyString(value.projectId) && isPositiveInteger(value.sequence);

const isTimelineOrNull = (value: unknown): value is TimelineViewModel | null =>
  value === null || isTimelineViewModel(value);

const projectMatchesEnvelope = (
  project: ProjectDisplayState,
  projectId: unknown,
): boolean =>
  (project.status !== 'open' && project.status !== 'blocked') ||
  project.projectId === null ||
  project.projectId === projectId;

export const isCoreEvent = (value: unknown): value is CoreEvent => {
  if (!isRecord(value) || !isCoreEventEnvelope(value)) return false;

  switch (value.type) {
    case 'bootstrapChanged':
      return (
        hasExactKeys(value, ['type', 'projectId', 'sequence', 'state']) &&
        isCoreBootstrapState(value.state) &&
        value.state.sequence === value.sequence &&
        projectMatchesEnvelope(value.state.project, value.projectId)
      );
    case 'projectChanged':
      return (
        hasExactKeys(value, [
          'type',
          'projectId',
          'sequence',
          'project',
          'current',
          'timeline',
        ]) &&
        isProjectDisplayState(value.project) &&
        projectMatchesEnvelope(value.project, value.projectId) &&
        isCurrentDisplayState(value.current) &&
        isTimelineOrNull(value.timeline)
      );
    case 'currentChanged':
      return (
        hasExactKeys(value, [
          'type',
          'projectId',
          'sequence',
          'current',
          'timeline',
        ]) &&
        isCurrentDisplayState(value.current) &&
        isTimelineOrNull(value.timeline)
      );
    case 'timelineChanged':
      return (
        hasExactKeys(value, [
          'type',
          'projectId',
          'sequence',
          'source',
          'timeline',
        ]) &&
        isPreviewSource(value.source) &&
        isTimelineViewModel(value.timeline)
      );
    case 'taskChanged':
      return (
        hasExactKeys(value, ['type', 'projectId', 'sequence', 'task']) &&
        isTaskDisplayState(value.task)
      );
    case 'candidateChanged':
      return (
        hasExactKeys(value, ['type', 'projectId', 'sequence', 'candidate']) &&
        isCandidateDisplayState(value.candidate)
      );
    case 'errorOccurred':
      return (
        hasExactKeys(value, ['type', 'projectId', 'sequence', 'error']) &&
        isStructuredUiError(value.error)
      );
    default:
      return false;
  }
};
