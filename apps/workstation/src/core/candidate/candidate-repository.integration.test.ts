import type { CandidateId } from '@agent-music/contracts';
import { execFile } from 'node:child_process';
import { chmod, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectFoundation } from '../project/project-foundation.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from '../project/test-support.js';
import { CandidateGitRepository } from './candidate-repository.js';

const execFileAsync = promisify(execFile);
const candidateId = '00000000-0000-4000-8000-000000000031' as CandidateId;

const git = async (
  repositoryPath: string,
  ...args: string[]
): Promise<string> =>
  (
    await execFileAsync('git', ['-C', repositoryPath, ...args], {
      encoding: 'utf8',
      windowsHide: true,
    })
  ).stdout.trim();

let parent: string;
let projectPath: string;
let foundation: ProjectFoundation;
let repository: CandidateGitRepository;

beforeEach(async () => {
  parent = await createTemporaryDirectory('a3-repository-');
  projectPath = join(parent, '音乐 project');
  foundation = new ProjectFoundation();
  repository = new CandidateGitRepository();
});

afterEach(async () => {
  await foundation.closeProject();
  await removeTemporaryDirectory(parent);
});

describe('CandidateGitRepository', { concurrent: false }, () => {
  it('creates one linked worktree from the requested Current revision', async () => {
    const current = await foundation.createProject(projectPath);
    const currentSnapshot = await foundation.readCleanCurrent();

    const workspace = await repository.create(
      projectPath,
      candidateId,
      current.currentRevision,
    );

    expect(workspace.branchName).toBe(`candidate/${candidateId}`);
    expect(workspace.worktreePath).toBe(
      join(projectPath, '.agent-music', 'worktrees', candidateId),
    );
    expect(workspace.baseRevision).toBe(current.currentRevision);
    expect(await git(projectPath, 'status', '--porcelain')).toBe('');

    const authority = await repository.readAuthority(workspace);
    expect(authority.compositionSource).toBe(currentSnapshot.compositionSource);
    expect(authority.projectManifestSource).toBe(
      await readFile(join(projectPath, 'project.json'), 'utf8'),
    );
  });

  it('inspects effective Candidate changes against the immutable base revision', async () => {
    const current = await foundation.createProject(projectPath);
    const workspace = await repository.create(
      projectPath,
      candidateId,
      current.currentRevision,
    );

    await repository.writeComposition(
      workspace,
      `${(await repository.readAuthority(workspace)).compositionSource}\n`,
    );
    expect(await repository.inspectChanges(workspace)).toEqual({
      compositionChanged: true,
      projectJsonChangedFromBase: false,
      unexpectedPaths: [],
    });

    await writeFile(
      join(workspace.worktreePath, 'project.json'),
      '{"changed":true}\n',
    );
    await git(workspace.worktreePath, 'add', '--', 'project.json');
    await git(
      workspace.worktreePath,
      'commit',
      '-m',
      'committed manifest change',
    );
    await writeFile(join(workspace.worktreePath, 'rogue.txt'), 'rogue');

    expect(await repository.inspectChanges(workspace)).toEqual({
      compositionChanged: true,
      projectJsonChangedFromBase: true,
      unexpectedPaths: ['rogue.txt'],
    });
  });

  it('creates a unique allow-empty checkpoint and resets the Candidate to it', async () => {
    const current = await foundation.createProject(projectPath);
    const initial = await foundation.readCleanCurrent();
    const workspace = await repository.create(
      projectPath,
      candidateId,
      current.currentRevision,
    );

    const firstCheckpoint = await repository.createCheckpoint(workspace, 'P1');
    const secondCheckpoint = await repository.createCheckpoint(workspace, 'P2');
    expect(firstCheckpoint).not.toBe(current.currentRevision);
    expect(secondCheckpoint).not.toBe(firstCheckpoint);

    await repository.writeComposition(
      workspace,
      'temporary candidate change\n',
    );
    await repository.resetTo(workspace, secondCheckpoint);
    expect((await repository.readAuthority(workspace)).compositionSource).toBe(
      initial.compositionSource,
    );
  });

  it('removes unauthorized untracked paths when resetting to a checkpoint', async () => {
    const current = await foundation.createProject(projectPath);
    const workspace = await repository.create(
      projectPath,
      candidateId,
      current.currentRevision,
    );
    const checkpoint = await repository.createCheckpoint(workspace, 'P1');
    await writeFile(join(workspace.worktreePath, 'rogue.txt'), 'rogue');

    await repository.resetTo(workspace, checkpoint);

    expect(await git(workspace.worktreePath, 'status', '--porcelain')).toBe('');
  });

  it('does not commit Current when Accept authorization is already aborted', async () => {
    const current = await foundation.createProject(projectPath);
    const initial = await foundation.readCleanCurrent();
    const workspace = await repository.create(
      projectPath,
      candidateId,
      current.currentRevision,
    );
    await repository.writeComposition(
      workspace,
      `${initial.compositionSource}\n% candidate\n`,
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      repository.commitCompositionToCurrent(
        projectPath,
        workspace,
        'Accept',
        controller.signal,
      ),
    ).rejects.toMatchObject({ operation: 'commitCompositionToCurrent' });
    expect(await git(projectPath, 'rev-parse', 'main')).toBe(
      current.currentRevision,
    );
    expect(await readFile(join(projectPath, 'composition.abc'), 'utf8')).toBe(
      initial.compositionSource,
    );
    expect(await git(projectPath, 'status', '--porcelain')).toBe('');
  });

  it('rolls Current back before the main-commit linearization point and can retry', async () => {
    const current = await foundation.createProject(projectPath);
    const initial = await foundation.readCleanCurrent();
    const workspace = await repository.create(
      projectPath,
      candidateId,
      current.currentRevision,
    );
    await repository.writeComposition(
      workspace,
      `${initial.compositionSource}\n% candidate\n`,
    );

    const hookPath = join(projectPath, '.git', 'hooks', 'pre-commit');
    await writeFile(hookPath, '#!/bin/sh\nexit 1\n');
    await chmod(hookPath, 0o755);

    await expect(
      repository.commitCompositionToCurrent(projectPath, workspace, 'Accept'),
    ).rejects.toMatchObject({ operation: 'commitCompositionToCurrent' });
    expect(await git(projectPath, 'rev-parse', 'main')).toBe(
      current.currentRevision,
    );
    expect(await git(projectPath, 'status', '--porcelain')).toBe('');
    expect(await readFile(join(projectPath, 'composition.abc'), 'utf8')).toBe(
      initial.compositionSource,
    );
    expect(
      await git(projectPath, 'branch', '--list', workspace.branchName),
    ).not.toBe('');

    await unlink(hookPath);
    const acceptedRevision = await repository.commitCompositionToCurrent(
      projectPath,
      workspace,
      'Accept retry',
    );
    expect(acceptedRevision).not.toBe(current.currentRevision);
    expect(await git(projectPath, 'status', '--porcelain')).toBe('');
  });

  it('refuses to report Accept success when the Current worktree is not on main', async () => {
    const current = await foundation.createProject(projectPath);
    const initial = await foundation.readCleanCurrent();
    const workspace = await repository.create(
      projectPath,
      candidateId,
      current.currentRevision,
    );
    await repository.writeComposition(
      workspace,
      `${initial.compositionSource}\n% candidate\n`,
    );
    await git(projectPath, 'switch', '-c', 'other');

    await expect(
      repository.commitCompositionToCurrent(projectPath, workspace, 'Accept'),
    ).rejects.toMatchObject({ operation: 'commitCompositionToCurrent' });
    expect(await git(projectPath, 'rev-parse', 'main')).toBe(
      current.currentRevision,
    );
    expect(await git(projectPath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'other',
    );
    expect(await readFile(join(projectPath, 'composition.abc'), 'utf8')).toBe(
      initial.compositionSource,
    );
    expect(await git(projectPath, 'status', '--porcelain')).toBe('');
  });
});
