import type {
  CandidateCommand,
  CandidateEvent,
  CandidateId,
  CandidateView,
  PendingScopeExtensionView,
  ProjectId,
  TaskContextView,
  TaskScope,
} from '@agent-music/contracts';
import type {
  CandidatePlaybackSnapshotReference,
  CandidateStateSnapshot,
  CoreCandidateEventNotification,
} from '../../shared/candidate-bridge.js';
import type {
  CandidateCommandResult,
  CandidateStateResult,
} from '../../shared/shell-contracts.js';
import type { DesktopBridge } from '../../shared/desktop-bridge.js';

export type LiveCandidateStatus = 'none' | 'building' | 'ready' | 'failed';

export interface LiveCandidateState {
  readonly status: LiveCandidateStatus;
  readonly projectId: ProjectId;
  readonly candidate: CandidateView | null;
  readonly task: TaskContextView | null;
  readonly pendingScopeExtension: PendingScopeExtensionView | null;
  readonly candidatePlaybackSnapshot: CandidatePlaybackSnapshotReference | null;
  readonly error: Readonly<{ code: string; message: string }> | null;
  readonly committedRevision: string | null;
}

export type LiveCandidateAction = Readonly<{
  type: 'events';
  events: readonly CandidateEvent[];
  candidatePlaybackSnapshot?: CandidatePlaybackSnapshotReference | null;
}>;

const initialState = (projectId: ProjectId): LiveCandidateState => ({
  status: 'none',
  projectId,
  candidate: null,
  task: null,
  pendingScopeExtension: null,
  candidatePlaybackSnapshot: null,
  error: null,
  committedRevision: null,
});

const candidateStatus = (candidate: CandidateView): LiveCandidateStatus =>
  candidate.state === 'ready' ? 'ready' : 'building';

/**
 * Projects only the public Candidate events that belong to this project.
 * Candidate worktree contents and playback payloads intentionally never enter
 * this state; only the Core-owned playback snapshot reference is projected so
 * playback can request the matching immutable payload.
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
          pendingScopeExtension: event.task?.pendingScopeExtension ?? null,
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
          // Without the Core-owned reference, never retain baseRevision as a
          // playback identity. The next authoritative state/event can restore
          // the reference when its compiled snapshot is available.
          candidatePlaybackSnapshot: null,
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
          pendingScopeExtension: null,
          candidatePlaybackSnapshot: null,
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
          pendingScopeExtension: null,
          candidatePlaybackSnapshot: null,
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
        if (
          next.task === null ||
          next.task.taskId !== event.request.taskId ||
          next.task.projectId !== state.projectId
        )
          continue;
        next = {
          ...next,
          pendingScopeExtension: event.request,
          error: null,
        };
        break;
      case 'candidate.validationResult':
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
  if (
    action.candidatePlaybackSnapshot !== undefined &&
    next.candidatePlaybackSnapshot !== action.candidatePlaybackSnapshot
  ) {
    next = {
      ...next,
      candidatePlaybackSnapshot: action.candidatePlaybackSnapshot,
    };
  }
  return next;
};

export interface LiveCandidateAdapter {
  ready(): Promise<void>;
  getState(): LiveCandidateState;
  subscribe(listener: (state: LiveCandidateState) => void): () => void;
  applyEvents(events: readonly CandidateEvent[]): void;
  startTask(scope: TaskScope): Promise<readonly CandidateEvent[]>;
  cancelTask(): Promise<readonly CandidateEvent[]>;
  accept(): Promise<readonly CandidateEvent[]>;
  reject(): Promise<readonly CandidateEvent[]>;
  approveScopeExtension(): Promise<readonly CandidateEvent[]>;
  rejectScopeExtension(): Promise<readonly CandidateEvent[]>;
  dispose(): void;
}

export interface LiveCandidateAdapterOptions {
  readonly projectId: ProjectId;
  readonly bridge: LiveCandidateBridge;
  readonly createRequestId?: () => string;
}

/** Small Renderer-facing seam shared by the live adapter and its fake. */
export type LiveCandidateBridge = Pick<
  DesktopBridge,
  'dispatchCandidate' | 'readCandidateState' | 'onCandidateEvent'
>;

const defaultRequestId = (): string => `candidate-${crypto.randomUUID()}`;

