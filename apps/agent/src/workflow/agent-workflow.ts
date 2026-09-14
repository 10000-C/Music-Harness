import type {
  AgentEvent,
  AgentExecutionId,
  AgentSessionId,
  CandidateId,
  CandidateValidationReport,
  OperationId,
  OperationView,
  ProjectId,
  TaskContextView,
  TaskId,
} from '@agent-music/contracts';

export interface AgentRuntimeResult {
  readonly stopReason: string;
}

export interface AgentRuntimePort {
  stream(
    text: string | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<unknown, AgentRuntimeResult, undefined>;
  dispose(): Promise<void>;
}

export interface AgentRuntimeFactoryPort {
  create(
    projectId: ProjectId,
    sessionId: AgentSessionId,
    options: {
      readonly repairMode: boolean;
      readonly instructions: string;
    },
  ): Promise<AgentRuntimePort>;
}

export interface RepairSettingsPort {
  getMaxRepairAttempts(): Promise<number>;
}

export interface ConfirmedTaskBootstrapPort {
  getTaskContext(
    projectId: ProjectId,
    taskId: TaskId,
    signal: AbortSignal,
  ): Promise<TaskContextView>;
}

export interface TaskRollbackPort {
  cancelTask(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
    readonly taskId: TaskId;
  }): Promise<unknown>;
}

export interface OperationControlPort {
  cancelOperation(
    projectId: ProjectId,
    operationId: OperationId,
    signal: AbortSignal,
  ): Promise<OperationView>;
}

export type AgentEventSink = (event: AgentEvent) => void;

export interface AgentWorkflowDependencies {
  readonly runtimeFactory: AgentRuntimeFactoryPort;
  readonly taskBootstrap: ConfirmedTaskBootstrapPort;
  readonly rollback: TaskRollbackPort;
  readonly operations?: OperationControlPort;
  readonly settings: RepairSettingsPort;
  readonly createExecutionId: () => AgentExecutionId;
}

export interface StartAgentExecutionInput {
  readonly projectId: ProjectId;
  readonly sessionId: AgentSessionId;
  readonly task?: {
    readonly taskId: TaskId;
    readonly candidateId: CandidateId;
  };
  readonly text: string;
}

type AgentWorkflowErrorCode =
  | 'AGENT_EXECUTION_BUSY'
  | 'AGENT_EXECUTION_FAILED'
  | 'TASK_NOT_FINISHED'
  | 'OPERATION_NOT_FINISHED'
  | 'TASK_BOOTSTRAP_INVALID'
  | 'REPAIR_LIMIT_EXCEEDED';

class AgentWorkflowError extends Error {
  public constructor(
    public readonly code: AgentWorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentWorkflowError';
  }
}

class AgentTaskRollbackError extends Error {
  public constructor(public readonly rollbackCause: unknown) {
    super('Agent Task rollback failed');
    this.name = 'AgentTaskRollbackError';
  }
}

interface ActiveTaskReference {
  readonly projectId: ProjectId;
  readonly candidateId: CandidateId;
  readonly taskId: TaskId;
}

interface ActiveExecution {
  readonly projectId: ProjectId;
  readonly sessionId: AgentSessionId;
  readonly executionId: AgentExecutionId;
  readonly emit: AgentEventSink;
  cancelRequested: boolean;
  task: ActiveTaskReference | undefined;
  readonly operationIds: Set<OperationId>;
  invocationAbortController: AbortController | undefined;
  settlement: Promise<void>;
}

type InvocationOutcome =
  | { readonly kind: 'completed' }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'validationFailed';
      readonly validation: CandidateValidationReport;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCancelRequested = (execution: ActiveExecution): boolean =>
  execution.cancelRequested;

const textFromModelEvent = (event: unknown): string | undefined => {
  if (!isRecord(event) || event.type !== 'modelStreamUpdateEvent') {
    return undefined;
  }
  const modelEvent = event.event;
  if (
    !isRecord(modelEvent) ||
    modelEvent.type !== 'modelContentBlockDeltaEvent' ||
    !isRecord(modelEvent.delta) ||
    modelEvent.delta.type !== 'textDelta' ||
    typeof modelEvent.delta.text !== 'string'
  ) {
    return undefined;
  }
  return modelEvent.delta.text;
};

interface CompletedToolCall {
  readonly name: string;
  readonly value: unknown;
}

