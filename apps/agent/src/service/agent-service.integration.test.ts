import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Agent,
  Model,
  type BaseModelConfig,
  type ModelStreamEvent,
} from '@strands-agents/sdk';
import type {
  AgentEvent,
  AgentExecutionId,
  AgentSessionId,
  CandidateId,
  ProjectId,
  TaskId,
} from '@agent-music/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createStrandsSession,
  readStrandsConversation,
  SessionRegistry,
} from '../session/index.js';
import {
  AgentWorkflow,
  type AgentRuntimeFactoryPort,
  type AgentRuntimePort,
  type TaskRollbackPort,
} from '../workflow/index.js';
import { AgentService } from './agent-service.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const sessionId = '22222222-2222-4222-8222-222222222222' as AgentSessionId;
const executionId = '33333333-3333-4333-8333-333333333333' as AgentExecutionId;
const taskId = '44444444-4444-4444-8444-444444444444' as TaskId;
const candidateId = '55555555-5555-4555-8555-555555555555' as CandidateId;
const tempDirectories: string[] = [];

class NoopModel extends Model {
  private config: BaseModelConfig = { modelId: 'service-integration-test' };

  public override updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  public override getConfig(): BaseModelConfig {
    return this.config;
  }

  public override async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    const events: readonly ModelStreamEvent[] = [];
    for (const event of events) {
      yield event;
    }
  }
}

const makeRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-service-integration-'));
  tempDirectories.push(directory);
  return directory;
};

const cancellableRuntime = (): AgentRuntimePort => ({
  stream: async function* (_text, signal) {
    const events: readonly unknown[] = [];
    for (const event of events) {
      yield event;
    }
    if (!signal.aborted) {
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
    return { stopReason: 'cancelled' };
  },
  dispose: () => Promise.resolve(),
});

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AgentService lifecycle integration', () => {
  it('rolls back an Active Task on service shutdown while preserving Strands Session history', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'sessions');
    const sessions = new SessionRegistry({
      indexPath: join(root, 'session-index.json'),
      createId: () => sessionId,
      now: () => '2026-09-09T00:00:00.000Z',
    });
    await sessions.create(projectId);

    const resources = createStrandsSession(sessionId, storageRoot);
    const persistedAgent = new Agent({
      model: new NoopModel(),
      messages: [
        { role: 'user', content: [{ text: 'Keep this conversation.' }] },
        {
          role: 'assistant',
          content: [{ text: 'It will survive execution cleanup.' }],
        },
      ],
      sessionManager: resources.sessionManager,
      storage: resources.storage,
      contextManager: 'auto',
      printer: false,
    });
    await persistedAgent.initialize();
    await resources.sessionManager.saveSnapshot({
      target: persistedAgent,
      isLatest: true,
    });

    const runtimeFactory: AgentRuntimeFactoryPort = {
      create: () => Promise.resolve(cancellableRuntime()),
    };
    const cancelTask = vi
      .fn<TaskRollbackPort['cancelTask']>()
      .mockResolvedValue(undefined);
    const workflow = new AgentWorkflow({
      runtimeFactory,
      rollback: { cancelTask },
      settings: { getMaxRepairAttempts: () => Promise.resolve(1) },
      createExecutionId: () => executionId,
    });
    const service = new AgentService({
      sessions,
      workflow,
      readConversation: (id) => readStrandsConversation(id, storageRoot),
    });
    const events: AgentEvent[] = [];

    await service.handle(
      {
        type: 'agent.message.send',
        requestId: 'send',
        projectId,
        sessionId,
        task: { taskId, candidateId },
        text: 'Continue editing.',
      },
      (event) => {
        events.push(event);
      },
    );
    await vi.waitFor(() => {
      expect(workflow.isRunning(projectId)).toBe(true);
    });

    await service.shutdown();

    expect(cancelTask).toHaveBeenCalledWith({
      projectId,
      candidateId,
      taskId,
    });
    expect(events.at(-1)?.type).toBe('agent.executionCancelled');
    await expect(
      readStrandsConversation(sessionId, storageRoot),
    ).resolves.toEqual([
      { role: 'user', text: 'Keep this conversation.' },
      {
        role: 'assistant',
        text: 'It will survive execution cleanup.',
      },
    ]);
  });
});
