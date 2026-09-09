import type {
  AgentCommand,
  AgentCommandResult,
  AgentEvent,
  AgentProcessEvent,
  ProjectId,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  AgentProcessEntrypoint,
  type AgentProcessServicePort,
} from './agent-process-entrypoint.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;

const makeHarness = () => {
  const handle = vi.fn<AgentProcessServicePort['handle']>();
  const shutdown = vi
    .fn<AgentProcessServicePort['shutdown']>()
    .mockResolvedValue(undefined);
  const service: AgentProcessServicePort = { handle, shutdown };
  const events: AgentProcessEvent[] = [];
  const entrypoint = new AgentProcessEntrypoint(service, (event) => {
    events.push(event);
  });
  return { entrypoint, handle, shutdown, events };
};

describe('AgentProcessEntrypoint', () => {
  it('announces readiness and answers health checks', async () => {
    const harness = makeHarness();

    harness.entrypoint.start();
    await harness.entrypoint.handle({
      type: 'agent.process.health',
      requestId: 'health-1',
    });

    expect(harness.events).toEqual([
      { type: 'agent.process.ready' },
      { type: 'agent.process.healthy', requestId: 'health-1' },
    ]);
  });

  it('routes Agent commands and wraps command results and streamed events', async () => {
    const harness = makeHarness();
    const command: AgentCommand = {
      type: 'agent.session.list',
      requestId: 'list-1',
      projectId,
    };
    const result: AgentCommandResult = {
      type: 'agent.session.listed',
      requestId: 'list-1',
      sessions: [],
    };
    const streamed: AgentEvent = {
      type: 'agent.executionFailed',
      projectId,
      sessionId: '22222222-2222-4222-8222-222222222222' as never,
      executionId: '33333333-3333-4333-8333-333333333333' as never,
      code: 'AGENT_EXECUTION_FAILED',
      message: 'Agent execution failed',
    };
    harness.handle.mockImplementation((_command, emit) => {
      emit(streamed);
      return Promise.resolve(result);
    });

    await harness.entrypoint.handle(command);

    expect(harness.handle).toHaveBeenCalledWith(command, expect.any(Function));
    expect(harness.events).toEqual([
      { type: 'agent.process.agentEvent', event: streamed },
      { type: 'agent.process.commandResult', result },
    ]);
  });

  it('escalates Task rollback failure to the process supervisor', async () => {
    const harness = makeHarness();
    const failure: AgentEvent = {
      type: 'agent.executionFailed',
      projectId,
      sessionId: '22222222-2222-4222-8222-222222222222' as never,
      executionId: '33333333-3333-4333-8333-333333333333' as never,
      code: 'TASK_ROLLBACK_FAILED',
      message: 'Agent Task rollback failed',
    };
    harness.handle.mockImplementation((_command, emit) => {
      emit(failure);
      return Promise.resolve({
        type: 'agent.message.accepted',
        requestId: 'send-rollback',
        executionId: '33333333-3333-4333-8333-333333333333' as never,
      });
    });

    await harness.entrypoint.handle({
      type: 'agent.message.send',
      requestId: 'send-rollback',
      projectId,
      sessionId: '22222222-2222-4222-8222-222222222222' as never,
      text: 'Continue.',
    });

    expect(harness.events).toContainEqual({
      type: 'agent.process.agentEvent',
      event: failure,
    });
    expect(harness.events).toContainEqual({
      type: 'agent.process.fatal',
      code: 'AGENT_TASK_ROLLBACK_FAILED',
      message: 'Agent Task rollback failed',
    });
  });

  it('returns safe structured command failures', async () => {
    const harness = makeHarness();
    harness.handle.mockRejectedValue(
      Object.assign(
        new Error('Agent Session cannot be switched while execution is active'),
        {
          code: 'SESSION_SWITCH_DURING_EXECUTION',
        },
      ),
    );

    await harness.entrypoint.handle({
      type: 'agent.session.create',
      requestId: 'create-1',
      projectId,
    });

    expect(harness.events).toEqual([
      {
        type: 'agent.process.commandFailed',
        requestId: 'create-1',
        code: 'SESSION_SWITCH_DURING_EXECUTION',
        message: 'Agent Session cannot be switched while execution is active',
      },
    ]);
  });

  it('redacts unexpected command failures', async () => {
    const harness = makeHarness();
    harness.handle.mockRejectedValue(
      new Error('/private/path secret-provider-error'),
    );

    await harness.entrypoint.handle({
      type: 'agent.session.list',
      requestId: 'list-2',
      projectId,
    });

    expect(harness.events).toEqual([
      {
        type: 'agent.process.commandFailed',
        requestId: 'list-2',
        code: 'AGENT_COMMAND_FAILED',
        message: 'Agent command failed',
      },
    ]);
  });

  it('shuts down cleanly only after Agent Service cleanup completes', async () => {
    const harness = makeHarness();

    await harness.entrypoint.handle({
      type: 'agent.process.shutdown',
      requestId: 'close-1',
    });

    expect(harness.shutdown).toHaveBeenCalledOnce();
    expect(harness.events).toEqual([
      { type: 'agent.process.stopped', requestId: 'close-1' },
    ]);
  });

  it('publishes fatal instead of stopped when process cleanup fails', async () => {
    const harness = makeHarness();
    harness.shutdown.mockRejectedValue(new Error('rollback unavailable'));

    await expect(
      harness.entrypoint.handle({
        type: 'agent.process.shutdown',
        requestId: 'close-2',
      }),
    ).rejects.toThrow('Agent process cleanup failed');

    expect(harness.events).toEqual([
      {
        type: 'agent.process.fatal',
        code: 'AGENT_PROCESS_CLEANUP_FAILED',
        message: 'Agent process cleanup failed',
      },
    ]);
  });
});
