import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentExecutionId,
  AgentSessionId,
  ProjectId,
} from '@agent-music/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentService } from './index.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const sessionId = '22222222-2222-4222-8222-222222222222' as AgentSessionId;
const executionId = '33333333-3333-4333-8333-333333333333' as AgentExecutionId;
const tempDirectories: string[] = [];

const makeRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-composition-'));
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

describe('createAgentService', () => {
  it('composes the public A4 service with Project Session persistence', async () => {
    const root = await makeRoot();
    const rollback = vi.fn(() => Promise.resolve(undefined));
    const service = createAgentService({
      paths: {
        settingsPath: join(root, 'settings.json'),
        sessionIndexPath: join(root, 'session-index.json'),
        sessionStorageRoot: join(root, 'sessions'),
        runtimeDirectory: join(root, 'runtime'),
      },
      rollback: { cancelTask: rollback },
      createSessionId: () => sessionId,
      createExecutionId: () => executionId,
      now: () => '2026-09-09T00:00:00.000Z',
    });

    const created = await service.handle(
      { type: 'agent.session.create', requestId: 'create', projectId },
      vi.fn(),
    );
    const active = await service.handle(
      { type: 'agent.session.getActive', requestId: 'active', projectId },
      vi.fn(),
    );

    expect(created).toMatchObject({
      type: 'agent.session.created',
      session: { sessionId, projectId },
    });
    expect(active).toMatchObject({
      type: 'agent.session.active',
      session: { sessionId, projectId },
      messages: [],
    });
  });
});
