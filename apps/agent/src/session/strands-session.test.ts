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
  AgentConversationMessage,
  AgentSessionId,
} from '@agent-music/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createStrandsSession,
  readStrandsConversation,
} from './strands-session.js';

const sessionId = '33333333-3333-4333-8333-333333333333' as AgentSessionId;
const tempDirectories: string[] = [];

class NoopModel extends Model {
  private config: BaseModelConfig = { modelId: 'session-test-model' };

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

const createNoopModel = (): NoopModel => new NoopModel();

const makeStorageRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'strands-session-'));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('createStrandsSession', () => {
  it('restores conversation state using Strands SessionManager and LocalFileStorage', async () => {
    const storageRoot = await makeStorageRoot();
    const first = createStrandsSession(sessionId, storageRoot);
    const firstAgent = new Agent({
      model: createNoopModel(),
      messages: [
        {
          role: 'user',
          content: [{ text: 'Remember this bass motif.' }],
        },
        {
          role: 'assistant',
          content: [{ text: 'I will keep it in this Session.' }],
        },
      ],
      sessionManager: first.sessionManager,
      storage: first.storage,
      contextManager: 'auto',
      printer: false,
    });
    await firstAgent.initialize();
    await first.sessionManager.saveSnapshot({
      target: firstAgent,
      isLatest: true,
    });

    const second = createStrandsSession(sessionId, storageRoot);
    const restoredAgent = new Agent({
      model: createNoopModel(),
      sessionManager: second.sessionManager,
      storage: second.storage,
      contextManager: 'auto',
      printer: false,
    });
    await restoredAgent.initialize();

    expect(restoredAgent.sessionId).toBe(sessionId);
    expect(restoredAgent.messages.map((message) => message.toJSON())).toEqual(
      firstAgent.messages.map((message) => message.toJSON()),
    );
  });

  it('projects restored Session history to user/assistant text without tool internals', async () => {
    const storageRoot = await makeStorageRoot();
    const resources = createStrandsSession(sessionId, storageRoot);
    const agent = new Agent({
      model: createNoopModel(),
      messages: [
        {
          role: 'user',
          content: [{ text: 'Make the bass line tighter.' }],
        },
        {
          role: 'assistant',
          content: [{ text: 'I will tighten the syncopation.' }],
        },
        {
          role: 'assistant',
          content: [
            {
              toolUse: {
                name: 'getScopedComposition',
                toolUseId: 'tool-1',
                input: { hidden: 'internal' },
              },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              toolResult: {
                toolUseId: 'tool-1',
                status: 'success',
                content: [{ text: 'private tool result' }],
              },
            },
          ],
        },
      ],
      sessionManager: resources.sessionManager,
      storage: resources.storage,
      contextManager: 'auto',
      printer: false,
    });
    await agent.initialize();
    await resources.sessionManager.saveSnapshot({
      target: agent,
      isLatest: true,
    });

    const messages = await readStrandsConversation(sessionId, storageRoot);
    const expected: readonly AgentConversationMessage[] = [
      { role: 'user', text: 'Make the bass line tighter.' },
      { role: 'assistant', text: 'I will tighten the syncopation.' },
    ];

    expect(messages).toEqual(expected);
  });

  it('isolates different Session IDs inside the same Strands storage root', async () => {
    const storageRoot = await makeStorageRoot();
    const first = createStrandsSession(sessionId, storageRoot);
    const firstAgent = new Agent({
      model: createNoopModel(),
      messages: [
        { role: 'user', content: [{ text: 'Only Session A knows this.' }] },
      ],
      sessionManager: first.sessionManager,
      storage: first.storage,
      contextManager: 'auto',
      printer: false,
    });
    await firstAgent.initialize();
    await first.sessionManager.saveSnapshot({
      target: firstAgent,
      isLatest: true,
    });

    const otherSessionId =
      '44444444-4444-4444-8444-444444444444' as AgentSessionId;
    const other = createStrandsSession(otherSessionId, storageRoot);
    const otherAgent = new Agent({
      model: createNoopModel(),
      sessionManager: other.sessionManager,
      storage: other.storage,
      contextManager: 'auto',
      printer: false,
    });
    await otherAgent.initialize();

    expect(otherAgent.messages).toEqual([]);
  });
});
