import type {
  CandidateEvent,
  CandidateView,
  ProjectId,
  TaskContextView,
} from '@agent-music/contracts';
import type {
  CandidateDisplayState,
  CoreEvent,
  CoreBootstrapState,
  StructuredUiError,
  TaskDisplayState,
} from '../b-contracts/index.js';

export interface CandidateEventProjection {
  readonly events: readonly CoreEvent[];
  /**
   * A3 confirms a new Current revision without exposing its music payload.
   * The caller must read B3's authoritative Current bundle before rendering
   * or playing it; projecting the old timeline would be a stale preview.
   */
  readonly currentReloadRequired: boolean;
}

const eventError = (code: string, message: string): StructuredUiError => ({
  code,
  title: 'Candidate needs attention',
  message,
  currentSafety: 'safe',
  candidateAvailability: 'unavailable',
  nextAction: 'Review the Candidate status and try again.',
});

const taskDisplay = (task: TaskContextView): TaskDisplayState => ({
  status: 'active',
  taskId: task.taskId,
  stage: task.state === 'validating' ? 'validating' : 'editing',
  title: 'Creating Candidate',
  detail:
    task.state === 'validating'
      ? 'Validating the staged arrangement.'
      : 'Preparing an isolated Candidate.',
  scope: task.scope,
  scopeRevision: task.scopeRevision,
  cancellable: task.state === 'editing',
});

const candidateDisplay = (
  candidate: CandidateView,
  task: TaskDisplayState,
): CandidateDisplayState => {
  const taskId = task.status === 'active' ? task.taskId : undefined;
  if (taskId === undefined) return { status: 'none' };
  return candidate.state === 'ready'
    ? {
        status: 'ready',
        candidateId: candidate.candidateId,
        taskId,
        summary: 'Candidate is ready to review.',
      }
    : {
        status: 'building',
        candidateId: candidate.candidateId,
        taskId,
        summary: 'Candidate is being prepared in isolation.',
      };
};

/**
 * Projects the public A3 event stream into the Renderer's product state.
 * It intentionally cannot manufacture a Candidate timeline: actual audition
 * is enabled only after the upcoming A4 completion event supplies real music.
 */
export const projectCandidateEvents = (
  projectId: ProjectId,
  bootstrap: CoreBootstrapState,
  candidateEvents: readonly CandidateEvent[],
): CandidateEventProjection => {
  let sequence = bootstrap.sequence;
  let task = bootstrap.task;
  const events: CoreEvent[] = [];
  let currentReloadRequired = false;
  const nextSequence = (): number => ++sequence;

  for (const event of candidateEvents) {
    switch (event.type) {
      case 'task.changed': {
        task =
          event.task === undefined
            ? { status: 'idle' }
            : taskDisplay(event.task);
        events.push({
          type: 'taskChanged',
          projectId,
          sequence: nextSequence(),
          task,
        });
        break;
      }
      case 'candidate.changed':
        events.push({
          type: 'candidateChanged',
          projectId,
          sequence: nextSequence(),
          candidate:
            event.candidate === undefined
              ? { status: 'none' }
              : candidateDisplay(event.candidate, task),
        });
        break;
      case 'candidate.currentCommitted':
        currentReloadRequired = true;
        task = { status: 'idle' };
        events.push(
          {
            type: 'taskChanged',
            projectId,
            sequence: nextSequence(),
            task,
          },
          {
            type: 'candidateChanged',
            projectId,
            sequence: nextSequence(),
            candidate: { status: 'none' },
          },
        );
        break;
      case 'candidate.invalidated':
        task = { status: 'idle' };
        events.push(
          {
            type: 'taskChanged',
            projectId,
            sequence: nextSequence(),
            task,
          },
          {
            type: 'candidateChanged',
            projectId,
            sequence: nextSequence(),
            candidate: { status: 'none' },
          },
        );
        break;
      case 'candidate.failed':
        events.push({
          type: 'errorOccurred',
          projectId,
          sequence: nextSequence(),
          error: eventError(event.code, event.message),
        });
        break;
      case 'candidate.scopeExtensionRequested':
      case 'candidate.validationResult':
        // Scope is P1. Preserve safety without surfacing a partial scope UI.
        events.push({
          type: 'errorOccurred',
          projectId,
          sequence: nextSequence(),
          error: eventError(
            'CANDIDATE_REVIEW_REQUIRED',
            'Candidate needs additional review before it can be applied.',
          ),
        });
        break;
    }
  }
  return { events, currentReloadRequired };
};
