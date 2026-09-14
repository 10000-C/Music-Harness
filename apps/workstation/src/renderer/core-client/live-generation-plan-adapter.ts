import type {
  GenerationPlanOperationView,
  OperationId,
  OperationView,
  ProjectId,
  TaskContextView,
  TaskScope,
} from '@agent-music/contracts';
import type {
  CoreOperationEventNotification,
  LiveOperationBridge,
  OperationControlResult,
  OperationStateResult,
} from '../../shared/operation-bridge.js';
import { generationPlanFromOperations } from '../../shared/operation-bridge.js';

export interface LiveGenerationPlanState {
  readonly projectId: ProjectId;
  readonly operation: GenerationPlanOperationView | null;
  readonly error: Readonly<{ code: string; message: string }> | null;
}

export interface LiveGenerationPlanAdapter {
  ready(): Promise<void>;
  getState(): LiveGenerationPlanState;
  subscribe(listener: (state: LiveGenerationPlanState) => void): () => void;
  applyOperation(operation: OperationView): void;
  approve(): Promise<GenerationPlanOperationView | null>;
  reject(): Promise<GenerationPlanOperationView | null>;
  dispose(): void;
}

export interface LiveGenerationPlanAdapterOptions {
  readonly projectId: ProjectId;
  readonly bridge: LiveOperationBridge;
  readonly createRequestId?: () => string;
}

const defaultRequestId = (): string => `operation-${crypto.randomUUID()}`;

const pendingGenerationPlan = (
  operation: GenerationPlanOperationView | null,
): operation is Extract<GenerationPlanOperationView, { state: 'pending' }> =>
  operation?.state === 'pending';

const taskFromSucceeded = (
  operation: GenerationPlanOperationView,
): TaskContextView | null =>
  operation.state === 'succeeded' ? operation.result.task : null;

const operationError = (
  operation: GenerationPlanOperationView,
): Readonly<{ code: string; message: string }> | null =>
  operation.state === 'failed'
    ? operation.error
    : operation.state === 'rejected' || operation.state === 'cancelled'
      ? {
          code: operation.state.toUpperCase(),
          message:
            operation.state === 'rejected'
              ? 'Generation plan was rejected.'
              : 'Generation plan was cancelled.',
        }
      : null;

export const createLiveGenerationPlanAdapter = ({
  projectId,
  bridge,
  createRequestId = defaultRequestId,
}: LiveGenerationPlanAdapterOptions): LiveGenerationPlanAdapter => {
  let state: LiveGenerationPlanState = {
    projectId,
    operation: null,
    error: null,
  };
  let lastSequence = -1;
  let disposed = false;
  const listeners = new Set<(value: LiveGenerationPlanState) => void>();

  const publishState = (next: LiveGenerationPlanState): void => {
    if (disposed || next === state) return;
    state = next;
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener(state);
    }
  };

  const applySnapshot = (operations: readonly OperationView[], sequence: number): void => {
    if (disposed || sequence <= lastSequence) return;
    lastSequence = sequence;
    const operation = generationPlanFromOperations(operations);
    publishState({
      projectId,
      operation,
      error: operation === null ? null : operationError(operation),
    });
  };

  const applyOperationEvent = (notification: CoreOperationEventNotification): void => {
    if (
      disposed ||
      notification.projectId !== projectId ||
      notification.sequence <= lastSequence ||
      notification.operation.type !== 'generationPlan'
    )
      return;
    lastSequence = notification.sequence;
    publishState({
      projectId,
      operation: notification.operation,
      error: operationError(notification.operation),
    });
  };

  const applyOperation = (operation: OperationView): void => {
    if (operation.type !== 'generationPlan') return;
    publishState({
      projectId,
      operation,
      error: operationError(operation),
    });
  };

  const unsubscribe = bridge.onOperationEvent(applyOperationEvent);
  let resolveReady: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const initialize = async (): Promise<void> => {
    try {
      const result: OperationStateResult =
        await bridge.readOperationState(projectId);
      if (result.ok) applySnapshot(result.state.operations, result.state.sequence);
      else
        publishState({
          projectId,
          operation: null,
          error: { code: result.code, message: result.userMessage },
        });
    } catch (error: unknown) {
      publishState({
        projectId,
        operation: null,
        error: {
          code: 'OPERATION_STATE_UNAVAILABLE',
          message:
            error instanceof Error
              ? error.message
              : 'Operation state is unavailable.',
        },
      });
    } finally {
      resolveReady();
    }
  };
  void initialize();

  const execute = async (
    decision: 'approve' | 'reject',
  ): Promise<GenerationPlanOperationView | null> => {
    if (disposed) throw new Error('Generation plan adapter has been disposed.');
    const operation = state.operation;
    if (!pendingGenerationPlan(operation)) {
      throw new Error('Generation plan confirmation is unavailable.');
    }
    const result: OperationControlResult = await bridge.dispatchOperation({
      type: 'operation.resolve',
      protocolVersion: 1,
      requestId: createRequestId(),
      operationId: operation.operationId,
      decision,
    });
    if (!result.ok) throw new Error(result.userMessage);
    if (result.operation.type !== 'generationPlan') return null;
    applyOperation(result.operation);
    return result.operation;
  };

  return {
    ready: () => readyPromise,
    getState: () => state,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyOperation,
    approve: () => execute('approve'),
    reject: () => execute('reject'),
    dispose: () => {
      disposed = true;
      unsubscribe();
      listeners.clear();
    },
  };
};

export const generationPlanTask = (
  operation: GenerationPlanOperationView | null,
): TaskContextView | null =>
  operation === null ? null : taskFromSucceeded(operation);

export const generationPlanOperationId = (
  operation: GenerationPlanOperationView | null,
): OperationId | null => operation?.operationId ?? null;
