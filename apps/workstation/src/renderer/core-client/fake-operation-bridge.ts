import type { OperationView, ProjectId } from '@agent-music/contracts';
import type {
  CoreOperationEventNotification,
  CoreOperationStateSnapshot,
  LiveOperationBridge,
  OperationControlCommand,
  OperationControlResult,
  OperationStateResult,
} from '../../shared/operation-bridge.js';

export interface FakeOperationBridge extends LiveOperationBridge {
  emit(notification: CoreOperationEventNotification): void;
  replaceState(state: CoreOperationStateSnapshot): void;
}

export const createFakeOperationBridge = (
  initialState: CoreOperationStateSnapshot,
  dispatchOperation: (
    command: OperationControlCommand,
  ) => Promise<OperationControlResult> = async () => ({
    ok: false,
    code: 'NOT_IMPLEMENTED',
    userMessage: 'Operation control is not configured.',
  }),
): FakeOperationBridge => {
  let state = structuredClone(initialState);
  const listeners = new Set<
    (notification: CoreOperationEventNotification) => void
  >();

  return {
    readOperationState: async (
      projectId: ProjectId,
    ): Promise<OperationStateResult> =>
      state.projectId === projectId
        ? { ok: true, state: structuredClone(state) }
        : {
            ok: false,
            code: 'PROJECT_MISMATCH',
            userMessage: 'Operation state belongs to another project.',
          },
    dispatchOperation,
    onOperationEvent(listener) {
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

export const operationList = (
  ...operations: readonly OperationView[]
): readonly OperationView[] => operations;