const completedToolCall = (event: unknown): CompletedToolCall | undefined => {
  if (
    !isRecord(event) ||
    event.type !== 'afterToolCallEvent' ||
    !isRecord(event.toolUse) ||
    typeof event.toolUse.name !== 'string' ||
    !isRecord(event.result) ||
    event.result.status !== 'success' ||
    !Array.isArray(event.result.content)
  ) {
    return undefined;
  }

  const textContent = event.result.content.find(
    (item): item is Record<string, unknown> & { readonly text: string } =>
      isRecord(item) && typeof item.text === 'string',
  );
  if (textContent === undefined) {
    return undefined;
  }

  try {
    return {
      name: event.toolUse.name,
      value: JSON.parse(textContent.text) as unknown,
    };
  } catch {
    return undefined;
  }
};

const operationViewFromToolResult = (
  value: unknown,
): OperationView | undefined => {
  if (
    !isRecord(value) ||
    typeof value.operationId !== 'string' ||
    (value.type !== 'generationPlan' && value.type !== 'scopeExtension') ||
    (value.state !== 'pending' &&
      value.state !== 'succeeded' &&
      value.state !== 'rejected' &&
      value.state !== 'cancelled' &&
      value.state !== 'failed')
  ) {
    return undefined;
  }
  return value as unknown as OperationView;
};

const taskReferenceFromOperation = (
  operation: OperationView,
): ActiveTaskReference | undefined => {
  if (operation.type !== 'generationPlan' || operation.state !== 'succeeded') {
    return undefined;
  }
  const task = operation.result.task;
  return {
    projectId: task.projectId,
    candidateId: task.candidateId,
    taskId: task.taskId,
  };
};

const validationFromFinishTask = (
  value: unknown,
): CandidateValidationReport | undefined => {
  if (
    !isRecord(value) ||
    !isRecord(value.validation) ||
    typeof value.validation.valid !== 'boolean' ||
    !Array.isArray(value.validation.issues)
  ) {
    return undefined;
  }

  const issues: { code: string; message: string }[] = [];
  for (const issue of value.validation.issues) {
    if (
      !isRecord(issue) ||
      typeof issue.code !== 'string' ||
      typeof issue.message !== 'string'
    ) {
      return undefined;
    }
    issues.push({ code: issue.code, message: issue.message });
  }
  return { valid: value.validation.valid, issues };
};

const executionInstructions = (
  execution: ActiveExecution,
  taskContext: TaskContextView | undefined,
  validation?: CandidateValidationReport,
): string => {
  const instructions = [`Current projectId: ${execution.projectId}.`];
  if (taskContext !== undefined) {
    instructions.push(
      'A confirmed Candidate Task has already been mechanically bootstrapped from A3.',
      `taskId: ${taskContext.taskId}`,
      `candidateId: ${taskContext.candidateId}`,
      `baseRevision: ${taskContext.baseRevision}`,
      `expectedScopeRevision: ${String(taskContext.scopeRevision)}`,
      `scope: ${JSON.stringify(taskContext.scope)}`,
      `allowedOperations: ${taskContext.allowedOperations.join(', ')}`,
      'Use only this A3-authoritative Task context when constructing Task-bound MCP execution envelopes.',
    );
  }
  if (validation !== undefined) {
    instructions.push(repairInstructions(validation));
  }
  return instructions.join('\n');
};

const repairInstructions = (validation: CandidateValidationReport): string => {
  const issues = validation.issues
    .map((issue) => `- ${issue.code}: ${issue.message}`)
    .join('\n');
  return [
    'Repair the current Candidate Task using only its existing authorized Scope.',
    'Do not request a Scope Extension.',
    'Validation issues:',
    issues.length === 0 ? '- Unknown validation failure' : issues,
    'When the repair is complete, call finishTask again.',
  ].join('\n');
};

export class AgentWorkflow {
  private active: ActiveExecution | undefined;

  public constructor(
    private readonly dependencies: AgentWorkflowDependencies,
  ) {}

  public startExecution(
    input: StartAgentExecutionInput,
    emit: AgentEventSink,
  ): AgentExecutionId {
    if (this.active !== undefined) {
      throw new AgentWorkflowError(
        'AGENT_EXECUTION_BUSY',
        'Another Agent execution is already active',
      );
    }

    const executionId = this.dependencies.createExecutionId();
    const execution: ActiveExecution = {
      projectId: input.projectId,
      sessionId: input.sessionId,
      executionId,
      emit,
      cancelRequested: false,
      operationIds: new Set<OperationId>(),
      task:
        input.task === undefined
          ? undefined
          : {
              projectId: input.projectId,
              candidateId: input.task.candidateId,
              taskId: input.task.taskId,
            },
      invocationAbortController: undefined,
      settlement: Promise.resolve(),
    };
    this.active = execution;
    execution.settlement = this.runExecution(execution, input.text).finally(
      () => {
        if (this.active === execution) {
          this.active = undefined;
        }
      },
    );
    void execution.settlement.catch(() => undefined);
    return executionId;
  }

