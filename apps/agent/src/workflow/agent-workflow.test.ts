import type {
  AgentEvent,
  AgentExecutionId,
  AgentSessionId,
  CandidateId,
  ProjectId,
  TaskContextView,
  TaskId,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  AgentWorkflow,
  type AgentRuntimeFactoryPort,
  type AgentRuntimePort,
  type TaskRollbackPort,
} from './agent-workflow.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const sessionId = '22222222-2222-4222-8222-222222222222' as AgentSessionId;
const executionId = '33333333-3333-4333-8333-333333333333' as AgentExecutionId;
const taskId = '44444444-4444-4444-8444-444444444444' as TaskId;
const candidateId = '55555555-5555-4555-8555-555555555555' as CandidateId;

const task: TaskContextView = {
  taskId,
  projectId,
  candidateId,
  baseRevision: 'abc123',
  scope: {
    type: 'wholeProject',
    trackIds: [
      'track.drums',
      'track.bass',
      'track.guitar',
      'track.keys',
      'track.strings',
      'track.winds',
    ],
  },
  scopeRevision: 0,
  state: 'editing',
  candidateState: 'active',
  allowedOperations: ['replaceScopedMusic', 'updateGlobalMeter'],
  trackIds: [
    'track.drums',
    'track.bass',
    'track.guitar',
    'track.keys',
    'track.strings',
    'track.winds',
  ],
  createdAt: '2026-09-09T00:00:00.000Z',
};

const textDelta = (text: string): unknown => ({
  type: 'modelStreamUpdateEvent',
  event: {
    type: 'modelContentBlockDeltaEvent',
    delta: { type: 'textDelta', text },
  },
});

const toolResult = (name: string, value: unknown): unknown => ({
  type: 'afterToolCallEvent',
  toolUse: { name, toolUseId: `${name}-1`, input: {} },
  result: {
    status: 'success',
    content: [{ text: JSON.stringify(value) }],
  },
});

interface RuntimeScript {
  readonly events?: readonly unknown[];
  readonly error?: Error;
  readonly waitForAbort?: boolean;
}

const runtimeFromScript = (
  script: RuntimeScript,
  prompts: (string | undefined)[],
): AgentRuntimePort => ({
  stream: async function* (text, signal) {
    prompts.push(text);
    for (const event of script.events ?? []) {
      yield event;
    }
    if (script.waitForAbort === true && !signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true },
        );
      });
    }
    if (script.error !== undefined) {
      throw script.error;
    }
    return { stopReason: signal.aborted ? 'cancelled' : 'endTurn' };
  },
  dispose: vi.fn().mockResolvedValue(undefined),
});

const makeHarness = (
  scripts: readonly RuntimeScript[],
  maxRepairAttempts: readonly number[] = [2],
) => {
  const runtimes = [...scripts];
  const prompts: (string | undefined)[] = [];
  const create = vi.fn(
    (
      project: ProjectId,
      session: AgentSessionId,
      options: {
        readonly repairMode: boolean;
        readonly instructions: string;
      },
    ): Promise<AgentRuntimePort> => {
      void project;
      void session;
      void options;
      const script = runtimes.shift();
      if (script === undefined) {
        throw new Error('No runtime script configured');
      }
      return Promise.resolve(runtimeFromScript(script, prompts));
    },
  );
  const runtimeFactory: AgentRuntimeFactoryPort = { create };
  const cancelTask = vi.fn().mockResolvedValue(undefined);
  const rollback: TaskRollbackPort = { cancelTask };
  const getMaxRepairAttempts = vi.fn();
  for (const value of maxRepairAttempts) {
    getMaxRepairAttempts.mockResolvedValueOnce(value);
  }
  const events: AgentEvent[] = [];
  let resolveTerminal: (() => void) | undefined;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  const emit = (event: AgentEvent): void => {
    events.push(event);
    if (event.type !== 'agent.textDelta') {
      resolveTerminal?.();
    }
  };
  const workflow = new AgentWorkflow({
    runtimeFactory,
    rollback,
    settings: { getMaxRepairAttempts },
    createExecutionId: () => executionId,
  });
  return {
    workflow,
    create,
    cancelTask,
    getMaxRepairAttempts,
    events,
    emit,
    terminal,
    prompts,
  };
};

const start = (
  workflow: AgentWorkflow,
  emit: (event: AgentEvent) => void,
  confirmedTask?: {
    readonly taskId: TaskId;
    readonly candidateId: CandidateId;
  },
): AgentExecutionId =>
  workflow.startExecution(
    {
      projectId,
      sessionId,
      ...(confirmedTask === undefined ? {} : { task: confirmedTask }),
      text: 'Create a groove.',
    },
    emit,
  );

