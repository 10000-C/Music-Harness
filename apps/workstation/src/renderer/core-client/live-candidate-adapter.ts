import type {
  CandidateCommand,
  CandidateEvent,
  CandidateId,
  CandidateView,
  ProjectId,
  TaskContextView,
  TaskScope,
} from '@agent-music/contracts';
import type { CandidateCommandResult } from '../../shared/shell-contracts.js';
import type { DesktopBridge } from '../../shared/desktop-bridge.js';

export type LiveCandidateStatus = 'none' | 'building' | 'ready' | 'failed';

export interface LiveCandidateState {
  readonly status: LiveCandidateStatus;
  readonly projectId: ProjectId;
  readonly candidate: CandidateView | null;
  readonly task: TaskContextView | null;
  readonly error: Readonly<{ code: string; message: string }> | null;
  readonly committedRevision: string | null;
}

export type LiveCandidateAction = Readonly<{
  type: 'events';
  events: readonly CandidateEvent[];
}>;

const initialState = (projectId: ProjectId): LiveCandidateState => ({
  status: 'none',
  projectId,
  candidate: null,
  task: null,
  error: null,
  committedRevision: null,
});

const candidateStatus = (candidate: CandidateView): LiveCandidateStatus =>
  candidate.state === 'ready' ? 'ready' : 'building';

/**
 * Projects only the public Candidate events that belong to this project.
 * Candidate worktree contents and playback payloads intentionally never enter
 * this state; those remain separate authoritative Core contracts.
 */
export const reduceLiveCandidateState = (
  state: LiveCandidateState,
  action: LiveCandidateAction,
): LiveCandidateState => {
  let next = state;
  for (const event of action.events) {
    switch (event.type) {
      case 'task.changed':
        if (
          event.task !== undefined &&
          event.task.projectId !== state.projectId
        )
          continue;
        next = {
          ...next,
          task: event.task ?? null,
          error: null,
          ...(event.task === undefined && next.candidate === null
            ? { status: 'none' as const }
            : {}),
        };
        break;
      case 'candidate.changed':
        if (
          event.candidate !== undefined &&
          event.candidate.projectId !== state.projectId
        )
          continue;
        next = {
          ...next,
          candidate: event.candidate ?? null,
          status:
            event.candidate === undefined
              ? 'none'
              : candidateStatus(event.candidate),
          error: null,
        };
        break;
      case 'candidate.currentCommitted':
        if (event.result.projectId !== state.projectId) continue;
        next = {
          ...next,
          status: 'none',
          candidate: null,
          task: null,
          error: null,
          committedRevision: event.result.currentRevision,
        };
        break;
      case 'candidate.invalidated':
        if (
          next.candidate !== null &&
          next.candidate.candidateId !== event.candidateId
        )
          continue;
        next = {
          ...next,
          status: 'none',
          candidate: null,
          task: null,
          error: null,
        };
        break;
      case 'candidate.failed':
        next = {
          ...next,
          status: 'failed',
          error: { code: event.code, message: event.message },
        };
        break;
      case 'candidate.scopeExtensionRequested':
      case 'candidate.validationResult':
        // Scope approval and validation detail remain out of the P0 UI. Keep
        // the real Candidate state, but make the issue visible to the caller.
        next = {
          ...next,
          error:
            event.type === 'candidate.validationResult' &&
            event.validation.valid === false
              ? {
                  code: 'VALIDATION_FAILED',
                  message:
                    event.validation.issues[0]?.message ??
                    'Candidate validation failed.',
                }
              : {
                  code: 'CANDIDATE_REVIEW_REQUIRED',
                  message: 'Candidate needs additional review.',
                },
        };
        break;
    }
  }
  return next;
};

export interface LiveCandidateAdapter {
  getState(): LiveCandidateState;
  subscribe(listener: (state: LiveCandidateState) => void): () => void;
  applyEvents(events: readonly CandidateEvent[]): void;
  startTask(scope: TaskScope): Promise<readonly CandidateEvent[]>;
  cancelTask(): Promise<readonly CandidateEvent[]>;
  accept(): Promise<readonly CandidateEvent[]>;
  reject(): Promise<readonly CandidateEvent[]>;
  dispose(): void;
}

export interface LiveCandidateAdapterOptions {
  readonly projectId: ProjectId;
  readonly bridge: Pick<DesktopBridge, 'dispatchCandidate'>;
  readonly createRequestId?: () => string;
}

const defaultRequestId = (): string => `candidate-${crypto.randomUUID()}`;

const commandFor = (
  state: LiveCandidateState,
  requestId: string,
  intent:
    | Readonly<{ type: 'startTask'; scope: TaskScope }>
    | Readonly<{ type: 'cancelTask' }>
    | Readonly<{ type: 'accept' }>
    | Readonly<{ type: 'reject' }>,
): CandidateCommand | null => {
  if (intent.type === 'startTask') {
    if (state.status !== 'none') return null;
    return {
      type: 'candidate.startTask',
      requestId,
      projectId: state.projectId,
      scope: intent.scope,
    };
  }
  if (
    (intent.type === 'cancelTask' &&
      (state.candidate === null || state.task === null)) ||
    ((intent.type === 'accept' || intent.type === 'reject') &&
      (state.status !== 'ready' || state.candidate === null))
  )
    return null;
  if (intent.type === 'cancelTask') {
    const candidate = state.candidate;
    const task = state.task;
    if (candidate === null || task === null) return null;
    return {
      type: 'candidate.cancelTask',
      requestId,
      projectId: state.projectId,
      candidateId: candidate.candidateId,
      taskId: task.taskId,
    };
  }
  if (intent.type === 'accept' || intent.type === 'reject') {
    const candidate = state.candidate;
    if (candidate === null) return null;
    return {
      type: intent.type === 'accept' ? 'candidate.accept' : 'candidate.reject',
      requestId,
      projectId: state.projectId,
      candidateId: candidate.candidateId,
    };
  }
  return null;
};

export const createLiveCandidateAdapter = ({
  projectId,
  bridge,
  createRequestId = defaultRequestId,
}: LiveCandidateAdapterOptions): LiveCandidateAdapter => {
  let state = initialState(projectId);
  let disposed = false;
  const listeners = new Set<(value: LiveCandidateState) => void>();

  const publish = (events: readonly CandidateEvent[]): void => {
    if (disposed || events.length === 0) return;
    state = reduceLiveCandidateState(state, { type: 'events', events });
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener(state);
    }
  };

  const execute = async (
    intent:
      | Readonly<{ type: 'startTask'; scope: TaskScope }>
      | Readonly<{ type: 'cancelTask' }>
      | Readonly<{ type: 'accept' }>
      | Readonly<{ type: 'reject' }>,
  ): Promise<readonly CandidateEvent[]> => {
    if (disposed) throw new Error('Candidate adapter has been disposed.');
    const command = commandFor(state, createRequestId(), intent);
    if (command === null) {
      throw new Error('Candidate action is unavailable in the current state.');
    }
    const result: CandidateCommandResult =
      await bridge.dispatchCandidate(command);
    if (!result.ok) throw new Error(result.userMessage);
    publish(result.events);
    return result.events;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyEvents: publish,
    startTask: (scope) => execute({ type: 'startTask', scope }),
    cancelTask: () => execute({ type: 'cancelTask' }),
    accept: () => execute({ type: 'accept' }),
    reject: () => execute({ type: 'reject' }),
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
};