  public isRunning(projectId?: ProjectId): boolean {
    return (
      this.active !== undefined &&
      (projectId === undefined || this.active.projectId === projectId)
    );
  }

  public hasActiveTask(projectId?: ProjectId): boolean {
    return (
      this.active?.task !== undefined &&
      (projectId === undefined || this.active.projectId === projectId)
    );
  }

  public async cancelCurrentExecution(projectId: ProjectId): Promise<void> {
    const execution = this.active;
    if (execution?.projectId !== projectId) {
      return;
    }
    execution.cancelRequested = true;
    execution.invocationAbortController?.abort();
    await execution.settlement;
  }

  public async shutdown(): Promise<void> {
    const execution = this.active;
    if (execution === undefined) {
      return;
    }
    execution.cancelRequested = true;
    execution.invocationAbortController?.abort();
    await execution.settlement;
  }

  private async runExecution(
    execution: ActiveExecution,
    initialPrompt: string,
  ): Promise<void> {
    let repairAttempt = 0;
    let repairMode = false;
    let prompt: string | undefined = initialPrompt;
    let repairValidation: CandidateValidationReport | undefined;

    try {
      for (;;) {
        if (isCancelRequested(execution)) {
          await this.cancelPendingOperations(execution);
          await this.rollbackActiveTask(execution);
          this.emitTerminal(execution, 'cancelled');
          return;
        }

        const taskContext = await this.bootstrapTaskContext(execution);
        const outcome = await this.runInvocation(
          execution,
          prompt,
          repairMode,
          repairValidation,
          taskContext,
        );

        if (isCancelRequested(execution) || outcome.kind === 'cancelled') {
          await this.cancelPendingOperations(execution);
          await this.rollbackActiveTask(execution);
          this.emitTerminal(execution, 'cancelled');
          return;
        }

        if (outcome.kind === 'validationFailed') {
          if (repairMode) {
            repairAttempt += 1;
          }
          const maxRepairAttempts =
            await this.dependencies.settings.getMaxRepairAttempts();
          if (isCancelRequested(execution)) {
            await this.cancelPendingOperations(execution);
            await this.rollbackActiveTask(execution);
            this.emitTerminal(execution, 'cancelled');
            return;
          }
          if (repairAttempt >= maxRepairAttempts) {
            throw new AgentWorkflowError(
              'REPAIR_LIMIT_EXCEEDED',
              'Agent repair limit exceeded',
            );
          }
          repairMode = true;
          repairValidation = outcome.validation;
          prompt = undefined;
          continue;
        }

        if (execution.task !== undefined) {
          throw new AgentWorkflowError(
            'TASK_NOT_FINISHED',
            'Agent execution ended with an unfinished Task',
          );
        }
        if (execution.operationIds.size > 0) {
          throw new AgentWorkflowError(
            'OPERATION_NOT_FINISHED',
            'Agent execution ended with a pending Operation',
          );
        }

        this.emitTerminal(execution, 'completed');
        return;
      }
    } catch (error) {
      if (error instanceof AgentTaskRollbackError) {
        throw error;
      }
      if (isCancelRequested(execution)) {
        await this.cancelPendingOperations(execution);
        await this.rollbackActiveTask(execution);
        this.emitTerminal(execution, 'cancelled');
        return;
      }

      await this.cancelPendingOperations(execution);
      await this.rollbackActiveTask(execution);
      const normalized =
        error instanceof AgentWorkflowError
          ? error
          : new AgentWorkflowError(
              'AGENT_EXECUTION_FAILED',
              'Agent execution failed',
            );
      this.emitFailed(execution, normalized.code, normalized.message);
    }
  }

  private async bootstrapTaskContext(
    execution: ActiveExecution,
  ): Promise<TaskContextView | undefined> {
    const task = execution.task;
    if (task === undefined) {
      return undefined;
    }

    const abortController = new AbortController();
    execution.invocationAbortController = abortController;
    if (execution.cancelRequested) {
      abortController.abort();
    }

    try {
      const context = await this.dependencies.taskBootstrap.getTaskContext(
        execution.projectId,
        task.taskId,
        abortController.signal,
      );
      if (
        context.projectId !== execution.projectId ||
        context.taskId !== task.taskId
      ) {
        throw new AgentWorkflowError(
          'TASK_BOOTSTRAP_INVALID',
          'Confirmed Task bootstrap does not match the active Project Task',
        );
      }

      execution.task = {
        projectId: context.projectId,
        candidateId: context.candidateId,
        taskId: context.taskId,
      };
      if (context.candidateId !== task.candidateId) {
        throw new AgentWorkflowError(
          'TASK_BOOTSTRAP_INVALID',
          'Confirmed Task bootstrap does not match the active Candidate',
        );
      }
      return context;
    } finally {
      if (execution.invocationAbortController === abortController) {
        execution.invocationAbortController = undefined;
      }
    }
  }

