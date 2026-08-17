import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitAdapter } from './git-adapter.js';
import { ProjectFoundation } from './project-foundation.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from './test-support.js';

let parent: string;
let projectPath: string;
let git: GitAdapter;
let foundation: ProjectFoundation;

beforeEach(async () => {
  parent = await createTemporaryDirectory('a1-foundation-');
  projectPath = join(parent, 'project');
  git = new GitAdapter();
  foundation = new ProjectFoundation(git);
});

afterEach(async () => {
  await foundation.closeProject();
  await removeTemporaryDirectory(parent);
});

describe('ProjectFoundation lifecycle', () => {
  it('creates a clean Initial Current and returns a ready project', async () => {
    const opened = await foundation.createProject(projectPath);

    expect(opened.state).toBe('ready');
    expect(await git.revisionCount(projectPath)).toBe(1);
    expect(await git.statusPorcelain(projectPath)).toBe('');
    expect(await readFile(join(projectPath, 'project.json'), 'utf8')).toContain(
      opened.projectId,
    );
    await expect(
      access(join(projectPath, 'composition.abc')),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-empty target directory', async () => {
    await mkdir(projectPath);
    await writeFile(join(projectPath, 'occupied.txt'), 'occupied');

    await expect(foundation.createProject(projectPath)).rejects.toMatchObject({
      code: 'PROJECT_DIRECTORY_NOT_EMPTY',
    });
  });

  it('rejects opening another project while one is active', async () => {
    await foundation.createProject(projectPath);

    await expect(foundation.openProject(projectPath)).rejects.toMatchObject({
      code: 'PROJECT_ALREADY_OPEN',
    });
  });

  it('opens dirty Current as recoveryRequired without changing files and restores only explicitly', async () => {
    const created = await foundation.createProject(projectPath);
    await foundation.closeProject();
    await writeFile(join(projectPath, 'composition.abc'), 'external change');

    const reopened = await foundation.openProject(projectPath);
    expect(reopened).toMatchObject({
      projectId: created.projectId,
      state: 'recoveryRequired',
    });
    expect(await readFile(join(projectPath, 'composition.abc'), 'utf8')).toBe(
      'external change',
    );

    const recovered = await foundation.recoverCurrent();
    expect(recovered.state).toBe('ready');
    expect(await git.statusPorcelain(projectPath)).toBe('');
  });

  it('releases the write lock on close', async () => {
    await foundation.createProject(projectPath);
    const otherFoundation = new ProjectFoundation();

    await expect(
      otherFoundation.openProject(projectPath),
    ).rejects.toMatchObject({
      code: 'PROJECT_WRITE_LOCKED',
    });

    await foundation.closeProject();
    await expect(
      otherFoundation.openProject(projectPath),
    ).resolves.toMatchObject({
      state: 'ready',
    });
    await otherFoundation.closeProject();
  });

  it('rejects invalid project directories and operations without an active project', async () => {
    await mkdir(projectPath);

    await expect(foundation.openProject(projectPath)).rejects.toMatchObject({
      code: 'PROJECT_INVALID',
    });
    await expect(foundation.recoverCurrent()).rejects.toMatchObject({
      code: 'PROJECT_NOT_OPEN',
    });
    await expect(foundation.readCleanCurrent()).rejects.toMatchObject({
      code: 'PROJECT_NOT_OPEN',
    });
  });

  it('exposes the active canonical project path to Core modules', async () => {
    await foundation.createProject(projectPath);

    expect(foundation.getProjectPath()).toBe(resolve(projectPath));
  });

  it('does not expose a project path when no project is open', () => {
    expect(() => foundation.getProjectPath()).toThrow(
      expect.objectContaining({ code: 'PROJECT_NOT_OPEN' }),
    );
  });
});

describe('ProjectFoundation Save As', () => {
  it('copies only Current authority into one new Initial Current', async () => {
    const source = await foundation.createProject(projectPath);
    await writeFile(join(projectPath, 'exports', 'old.wav'), 'not copied');
    const targetPath = join(parent, 'copy');

    const target = await foundation.saveProjectAs(targetPath);

    expect(target.projectId).not.toBe(source.projectId);
    expect(await git.revisionCount(targetPath)).toBe(1);
    expect(await git.statusPorcelain(targetPath)).toBe('');
    await expect(
      access(join(targetPath, 'exports', 'old.wav')),
    ).rejects.toThrow();
  });

  it('keeps the source active when target creation fails', async () => {
    const source = await foundation.createProject(projectPath);
    const targetPath = join(parent, 'occupied');
    await mkdir(targetPath);
    await writeFile(join(targetPath, 'occupied.txt'), 'occupied');

    await expect(foundation.saveProjectAs(targetPath)).rejects.toMatchObject({
      code: 'PROJECT_DIRECTORY_NOT_EMPTY',
    });
    await expect(foundation.readCleanCurrent()).resolves.toMatchObject({
      manifest: { projectId: source.projectId },
    });
  });

  it('switches the active lock to the successful target', async () => {
    await foundation.createProject(projectPath);
    const targetPath = join(parent, 'copy');
    await foundation.saveProjectAs(targetPath);

    const sourceProbe = new ProjectFoundation();
    await expect(sourceProbe.openProject(projectPath)).resolves.toBeDefined();
    await sourceProbe.closeProject();

    const targetProbe = new ProjectFoundation();
    await expect(targetProbe.openProject(targetPath)).rejects.toMatchObject({
      code: 'PROJECT_WRITE_LOCKED',
    });
  });
});