const commandFor = (
  state: LiveCandidateState,
  requestId: string,
  intent:
    | Readonly<{ type: 'startTask'; scope: TaskScope }>
    | Readonly<{ type: 'cancelTask' }>
    | Readonly<{ type: 'accept' }>
    | Readonly<{ type: 'reject' }>
    | Readonly<{ type: 'approveScopeExtension' }>
    | Readonly<{ type: 'rejectScopeExtension' }>,
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
  if (
    (intent.type === 'approveScopeExtension' ||
      intent.type === 'rejectScopeExtension') &&
    state.pendingScopeExtension === null
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
  if (
    intent.type === 'approveScopeExtension' ||
    intent.type === 'rejectScopeExtension'
  ) {
    const pending = state.pendingScopeExtension;
    if (pending === null) return null;
    if (intent.type === 'approveScopeExtension') {
      return {
        type: 'candidate.approveScopeExtension',
        requestId,
        taskId: pending.taskId,
        requestIdToApprove: pending.requestId,
      };
    }
    return {
      type: 'candidate.rejectScopeExtension',
      requestId,
      taskId: pending.taskId,
      requestIdToReject: pending.requestId,
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
  let lastSequence = -1;
  let disposed = false;
  const listeners = new Set<(value: LiveCandidateState) => void>();

  const publishState = (next: LiveCandidateState): void => {
    state = next;
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener(state);
    }
  };

  const publish = (
    events: readonly CandidateEvent[],
    candidatePlaybackSnapshot?: CandidatePlaybackSnapshotReference | null,
  ): void => {
    if (disposed || events.length === 0) return;
    const freshEvents = events.filter((event) => event.sequence > lastSequence);
    if (freshEvents.length === 0) return;
    lastSequence = Math.max(
      lastSequence,
      ...freshEvents.map((event) => event.sequence),
    );
    const next = reduceLiveCandidateState(state, {
      type: 'events',
      events: freshEvents,
      ...(candidatePlaybackSnapshot === undefined
        ? {}
        : { candidatePlaybackSnapshot }),
    });
    if (next !== state) publishState(next);
  };

  const applySnapshot = (snapshot: CandidateStateSnapshot): void => {
    if (
      disposed ||
      snapshot.projectId !== projectId ||
      snapshot.sequence <= lastSequence
    )
      return;
    lastSequence = snapshot.sequence;
    publishState({
      status:
        snapshot.candidate === null
          ? snapshot.task === null
            ? 'none'
            : 'building'
          : candidateStatus(snapshot.candidate),
      projectId,
      candidate: snapshot.candidate,
      task: snapshot.task,
      pendingScopeExtension: snapshot.task?.pendingScopeExtension ?? null,
      candidatePlaybackSnapshot: snapshot.candidatePlaybackSnapshot,
      error: null,
      committedRevision: null,
    });
  };

  let resolveReady: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const unsubscribeFromCore = bridge.onCandidateEvent(
    (notification: CoreCandidateEventNotification) => {
      if (notification.projectId === projectId)
        publish([notification.event], notification.candidatePlaybackSnapshot);
    },
  );
  const initialize = async (): Promise<void> => {
    try {
      const result: CandidateStateResult =
        await bridge.readCandidateState(projectId);
      if (result.ok) applySnapshot(result.state);
    } catch {
      // A Core read can race service startup. The event subscription remains
      // active and a later project reconnect will bootstrap a fresh adapter.
    } finally {
      resolveReady();
    }
  };
  void initialize();

  const execute = async (
    intent:
      | Readonly<{ type: 'startTask'; scope: TaskScope }>
      | Readonly<{ type: 'cancelTask' }>
      | Readonly<{ type: 'accept' }>
      | Readonly<{ type: 'reject' }>
      | Readonly<{ type: 'approveScopeExtension' }>
      | Readonly<{ type: 'rejectScopeExtension' }>,
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
    ready: () => readyPromise,
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
    approveScopeExtension: () => execute({ type: 'approveScopeExtension' }),
    rejectScopeExtension: () => execute({ type: 'rejectScopeExtension' }),
    dispose: () => {
      unsubscribeFromCore();
      disposed = true;
      listeners.clear();
    },
  };
};
