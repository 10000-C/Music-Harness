import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { GitAdapter } from './git-adapter.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from './test-support.js';

const roots: string[] = [];
const makeRoot = async (): Promise<string> => {
  const root = await createTemporaryDirectory('a1-git-');
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTemporaryDirectory));
});

describe('GitAdapter', () => {
  it('initializes main, commits only authority files, and reads main HEAD', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'project.json'), '{"formatVersion":1}\n');
    await writeFile(join(root, 'composition.abc'), 'X:1\n');
    await writeFile(join(root, 'cache.tmp'), 'ignored');

    const git = new GitAdapter();
    await git.init(root);
    await git.commitAuthorityFiles(root, 'Initial Current');

    expect(await git.statusPorcelain(root)).toBe('?? cache.tmp');
    expect(await git.revisionCount(root)).toBe(1);
    expect(await git.mainRevision(root)).toMatch(/^[0-9a-f]{40}$/u);
    expect(await git.readMainFile(root, 'composition.abc')).toBe('X:1\n');
  });

  it('restores only the two authority files from main', async () => {
    const root = await makeRoot();
    const git = new GitAdapter();
    await writeFile(join(root, 'project.json'), '{"formatVersion":1}\n');
    await writeFile(join(root, 'composition.abc'), 'X:1\n');
    await git.init(root);
    await git.commitAuthorityFiles(root, 'Initial Current');

    await writeFile(join(root, 'project.json'), 'changed');
    await writeFile(join(root, 'composition.abc'), 'changed');
    await writeFile(join(root, 'untracked.txt'), 'keep');
    await git.restoreAuthorityFiles(root);

    expect(await readFile(join(root, 'untracked.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(root, 'composition.abc'), 'utf8')).toBe('X:1\n');
  });
});