describe('AgentWorkflow', () => {
  it('projects only assistant text deltas and one terminal event', async () => {
    const harness = makeHarness([
      {
        events: [
          textDelta('First '),
          { type: 'toolResultEvent', result: { private: 'raw tool result' } },
          textDelta('answer.'),
        ],
      },
    ]);

    expect(start(harness.workflow, harness.emit)).toBe(executionId);
    await harness.terminal;

    expect(harness.events).toEqual([
      {
        type: 'agent.textDelta',
        projectId,
        sessionId,
        executionId,
        text: 'First ',
      },
      {
        type: 'agent.textDelta',
        projectId,
        sessionId,
        executionId,
        text: 'answer.',
      },
      {
        type: 'agent.executionCompleted',
        projectId,
        sessionId,
        executionId,
      },
    ]);
  });

  it('cancels a pre-Task execution without rollback', async () => {
    const harness = makeHarness([{ waitForAbort: true }]);

    start(harness.workflow, harness.emit);
    await harness.workflow.cancelCurrentExecution(projectId);
    await harness.terminal;

    expect(harness.cancelTask).not.toHaveBeenCalled();
    expect(harness.events.at(-1)).toEqual({
      type: 'agent.executionCancelled',
      projectId,
      sessionId,
      executionId,
    });
  });

  it('rolls back an active Task when the user cancels execution', async () => {
    const harness = makeHarness([
      {
        events: [toolResult('submitGenerationPlan', { approved: true, task })],
        waitForAbort: true,
      },
    ]);

    start(harness.workflow, harness.emit);
    await vi.waitFor(() => {
      expect(harness.workflow.isRunning(projectId)).toBe(true);
    });
    await harness.workflow.cancelCurrentExecution(projectId);
    await harness.terminal;

    expect(harness.cancelTask).toHaveBeenCalledWith({
      projectId,
      candidateId,
      taskId,
    });
    expect(harness.events.at(-1)).toEqual({
      type: 'agent.executionCancelled',
      projectId,
      sessionId,
      executionId,
    });
  });

  it('bootstraps an already-confirmed local Task before the first model call', async () => {
    const harness = makeHarness([{ error: new Error('provider failed') }]);

    start(harness.workflow, harness.emit, { taskId, candidateId });
    await harness.terminal;

    expect(harness.prompts[0]).toBe('Create a groove.');
    expect(harness.create.mock.calls[0]?.[2].instructions).toContain(taskId);
    expect(harness.create.mock.calls[0]?.[2].instructions).toContain(
      'getTaskContext',
    );
    expect(harness.cancelTask).toHaveBeenCalledWith({
      projectId,
      candidateId,
      taskId,
    });
  });

  it('rolls back on a final runtime error without entering repair', async () => {
    const harness = makeHarness([
      {
        events: [toolResult('submitGenerationPlan', { approved: true, task })],
        error: new Error('provider secret details'),
      },
    ]);

    start(harness.workflow, harness.emit);
    await harness.terminal;

    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.getMaxRepairAttempts).not.toHaveBeenCalled();
    expect(harness.cancelTask).toHaveBeenCalledOnce();
    expect(harness.events.at(-1)).toEqual({
      type: 'agent.executionFailed',
      projectId,
      sessionId,
      executionId,
      code: 'AGENT_EXECUTION_FAILED',
      message: 'Agent execution failed',
    });
  });

  it('enters repair only after validation failure and succeeds within the existing Scope', async () => {
    const invalidFinish = {
      candidate: {
        candidateId,
        projectId,
        baseRevision: 'abc123',
        state: 'editing',
      },
      validation: {
        valid: false,
        issues: [{ code: 'METER_MISMATCH', message: 'Meter mismatch' }],
      },
    };
    const validFinish = {
      candidate: {
        candidateId,
        projectId,
        baseRevision: 'abc123',
        state: 'ready',
      },
      validation: { valid: true, issues: [] },
    };
    const harness = makeHarness([
      {
        events: [
          toolResult('submitGenerationPlan', { approved: true, task }),
          toolResult('finishTask', invalidFinish),
        ],
      },
      { events: [toolResult('finishTask', validFinish), textDelta('Fixed.')] },
    ]);

    start(harness.workflow, harness.emit);
    await harness.terminal;

    expect(harness.create).toHaveBeenCalledTimes(2);
    expect(harness.create.mock.calls[0]?.[2].repairMode).toBe(false);
    expect(harness.create.mock.calls[1]?.[2].repairMode).toBe(true);
    expect(harness.prompts).toEqual(['Create a groove.', undefined]);
    expect(harness.create.mock.calls[1]?.[2].instructions).toContain(
      'METER_MISMATCH',
    );
    expect(harness.getMaxRepairAttempts).toHaveBeenCalledTimes(1);
    expect(harness.cancelTask).not.toHaveBeenCalled();
    expect(harness.events.at(-1)?.type).toBe('agent.executionCompleted');
  });

  it('reads the latest repair limit before each next cycle and rolls back when the lowered limit is reached', async () => {
    const invalidFinish = {
      candidate: {
        candidateId,
        projectId,
        baseRevision: 'abc123',
        state: 'editing',
      },
      validation: {
        valid: false,
        issues: [{ code: 'INVALID', message: 'Still invalid' }],
      },
    };
    const harness = makeHarness(
      [
        {
          events: [
            toolResult('submitGenerationPlan', { approved: true, task }),
            toolResult('finishTask', invalidFinish),
          ],
        },
        { events: [toolResult('finishTask', invalidFinish)] },
      ],
      [2, 1],
    );

    start(harness.workflow, harness.emit);
    await harness.terminal;

    expect(harness.create).toHaveBeenCalledTimes(2);
    expect(harness.getMaxRepairAttempts).toHaveBeenCalledTimes(2);
    expect(harness.cancelTask).toHaveBeenCalledOnce();
    expect(harness.events.at(-1)).toMatchObject({
      type: 'agent.executionFailed',
      code: 'REPAIR_LIMIT_EXCEEDED',
      message: 'Agent repair limit exceeded',
    });
  });
});
