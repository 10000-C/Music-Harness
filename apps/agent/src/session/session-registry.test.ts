import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentSessionId, ProjectId } from '@agent-music/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionRegistry, SessionRegistryError } from './session-registry.js';

const projectA = '11111111-1111-4111-8111-111111111111' as ProjectId;
const projectB = '22222222-2222-4222-8222-222222222222' as ProjectId;
const sessionA = '33333333-3333-4333-8333-333333333333' as AgentSessionId;
const sessionB = '44444444-4444-4444-8444-444444444444' as AgentSessionId;
const sessionC = '55555555-5555-4555-8555-555555555555' as AgentSessionId;

const tempDirectories: string[] = [];

const makeRegistry = async (
  ids: readonly AgentSessionId[],
): Promise<{
  readonly path: string;
  readonly registry: SessionRegistry;
}> => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-session-index-'));
  tempDirectories.push(directory);
  const remainingIds = [...ids];
  return {
    path: join(directory, 'session-index.json'),
    registry: new SessionRegistry({
      indexPath: join(directory, 'session-index.json'),
      createId: () => {
        const id = remainingIds.shift();
        if (id === undefined) {
          throw new Error('No test session ID available');
        }
        return id;
      },
      now: () => '2026-09-09T00:00:00.000Z',
    }),
  };
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SessionRegistry', () => {
  it('creates multiple Sessions for one Project with one active Session', async () => {
    const { registry } = await makeRegistry([sessionA, sessionB]);

    const first = await registry.create(projectA);
    expect(first.sessionId).toBe(sessionA);
    await expect(registry.getActive(projectA)).resolves.toEqual(first);

    const second = await registry.create(projectA);
    expect(second.sessionId).toBe(sessionB);
    await expect(registry.list(projectA)).resolves.toEqual([first, second]);
    await expect(registry.getActive(projectA)).resolves.toEqual(second);

    await expect(registry.open(projectA, sessionA)).resolves.toEqual(first);
    await expect(registry.getActive(projectA)).resolves.toEqual(first);
  });

  it('isolates Sessions by Project and rejects cross-Project opens', async () => {
    const { registry } = await makeRegistry([sessionA, sessionC]);
    await registry.create(projectA);
    await registry.create(projectB);

    await expect(registry.list(projectA)).resolves.toHaveLength(1);
    await expect(registry.list(projectB)).resolves.toHaveLength(1);
    await expect(registry.open(projectB, sessionA)).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    } satisfies Partial<SessionRegistryError>);
  });

  it('reloads Project associations and the active Session from disk', async () => {
    const { path, registry } = await makeRegistry([sessionA, sessionB]);
    const first = await registry.create(projectA);
    const second = await registry.create(projectA);
    await registry.open(projectA, first.sessionId);

    const reloaded = new SessionRegistry({
      indexPath: path,
      createId: () => sessionC,
      now: () => '2026-09-09T01:00:00.000Z',
    });

    await expect(reloaded.list(projectA)).resolves.toEqual([first, second]);
    await expect(reloaded.getActive(projectA)).resolves.toEqual(first);
  });

  it('treats a Save-As Project ID as a separate Session namespace', async () => {
    const { registry } = await makeRegistry([sessionA]);
    await registry.create(projectA);

    await expect(registry.list(projectB)).resolves.toEqual([]);
    await expect(registry.getActive(projectB)).resolves.toBeUndefined();
  });

  it('can clear the active Session without deleting conversation metadata', async () => {
    const { registry } = await makeRegistry([sessionA]);
    const created = await registry.create(projectA);

    await registry.close(projectA);

    await expect(registry.getActive(projectA)).resolves.toBeUndefined();
    await expect(registry.list(projectA)).resolves.toEqual([created]);
  });
});
