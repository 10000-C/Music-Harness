import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentConversationMessage,
  AgentEvent,
  AgentExecutionId,
  AgentSessionId,
  CandidateId,
  ProjectId,
  TaskId,
} from '@agent-music/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionRegistry } from '../session/index.js';
import {
  AgentService,
  AgentServiceError,
  type AgentServiceWorkflowPort,
} from './agent-service.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const otherProjectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const sessionIdA = '33333333-3333-4333-8333-333333333333' as AgentSessionId;
const sessionIdB = '44444444-4444-4444-8444-444444444444' as AgentSessionId;
const executionId = '55555555-5555-4555-8555-555555555555' as AgentExecutionId;
const taskId = '66666666-6666-4666-8666-666666666666' as TaskId;
const candidateId = '77777777-7777-4777-8777-777777777777' as CandidateId;
const tempDirectories: string[] = [];

const makeRegistry = async (): Promise<SessionRegistry> => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-service-'));
  tempDirectories.push(directory);
  const ids = [sessionIdA, sessionIdB];
  return new SessionRegistry({
    indexPath: join(directory, 'session-index.json'),
    createId: () => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error('No Session ID configured');
      }
      return id;
    },
    now: () => '2026-09-09T00:00:00.000Z',
  });
};

const makeWorkflow = () => {
  const isRunning = vi
    .fn<AgentServiceWorkflowPort['isRunning']>()
    .mockReturnValue(false);
  const startExecution = vi
    .fn<AgentServiceWorkflowPort['startExecution']>()
    .mockReturnValue(executionId);
  const cancelCurrentExecution = vi
    .fn<AgentServiceWorkflowPort['cancelCurrentExecution']>()
    .mockResolvedValue(undefined);
  const shutdown = vi
    .fn<AgentServiceWorkflowPort['shutdown']>()
    .mockResolvedValue(undefined);
  const workflow: AgentServiceWorkflowPort = {
    isRunning,
    startExecution,
    cancelCurrentExecution,
    shutdown,
  };
  return {
    workflow,
    isRunning,
    startExecution,
    cancelCurrentExecution,
    shutdown,
  };
};

