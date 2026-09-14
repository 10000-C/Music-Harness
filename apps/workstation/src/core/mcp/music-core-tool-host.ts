import type {
  OperationId,
  OperationState,
  OperationView,
  PendingScopeExtensionView,
  ProjectId,
  TaskContextView,
  TaskExecutionEnvelope,
  TaskId,
  TaskScope,
} from '@agent-music/contracts';

import type { TrackReplacement } from '../composition/index.js';
import {
  CandidateError,
  type CandidateAgentPort,
  type CandidateControlPort,
} from '../candidate/index.js';

export const P0_MCP_TOOL_NAMES = [
  'getTaskContext',
  'getScopedComposition',
  'submitGenerationPlan',
  'requestScopeExtension',
  'getOperation',
  'cancelOperation',
  'replaceScopedMusic',
  'updateMusicalProperties',
  'resizeComposition',
  'finishTask',
] as const;

export type MusicCoreToolName = (typeof P0_MCP_TOOL_NAMES)[number];
export type ConfirmationDecision = 'approved' | 'rejected' | 'cancelled';

export interface GenerationPlanConfirmationPort {
  request(input: {
    readonly operationId: OperationId;
    readonly projectId: ProjectId;
    readonly summary: string;
    readonly scope: TaskScope;
    readonly signal: AbortSignal;
  }): Promise<ConfirmationDecision>;
}

export interface ScopeExtensionConfirmationPort {
  request(input: {
    readonly operationId: OperationId;
    readonly request: PendingScopeExtensionView;
    readonly signal: AbortSignal;
  }): Promise<ConfirmationDecision>;
}

interface MusicCoreToolHostDependencies {
  readonly agent: CandidateAgentPort;
  readonly control: CandidateControlPort;
  readonly generationPlanConfirmation: GenerationPlanConfirmationPort;
  readonly scopeExtensionConfirmation: ScopeExtensionConfirmationPort;
  readonly now?: () => string;
}

interface GenerationPlanInput {
  readonly operationId: OperationId;
  readonly projectId: ProjectId;
  readonly summary: string;
  readonly scope: TaskScope;
}

interface ScopeExtensionInput {
  readonly operationId: OperationId;
  readonly envelope: TaskExecutionEnvelope;
  readonly requestedScope: TaskScope;
}

interface ReplaceScopedMusicInput {
  readonly envelope: TaskExecutionEnvelope;
  readonly targetScope?: TaskScope;
  readonly replacements: readonly TrackReplacement[];
}

interface ResizeCompositionInput {
  readonly envelope: TaskExecutionEnvelope;
  readonly targetMeasureCount: number;
}

interface UpdateMusicalPropertiesInput {
  readonly envelope: TaskExecutionEnvelope;
  readonly meter?: { readonly numerator: number; readonly denominator: number };
  readonly tempo?: { readonly bpm: number };
}

type OperationPhase = 'waiting' | 'committing';

interface OperationRecordBase {
  readonly operationId: OperationId;
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly abortController: AbortController;
  state: OperationState;
  phase: OperationPhase;
  commitPromise: Promise<void> | undefined;
  error: { readonly code: string; readonly message: string } | undefined;
}

interface GenerationPlanOperationRecord extends OperationRecordBase {
  readonly type: 'generationPlan';
  readonly summary: string;
  readonly scope: TaskScope;
  task: TaskContextView | undefined;
}

interface ScopeExtensionOperationRecord extends OperationRecordBase {
  readonly type: 'scopeExtension';
  readonly envelope: TaskExecutionEnvelope;
  readonly requestedScope: TaskScope;
  request: PendingScopeExtensionView | undefined;
  task: TaskContextView | undefined;
}

type OperationRecord =
  GenerationPlanOperationRecord | ScopeExtensionOperationRecord;

const failureFrom = (
  error: unknown,
): { readonly code: string; readonly message: string } =>
  error instanceof CandidateError
    ? { code: error.code, message: error.message }
    : { code: 'OPERATION_FAILED', message: 'Operation failed' };

export class MusicCoreToolHost {
  private readonly operations = new Map<OperationId, OperationRecord>();
  private readonly now: () => string;

