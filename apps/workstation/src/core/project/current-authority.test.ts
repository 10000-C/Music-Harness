import type { ProjectId } from '@agent-music/contracts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CurrentAuthorityReader } from './current-authority.js';
import { GitAdapter } from './git-adapter.js';
import { createInitialComposition } from './initial-composition.js';
import {
  createProjectManifest,
  serializeProjectManifest,
} from './project-manifest.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from './test-support.js';

const projectId = 'f31dd9a5-2f55-4bd0-8cf6-f684c41314cc' as ProjectId;
let root: string;
let git: GitAdapter;
let reader: CurrentAuthorityReader;

beforeEach(async () => {
  root = await createTemporaryDirectory('a1-current-');
  git = new GitAdapter();
  reader = new CurrentAuthorityReader(git);
  await writeFile(
    join(root, 'project.json'),
    serializeProjectManifest(createProjectManifest(projectId)),
  );
  await writeFile(join(root, 'composition.abc'), createInitialComposition());
  await git.init(root);
  await git.commitAuthorityFiles(root, 'Initial Current');
});

afterEach(async () => removeTemporaryDirectory(root));

describe('CurrentAuthorityReader', () => {
  it('reads both authority files from main HEAD when the worktree is clean', async () => {
    const snapshot = await reader.readCleanCurrent(root);

    expect(snapshot.currentRevision).toMatch(/^[0-9a-f]{40}$/u);
    expect(snapshot.manifest.projectId).toBe(projectId);
    expect(snapshot.compositionSource).toContain('V:track.drums');
  });

  it('rejects dirty Current without adopting the worktree', async () => {
    await writeFile(join(root, 'composition.abc'), 'external change');

    await expect(reader.readCleanCurrent(root)).rejects.toMatchObject({
      code: 'CURRENT_WORKTREE_DIRTY',
    });
  });

  it('explicitly restores authority files from main HEAD', async () => {
    await writeFile(join(root, 'composition.abc'), 'external change');
    await reader.restoreCurrent(root);

    expect(await git.statusPorcelain(root)).toBe('');
    expect(await reader.readCleanCurrent(root)).toMatchObject({
      manifest: { projectId },
    });
  });
});
