import type {
  CandidateCommand,
  CandidateEvent,
  ProjectId,
} from '@agent-music/contracts';
import type {
  CandidateStateSnapshot,
  CoreCandidateEventNotification,
} from '../../shared/candidate-bridge.js';
import type {
  CandidateCommandResult,
  CandidateStateResult,
} from '../../shared/shell-contracts.js';
import type { LiveCandidateBridge } from './live-candidate-adapter.js';

export interface FakeCandidateBridge extends LiveCandidateBridge {
  emit(notification: CoreCandidateEventNotification): void;
  replaceState(state: CandidateStateSnapshot): void;
}

export const createFakeCandidateBridge = (
  initialState: CandidateStateSnapshot,
  dispatchCandidate: (
    command: CandidateCommand,
  ) => Promise<CandidateCommandResult> = () =>
    Promise.resolve({
      ok: true,
      events: [] as readonly CandidateEvent[],
    }),
): FakeCandidateBridge => {
  let state = structuredClone(initialState);
  const listeners = new Set<
    (notification: CoreCandidateEventNotification) => void
  >();

  return {
    dispatchCandidate,
    readCandidateState: (projectId: ProjectId): Promise<CandidateStateResult> =>
      Promise.resolve(
        state.projectId === projectId
          ? { ok: true, state: structuredClone(state) }
          : {
              ok: false,
              code: 'PROJECT_MISMATCH',
              userMessage: 'Candidate state belongs to another project.',
            },
      ),
    onCandidateEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(notification) {
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener(structuredClone(notification));
      }
    },
    replaceState(nextState) {
      state = structuredClone(nextState);
    },
  };
};