  public constructor(
    private readonly dependencies: MusicCoreToolHostDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public listTools(): typeof P0_MCP_TOOL_NAMES {
    return P0_MCP_TOOL_NAMES;
  }

  public async call(
    name: MusicCoreToolName,
    input: unknown,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<unknown> {
    void options;
    switch (name) {
      case 'getTaskContext': {
        const { taskId } = input as { readonly taskId: TaskId };
        return this.dependencies.agent.getTaskContext(taskId);
      }
      case 'getScopedComposition': {
        const scopedInput = input as TaskExecutionEnvelope & {
          readonly targetScope?: TaskScope;
        };
        const { targetScope, ...envelope } = scopedInput;
        return targetScope === undefined
          ? this.dependencies.agent.getScopedComposition(envelope)
          : this.dependencies.agent.getScopedComposition(envelope, targetScope);
      }
      case 'submitGenerationPlan':
        return this.submitGenerationPlan(input as GenerationPlanInput);
      case 'requestScopeExtension':
        return this.requestScopeExtension(input as ScopeExtensionInput);
      case 'getOperation':
        return this.getOperation(
          (input as { readonly operationId: OperationId }).operationId,
        );
      case 'cancelOperation':
        return this.cancelOperation(
          (input as { readonly operationId: OperationId }).operationId,
        );
      case 'replaceScopedMusic':
        return this.dependencies.agent.applyScopedMusicChange(
          input as ReplaceScopedMusicInput,
        );
      case 'updateMusicalProperties':
        return this.dependencies.agent.updateMusicalProperties(
          input as UpdateMusicalPropertiesInput,
        );
      case 'resizeComposition':
        return this.dependencies.agent.resizeComposition(
          input as ResizeCompositionInput,
        );
      case 'finishTask':
        return this.dependencies.agent.finishTask(
          input as TaskExecutionEnvelope,
        );
    }
  }

  private submitGenerationPlan(input: GenerationPlanInput): OperationView {
    const fingerprint = JSON.stringify({
      type: 'generationPlan',
      projectId: input.projectId,
      summary: input.summary,
      scope: input.scope,
    });
    const existing = this.operations.get(input.operationId);
    if (existing !== undefined) {
      this.assertMatchingOperation(existing, 'generationPlan', fingerprint);
      return this.toOperationView(existing);
    }

    const record: GenerationPlanOperationRecord = {
      operationId: input.operationId,
      type: 'generationPlan',
      state: 'pending',
      phase: 'waiting',
      createdAt: this.now(),
      fingerprint,
      summary: input.summary,
      scope: input.scope,
      task: undefined,
      error: undefined,
      abortController: new AbortController(),
      commitPromise: undefined,
    };
    this.operations.set(record.operationId, record);
    void this.resolveGenerationPlan(record, input);
    return this.toOperationView(record);
  }

  private async requestScopeExtension(
    input: ScopeExtensionInput,
  ): Promise<OperationView> {
    const fingerprint = JSON.stringify({
      type: 'scopeExtension',
      envelope: input.envelope,
      requestedScope: input.requestedScope,
    });
    const existing = this.operations.get(input.operationId);
    if (existing !== undefined) {
      this.assertMatchingOperation(existing, 'scopeExtension', fingerprint);
      return this.toOperationView(existing);
    }

    const record: ScopeExtensionOperationRecord = {
      operationId: input.operationId,
      type: 'scopeExtension',
      state: 'pending',
      phase: 'committing',
      createdAt: this.now(),
      fingerprint,
      envelope: input.envelope,
      requestedScope: input.requestedScope,
      request: undefined,
      task: undefined,
      error: undefined,
      abortController: new AbortController(),
      commitPromise: undefined,
    };
    this.operations.set(record.operationId, record);

    const initialization = this.initializeScopeExtension(record);
    record.commitPromise = initialization;
    await initialization;
    record.commitPromise = undefined;
    if (record.state === 'pending') {
      record.phase = 'waiting';
      void this.resolveScopeExtension(record);
    }
    return this.toOperationView(record);
  }

  private async initializeScopeExtension(
    record: ScopeExtensionOperationRecord,
  ): Promise<void> {
    try {
      const request = await this.dependencies.agent.requestScopeExtension({
        operationId: record.operationId,
        envelope: record.envelope,
        requestedScope: record.requestedScope,
      });
      record.request = request;
      if (record.state === 'cancelled') {
        await this.rejectScopeExtensionIfCurrent(record);
      }
    } catch (error) {
      if (record.state !== 'cancelled') {
        record.state = 'failed';
        record.error = failureFrom(error);
      }
    }
  }

  private async resolveGenerationPlan(
    record: GenerationPlanOperationRecord,
    input: GenerationPlanInput,
  ): Promise<void> {
    try {
      const decision =
        await this.dependencies.generationPlanConfirmation.request({
          operationId: record.operationId,
          projectId: input.projectId,
          summary: input.summary,
          scope: input.scope,
          signal: record.abortController.signal,
        });
      if (record.state !== 'pending') return;
      if (decision === 'rejected' || decision === 'cancelled') {
        record.state = decision;
        return;
      }

      record.phase = 'committing';
      const commit = this.dependencies.control
        .startTask({ projectId: input.projectId, scope: input.scope })
        .then((task) => {
          record.task = task;
          record.state = 'succeeded';
        })
        .catch((error: unknown) => {
          record.state = 'failed';
          record.error = failureFrom(error);
        });
      record.commitPromise = commit;
      await commit;
      record.commitPromise = undefined;
    } catch (error) {
      if (record.state === 'pending') {
        record.state = 'failed';
        record.error = failureFrom(error);
      }
    }
  }

  private async resolveScopeExtension(
    record: ScopeExtensionOperationRecord,
  ): Promise<void> {
    const request = record.request;
    if (request === undefined) return;
    try {
      const decision =
        await this.dependencies.scopeExtensionConfirmation.request({
          operationId: record.operationId,
          request,
          signal: record.abortController.signal,
        });
      if (record.state !== 'pending') return;
      record.phase = 'committing';
      const commit = this.applyScopeExtensionDecision(record, decision);
      record.commitPromise = commit;
      await commit;
      record.commitPromise = undefined;
    } catch (error) {
      if (record.state === 'pending') {
        record.phase = 'committing';
        await this.rejectScopeExtensionIfCurrent(record);
        record.state = 'failed';
        record.error = failureFrom(error);
        record.commitPromise = undefined;
      }
    }
  }

  private async applyScopeExtensionDecision(
    record: ScopeExtensionOperationRecord,
    decision: ConfirmationDecision,
  ): Promise<void> {
    const request = record.request;
    if (request === undefined) return;
    try {
      if (decision === 'approved') {
        record.task = await this.dependencies.control.approveScopeExtension({
          taskId: request.taskId,
          requestId: request.requestId,
        });
        record.state = 'succeeded';
      } else {
        await this.dependencies.control.rejectScopeExtension({
          taskId: request.taskId,
          requestId: request.requestId,
        });
        record.state = decision;
      }
    } catch (error) {
      record.state = 'failed';
      record.error = failureFrom(error);
    }
  }

  private async getOperation(operationId: OperationId): Promise<OperationView> {
    const record = this.operations.get(operationId);
    if (record === undefined) {
      throw new CandidateError(
        'OPERATION_NOT_FOUND',
        'Operation does not exist in the current Core runtime',
      );
    }
    if (record.phase === 'committing') {
      await record.commitPromise;
    }
    return this.toOperationView(record);
  }

  private async cancelOperation(
    operationId: OperationId,
  ): Promise<OperationView> {
    const record = this.operations.get(operationId);
    if (record === undefined) {
      throw new CandidateError(
        'OPERATION_NOT_FOUND',
        'Operation does not exist in the current Core runtime',
      );
    }
    if (record.state !== 'pending') return this.toOperationView(record);
    if (record.phase === 'committing') {
      await record.commitPromise;
      const refreshed = this.operations.get(operationId);
      if (refreshed === undefined) {
        throw new CandidateError(
          'OPERATION_NOT_FOUND',
          'Operation does not exist in the current Core runtime',
        );
      }
      if (refreshed.state !== 'pending') {
        return this.toOperationView(refreshed);
      }
      // Scope Extension initialization can finish while cancellation is waiting.
      // If no terminal commit occurred, continue into explicit business cancellation.
      refreshed.phase = 'waiting';
    }

    record.state = 'cancelled';
    record.abortController.abort();
    if (record.type === 'scopeExtension') {
      record.phase = 'committing';
      await this.rejectScopeExtensionIfCurrent(record);
    }
    return this.toOperationView(record);
  }

  private async rejectScopeExtensionIfCurrent(
    record: ScopeExtensionOperationRecord,
  ): Promise<void> {
    const request = record.request;
    if (request === undefined) return;
    try {
      await this.dependencies.control.rejectScopeExtension({
        taskId: request.taskId,
        requestId: request.requestId,
      });
    } catch (error) {
      if (
        !(error instanceof CandidateError) ||
        error.code !== 'STALE_SCOPE_EXTENSION_REQUEST'
      ) {
        throw error;
      }
    }
  }

  private assertMatchingOperation(
    record: OperationRecord,
    type: OperationRecord['type'],
    fingerprint: string,
  ): void {
    if (record.type !== type || record.fingerprint !== fingerprint) {
      throw new CandidateError(
        'OPERATION_ID_CONFLICT',
        'operationId is already bound to a different operation request',
      );
    }
  }

  private toOperationView(record: OperationRecord): OperationView {
    const base = {
      operationId: record.operationId,
      type: record.type,
      state: record.state,
      createdAt: record.createdAt,
    } as const;
    if (record.state === 'failed') {
      return {
        ...base,
        state: 'failed',
        error: record.error ?? {
          code: 'OPERATION_FAILED',
          message: 'Operation failed',
        },
      };
    }
    if (record.state === 'rejected' || record.state === 'cancelled') {
      return { ...base, state: record.state };
    }
    if (record.state === 'succeeded') {
      if (record.task === undefined) {
        throw new CandidateError(
          'CANDIDATE_TRANSACTION_FAILED',
          'Succeeded operation is missing its Task result',
        );
      }
      return {
        ...base,
        state: 'succeeded',
        result: { task: record.task },
      };
    }
    return record.type === 'generationPlan'
      ? {
          ...base,
          type: 'generationPlan',
          state: 'pending',
          summary: record.summary,
          scope: record.scope,
        }
      : {
          ...base,
          type: 'scopeExtension',
          state: 'pending',
          ...(record.request === undefined ? {} : { request: record.request }),
        };
  }
}
