import type { ProjectId } from '@agent-music/contracts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectWriteLock } from './project-lock.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from './test-support.js';

const projectId = 'f31dd9a5-2f55-4bd0-8cf6-f684c41314cc' as ProjectId;
let root: string;
let lockPath: string;

beforeEach(async () => {
  root = await createTemporaryDirectory('a1-lock-');
  lockPath = join(root, '.agent-music', 'locks', 'project-write.lock');
  await mkdir(join(root, '.agent-music', 'locks'), { recursive: true });
});

afterEach(async () => removeTemporaryDirectory(root));

describe('ProjectWriteLock', () => {
  it('rejects a second live owner', async () => {
    const first = await ProjectWriteLock.acquire(
      root,
      projectId,
      () => 'alive',
    );

    await expect(
      ProjectWriteLock.acquire(root, projectId, () => 'alive'),
    ).rejects.toMatchObject({ code: 'PROJECT_WRITE_LOCKED' });

    await first.release();
  });

  it('replaces a stale lock once', async () => {
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        projectId,
        instanceId: 'stale',
        pid: 999999,
        acquiredAt: new Date(0).toISOString(),
      }),
    );

    const lock = await ProjectWriteLock.acquire(root, projectId, () => 'dead');
    await expect(lock.assertOwned()).resolves.toBeUndefined();
    await lock.release();
  });

  it('fails closed after its lock token is replaced', async () => {
    const lock = await ProjectWriteLock.acquire(root, projectId, () => 'alive');
    const record = JSON.parse(await readFile(lockPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      lockPath,
      JSON.stringify({ ...record, instanceId: 'different-owner' }),
    );

    await expect(lock.assertOwned()).rejects.toMatchObject({
      code: 'PROJECT_WRITE_LOCK_LOST',
    });
    await lock.release();
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({
      instanceId: 'different-owner',
    });
  });
});
