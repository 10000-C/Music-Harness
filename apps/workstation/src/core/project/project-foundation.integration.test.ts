import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitAdapter } from './git-adapter.js';
import { ProjectFoundation } from './project-foundation.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from './test-support.js';

let parent: string;
const foundations: ProjectFoundation[] = [];
const makeFoundation = (): ProjectFoundation => {
  const foundation = new ProjectFoundation();
  foundations.push(foundation);
  return foundation;
};

beforeEach(async () => {
  parent = await createTemporaryDirectory('a1-integration-');
});

afterEach(async () => {
  for (const foundation of foundations.splice(0)) {
    await foundation.closeProject();
  }
  await removeTemporaryDirectory(parent);
});

describe(
  'ProjectFoundation real Git integration',
  { concurrent: false },
  () => {
    it('creates, closes, and reopens projects under Chinese, spaced, and long nested paths', async () => {
      const foundation = makeFoundation();
      const chinesePath = join(parent, '音乐 工程');
      const created = await foundation.createProject(chinesePath);
      await foundation.closeProject();

      await expect(foundation.openProject(chinesePath)).resolves.toMatchObject({
        projectId: created.projectId,
        state: 'ready',
      });
      await foundation.closeProject();

      const segments = Array.from(
        { length: 9 },
        (_, index) => `long-segment-${String(index)}-${'x'.repeat(24)}`,
      );
      const longPath = join(parent, ...segments, 'project');
      expect(longPath.length).toBeGreaterThan(300);
      await expect(foundation.createProject(longPath)).resolves.toMatchObject({
        state: 'ready',
      });
      expect(await new GitAdapter().statusPorcelain(longPath)).toBe('');
    });

    it('requires explicit recovery and never uses cache, SQLite, Candidate, or exports as authority', async () => {
      const foundation = makeFoundation();
      const projectPath = join(parent, 'recovery');
      const created = await foundation.createProject(projectPath);
      const committedManifest = await readFile(
        join(projectPath, 'project.json'),
        'utf8',
      );
      const committedComposition = await readFile(
        join(projectPath, 'composition.abc'),
        'utf8',
      );
      await mkdir(join(projectPath, '.agent-music', 'candidate'), {
        recursive: true,
      });
      await Promise.all([
        writeFile(
          join(projectPath, '.agent-music', 'cache', 'current.mid'),
          'cache',
        ),
        writeFile(join(projectPath, '.agent-music', 'app.sqlite'), 'sqlite'),
        writeFile(
          join(projectPath, '.agent-music', 'candidate', 'draft.abc'),
          'candidate',
        ),
        writeFile(join(projectPath, 'exports', 'old.wav'), 'export'),
      ]);
      await foundation.closeProject();

      await writeFile(join(projectPath, 'project.json'), '{"external":true}\n');
      const dirtyManifest = await foundation.openProject(projectPath);
      expect(dirtyManifest).toMatchObject({
        projectId: created.projectId,
        state: 'recoveryRequired',
      });
      await foundation.recoverCurrent();
      expect(await readFile(join(projectPath, 'project.json'), 'utf8')).toBe(
        committedManifest,
      );
      await foundation.closeProject();

      await writeFile(
        join(projectPath, 'composition.abc'),
        'external composition',
      );
      await expect(foundation.openProject(projectPath)).resolves.toMatchObject({
        state: 'recoveryRequired',
      });
      await foundation.recoverCurrent();
      expect(await readFile(join(projectPath, 'composition.abc'), 'utf8')).toBe(
        committedComposition,
      );
      expect(await new GitAdapter().statusPorcelain(projectPath)).toBe('');
      expect(
        await readFile(join(projectPath, '.agent-music', 'app.sqlite'), 'utf8'),
      ).toBe('sqlite');
      expect(
        await readFile(join(projectPath, 'exports', 'old.wav'), 'utf8'),
      ).toBe('export');
    });

    it('enforces live locks, replaces stale locks, and fails before writes after ownership loss', async () => {
      const projectPath = join(parent, 'locks');
      const owner = makeFoundation();
      const created = await owner.createProject(projectPath);
      const contender = makeFoundation();

      await expect(contender.openProject(projectPath)).rejects.toMatchObject({
        code: 'PROJECT_WRITE_LOCKED',
      });
      await owner.closeProject();

      const lockPath = join(
        projectPath,
        '.agent-music',
        'locks',
        'project-write.lock',
      );
      await writeFile(
        lockPath,
        `${JSON.stringify({
          version: 1,
          projectId: created.projectId,
          instanceId: 'stale',
          pid: 999999,
          acquiredAt: new Date(0).toISOString(),
        })}\n`,
      );
      await expect(contender.openProject(projectPath)).resolves.toMatchObject({
        state: 'ready',
      });

      const lockRecord = JSON.parse(await readFile(lockPath, 'utf8')) as Record<
        string,
        unknown
      >;
      await writeFile(
        lockPath,
        `${JSON.stringify({ ...lockRecord, instanceId: 'replacement' })}\n`,
      );
      let callbackRan = false;
      await expect(
        contender.runSerializedWrite(() => {
          callbackRan = true;
          return Promise.resolve();
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_WRITE_LOCK_LOST' });
      expect(callbackRan).toBe(false);
    });

    it('serializes three concurrent writes in FIFO order', async () => {
      const foundation = makeFoundation();
      await foundation.createProject(join(parent, 'fifo'));
      const order: string[] = [];
      let releaseFirst: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const first = foundation.runSerializedWrite(async () => {
        order.push('first:start');
        await gate;
        order.push('first:end');
      });
      const second = foundation.runSerializedWrite(() => {
        order.push('second');
        return Promise.resolve();
      });
      const third = foundation.runSerializedWrite(() => {
        order.push('third');
        return Promise.resolve();
      });
      releaseFirst();
      await Promise.all([first, second, third]);

      expect(order).toEqual(['first:start', 'first:end', 'second', 'third']);
    });

    it('creates an isolated Save As history and keeps source usable after target failure', async () => {
      const foundation = makeFoundation();
      const sourcePath = join(parent, 'source');
      const targetPath = join(parent, 'target');
      const git = new GitAdapter();
      const source = await foundation.createProject(sourcePath);

      await foundation.runSerializedWrite(async () => {
        await writeFile(
          join(sourcePath, 'composition.abc'),
          'X:1\nT:Second Current\nK:C\n',
        );
        await git.commitAuthorityFiles(sourcePath, 'Second Current');
      });
      await Promise.all([
        writeFile(join(sourcePath, 'exports', 'old.wav'), 'export'),
        writeFile(
          join(sourcePath, '.agent-music', 'cache', 'old.mid'),
          'cache',
        ),
      ]);
      expect(await git.revisionCount(sourcePath)).toBe(2);

      const target = await foundation.saveProjectAs(targetPath);
      expect(target.projectId).not.toBe(source.projectId);
      expect(await git.revisionCount(targetPath)).toBe(1);
      expect(await git.statusPorcelain(targetPath)).toBe('');
      await expect(
        access(join(targetPath, 'exports', 'old.wav')),
      ).rejects.toThrow();
      await expect(
        access(join(targetPath, '.agent-music', 'cache', 'old.mid')),
      ).rejects.toThrow();

      const failedTarget = join(parent, 'occupied');
      await mkdir(failedTarget);
      await writeFile(join(failedTarget, 'occupied.txt'), 'occupied');
      await expect(
        foundation.saveProjectAs(failedTarget),
      ).rejects.toMatchObject({
        code: 'PROJECT_DIRECTORY_NOT_EMPTY',
      });
      await expect(foundation.readCleanCurrent()).resolves.toMatchObject({
        manifest: { projectId: target.projectId },
      });
      expect(await git.statusPorcelain(targetPath)).toBe('');
    });
  },
);
