import type {
  GenerationPlanOperationView,
  OperationId,
  OperationView,
  ProjectId,
} from '@agent-music/contracts';

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