const makeService = async (options?: {
  readonly workflow?: AgentServiceWorkflowPort;
  readonly messages?: ReadonlyMap<
    AgentSessionId,
    readonly AgentConversationMessage[]
  >;
}) => {
  const sessions = await makeRegistry();
  const workflow = options?.workflow ?? makeWorkflow().workflow;
  const readConversation = vi.fn((sessionId: AgentSessionId) =>
    Promise.resolve(options?.messages?.get(sessionId) ?? []),
  );
  const service = new AgentService({ sessions, workflow, readConversation });
  return { service, sessions, workflow, readConversation };
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AgentService', () => {
  it('routes Project multi-Session lifecycle and restores history on open/getActive', async () => {
    const messagesA: readonly AgentConversationMessage[] = [
      { role: 'user', text: 'Remember this groove.' },
      { role: 'assistant', text: 'Stored in this Session.' },
    ];
    const { service } = await makeService({
      messages: new Map([[sessionIdA, messagesA]]),
    });

    const createdA = await service.handle(
      { type: 'agent.session.create', requestId: 'create-a', projectId },
      vi.fn(),
    );
    const createdB = await service.handle(
      { type: 'agent.session.create', requestId: 'create-b', projectId },
      vi.fn(),
    );
    const listed = await service.handle(
      { type: 'agent.session.list', requestId: 'list', projectId },
      vi.fn(),
    );
    const opened = await service.handle(
      {
        type: 'agent.session.open',
        requestId: 'open-a',
        projectId,
        sessionId: sessionIdA,
      },
      vi.fn(),
    );
    const active = await service.handle(
      { type: 'agent.session.getActive', requestId: 'active', projectId },
      vi.fn(),
    );

    expect(createdA).toMatchObject({
      type: 'agent.session.created',
      session: { sessionId: sessionIdA, projectId },
    });
    expect(createdB).toMatchObject({
      type: 'agent.session.created',
      session: { sessionId: sessionIdB, projectId },
    });
    expect(listed).toMatchObject({
      type: 'agent.session.listed',
      sessions: [{ sessionId: sessionIdA }, { sessionId: sessionIdB }],
    });
    expect(opened).toMatchObject({
      type: 'agent.session.opened',
      requestId: 'open-a',
      session: { sessionId: sessionIdA, projectId },
      messages: messagesA,
    });
    expect(active).toMatchObject({
      type: 'agent.session.active',
      requestId: 'active',
      session: { sessionId: sessionIdA, projectId },
      messages: messagesA,
    });
  });

  it('rejects Session create/open while an execution is active', async () => {
    const workflow = makeWorkflow();
    workflow.isRunning.mockReturnValue(true);
    const { service, sessions } = await makeService({
      workflow: workflow.workflow,
    });
    await sessions.create(projectId);

    await expect(
      service.handle(
        { type: 'agent.session.create', requestId: 'create', projectId },
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      code: 'SESSION_SWITCH_DURING_EXECUTION',
    } satisfies Partial<AgentServiceError>);
    await expect(
      service.handle(
        {
          type: 'agent.session.open',
          requestId: 'open',
          projectId,
          sessionId: sessionIdA,
        },
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      code: 'SESSION_SWITCH_DURING_EXECUTION',
    } satisfies Partial<AgentServiceError>);
  });

  it('starts execution only for the active Session and forwards its AgentEvent sink', async () => {
    const workflow = makeWorkflow();
    workflow.startExecution.mockImplementation((input, emit) => {
      emit({
        type: 'agent.textDelta',
        projectId: input.projectId,
        sessionId: input.sessionId,
        executionId,
        text: 'Working.',
      });
      emit({
        type: 'agent.executionCompleted',
        projectId: input.projectId,
        sessionId: input.sessionId,
        executionId,
      });
      return executionId;
    });
    const { service, sessions } = await makeService({
      workflow: workflow.workflow,
    });
    await sessions.create(projectId);
    const events: AgentEvent[] = [];

    const result = await service.handle(
      {
        type: 'agent.message.send',
        requestId: 'send',
        projectId,
        sessionId: sessionIdA,
        task: { taskId, candidateId },
        text: 'Tighten the bass line.',
      },
      (event) => {
        events.push(event);
      },
    );

    expect(result).toEqual({
      type: 'agent.message.accepted',
      requestId: 'send',
      executionId,
    });
    expect(workflow.startExecution).toHaveBeenCalledWith(
      {
        projectId,
        sessionId: sessionIdA,
        task: { taskId, candidateId },
        text: 'Tighten the bass line.',
      },
      expect.any(Function),
    );
    expect(events.map((event) => event.type)).toEqual([
      'agent.textDelta',
      'agent.executionCompleted',
    ]);
  });

  it('rejects messages for an inactive or cross-Project Session', async () => {
    const { service, sessions } = await makeService();
    await sessions.create(projectId);
    await sessions.create(projectId);

    await expect(
      service.handle(
        {
          type: 'agent.message.send',
          requestId: 'inactive',
          projectId,
          sessionId: sessionIdA,
          text: 'Do not run in the background.',
        },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_ACTIVE' });

    await expect(
      service.handle(
        {
          type: 'agent.message.send',
          requestId: 'cross-project',
          projectId: otherProjectId,
          sessionId: sessionIdB,
          text: 'Wrong Project.',
        },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_ACTIVE' });
  });

  it('rejects a second message while execution is already running', async () => {
    const workflow = makeWorkflow();
    workflow.isRunning.mockReturnValue(true);
    const { service, sessions } = await makeService({
      workflow: workflow.workflow,
    });
    await sessions.create(projectId);

    await expect(
      service.handle(
        {
          type: 'agent.message.send',
          requestId: 'busy',
          projectId,
          sessionId: sessionIdA,
          text: 'Second message.',
        },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: 'AGENT_EXECUTION_BUSY' });
  });

  it('routes cancel and waits for workflow shutdown', async () => {
    const workflow = makeWorkflow();
    const { service } = await makeService({ workflow: workflow.workflow });

    const result = await service.handle(
      { type: 'agent.execution.cancel', requestId: 'cancel', projectId },
      vi.fn(),
    );
    await service.shutdown();

    expect(workflow.cancelCurrentExecution).toHaveBeenCalledWith(projectId);
    expect(result).toEqual({
      type: 'agent.execution.cancelAccepted',
      requestId: 'cancel',
    });
    expect(workflow.shutdown).toHaveBeenCalledOnce();
  });
});