  private async runInvocation(
    execution: ActiveExecution,
    prompt: string | undefined,
    repairMode: boolean,
    repairValidation: CandidateValidationReport | undefined,
    taskContext: TaskContextView | undefined,
  ): Promise<InvocationOutcome> {
    const abortController = new AbortController();
    execution.invocationAbortController = abortController;
    if (execution.cancelRequested) {
      abortController.abort();
    }

    const runtime = await this.dependencies.runtimeFactory.create(
      execution.projectId,
      execution.sessionId,
      {
        repairMode,
        instructions: executionInstructions(
          execution,
          taskContext,
          repairValidation,
        ),
      },
    );
    let validationFailure: CandidateValidationReport | undefined;

    try {
      const stream = runtime.stream(prompt, abortController.signal);
      for (;;) {
        const next = await stream.next();
        if (next.done) {
          if (validationFailure !== undefined) {
            return {
              kind: 'validationFailed',
              validation: validationFailure,
            };
          }
          return next.value.stopReason === 'cancelled'
            ? { kind: 'cancelled' }
            : { kind: 'completed' };
        }

        const text = textFromModelEvent(next.value);
        if (text !== undefined) {
          execution.emit({
            type: 'agent.textDelta',
            projectId: execution.projectId,
            sessionId: execution.sessionId,
            executionId: execution.executionId,
            text,
          });
        }

        const toolCall = completedToolCall(next.value);
        if (
          toolCall?.name === 'submitGenerationPlan' ||
          toolCall?.name === 'requestScopeExtension' ||
          toolCall?.name === 'getOperation' ||
          toolCall?.name === 'cancelOperation'
        ) {
          const operation = operationViewFromToolResult(toolCall.value);
          if (operation !== undefined) {
            if (operation.state === 'pending') {
              execution.operationIds.add(operation.operationId);
            } else {
              execution.operationIds.delete(operation.operationId);
            }
            execution.task =
              taskReferenceFromOperation(operation) ?? execution.task;
          }
          continue;
        }
        if (toolCall?.name !== 'finishTask') {
          continue;
        }

        const validation = validationFromFinishTask(toolCall.value);
        if (validation === undefined) {
          continue;
        }
        if (validation.valid) {
          execution.task = undefined;
          continue;
        }
        validationFailure = validation;
        abortController.abort();
      }
    } finally {
      execution.invocationAbortController = undefined;
      await runtime.dispose();
    }
  }

  private async cancelPendingOperations(
    execution: ActiveExecution,
  ): Promise<void> {
    if (this.dependencies.operations === undefined) return;
    for (const operationId of [...execution.operationIds]) {
      const controller = new AbortController();
      const operation = await this.dependencies.operations.cancelOperation(
        execution.projectId,
        operationId,
        controller.signal,
      );
      execution.operationIds.delete(operationId);
      execution.task = taskReferenceFromOperation(operation) ?? execution.task;
    }
  }

  private async rollbackActiveTask(execution: ActiveExecution): Promise<void> {
    const task = execution.task;
    if (task === undefined) {
      return;
    }
    try {
      await this.dependencies.rollback.cancelTask(task);
    } catch (error) {
      this.emitFailed(
        execution,
        'TASK_ROLLBACK_FAILED',
        'Agent Task rollback failed',
      );
      throw new AgentTaskRollbackError(error);
    }
    execution.task = undefined;
  }

  private emitTerminal(
    execution: ActiveExecution,
    status: 'completed' | 'cancelled',
  ): void {
    execution.emit(
      status === 'completed'
        ? {
            type: 'agent.executionCompleted',
            projectId: execution.projectId,
            sessionId: execution.sessionId,
            executionId: execution.executionId,
          }
        : {
            type: 'agent.executionCancelled',
            projectId: execution.projectId,
            sessionId: execution.sessionId,
            executionId: execution.executionId,
          },
    );
  }

  private emitFailed(
    execution: ActiveExecution,
    code: string,
    message: string,
  ): void {
    execution.emit({
      type: 'agent.executionFailed',
      projectId: execution.projectId,
      sessionId: execution.sessionId,
      executionId: execution.executionId,
      code,
      message,
    });
  }
}
