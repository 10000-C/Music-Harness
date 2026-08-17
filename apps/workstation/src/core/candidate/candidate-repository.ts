import type { CandidateId } from '@agent-music/contracts';
import { execFile } from 'node:child_process';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CandidateWorkspace {
  readonly candidateId: CandidateId;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly baseRevision: string;
}

export interface CandidateAuthoritySnapshot {
  readonly projectManifestSource: string;
  readonly compositionSource: string;
}

export interface CandidateChangeSet {
  readonly compositionChanged: boolean;
  readonly projectJsonChangedFromBase: boolean;
  readonly unexpectedPaths: readonly string[];
}

export interface CandidateRepository {
  create(
    projectPath: string,
    candidateId: CandidateId,
    baseRevision: string,
  ): Promise<CandidateWorkspace>;
  readAuthority(
    workspace: CandidateWorkspace,
  ): Promise<CandidateAuthoritySnapshot>;
  writeComposition(
    workspace: CandidateWorkspace,
    compositionSource: string,
  ): Promise<void>;
  inspectChanges(workspace: CandidateWorkspace): Promise<CandidateChangeSet>;
  createCheckpoint(
    workspace: CandidateWorkspace,
    message: string,
  ): Promise<string>;
  resetTo(workspace: CandidateWorkspace, revision: string): Promise<void>;
  commitCompositionToCurrent(
    projectPath: string,
    workspace: CandidateWorkspace,
    message: string,
    signal?: AbortSignal,
  ): Promise<string>;
  remove(workspace: CandidateWorkspace): Promise<void>;
  listCandidateResourceIds(
    projectPath: string,
  ): Promise<readonly CandidateId[]>;
}

export class CandidateRepositoryError extends Error {
  public constructor(readonly operation: string) {
    super(`Candidate repository operation failed: ${operation}`);
    this.name = 'CandidateRepositoryError';
  }
}

const projectPathFromWorkspace = (workspace: CandidateWorkspace): string =>
  dirname(dirname(dirname(workspace.worktreePath)));

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
};

const assertNotAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Candidate repository operation aborted');
  }
};

const atomicWrite = async (path: string, source: string): Promise<void> => {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, 'w', 0o600);
  try {
    await handle.writeFile(source, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

export class CandidateGitRepository implements CandidateRepository {
  public async create(
    projectPath: string,
    candidateId: CandidateId,
    baseRevision: string,
  ): Promise<CandidateWorkspace> {
    const branchName = `candidate/${candidateId}`;
    const worktreePath = join(
      projectPath,
      '.agent-music',
      'worktrees',
      candidateId,
    );

    try {
      await mkdir(dirname(worktreePath), { recursive: true });
      await this.runGit(projectPath, [
        'worktree',
        'add',
        '-b',
        branchName,
        worktreePath,
        baseRevision,
      ]);
      return { candidateId, branchName, worktreePath, baseRevision };
    } catch {
      throw new CandidateRepositoryError('create');
    }
  }

  public async readAuthority(
    workspace: CandidateWorkspace,
  ): Promise<CandidateAuthoritySnapshot> {
    try {
      const [projectManifestSource, compositionSource] = await Promise.all([
        readFile(join(workspace.worktreePath, 'project.json'), 'utf8'),
        readFile(join(workspace.worktreePath, 'composition.abc'), 'utf8'),
      ]);
      return { projectManifestSource, compositionSource };
    } catch {
      throw new CandidateRepositoryError('readAuthority');
    }
  }

  public async writeComposition(
    workspace: CandidateWorkspace,
    compositionSource: string,
  ): Promise<void> {
    try {
      await atomicWrite(
        join(workspace.worktreePath, 'composition.abc'),
        compositionSource,
      );
    } catch {
      throw new CandidateRepositoryError('writeComposition');
    }
  }

  public async inspectChanges(
    workspace: CandidateWorkspace,
  ): Promise<CandidateChangeSet> {
    try {
      const [trackedOutput, untrackedOutput] = await Promise.all([
        this.runGit(workspace.worktreePath, [
          'diff',
          '--name-only',
          '-z',
          '--no-renames',
          workspace.baseRevision,
          '--',
        ]),
        this.runGit(workspace.worktreePath, [
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
        ]),
      ]);
      const tracked = this.parseNullPaths(trackedOutput);
      const untracked = this.parseNullPaths(untrackedOutput);
      const changed = new Set([...tracked, ...untracked]);
      const unexpectedPaths = [...changed]
        .filter((path) => path !== 'composition.abc' && path !== 'project.json')
        .sort();

      return {
        compositionChanged: changed.has('composition.abc'),
        projectJsonChangedFromBase: changed.has('project.json'),
        unexpectedPaths,
      };
    } catch {
      throw new CandidateRepositoryError('inspectChanges');
    }
  }

  public async createCheckpoint(
    workspace: CandidateWorkspace,
    message: string,
  ): Promise<string> {
    try {
      await this.runGit(workspace.worktreePath, [
        'add',
        '--',
        'composition.abc',
      ]);
      await this.runGit(workspace.worktreePath, [
        'commit',
        '--allow-empty',
        '-m',
        message,
      ]);
      return (
        await this.runGit(workspace.worktreePath, ['rev-parse', 'HEAD'])
      ).trim();
    } catch {
      throw new CandidateRepositoryError('createCheckpoint');
    }
  }

  public async resetTo(
    workspace: CandidateWorkspace,
    revision: string,
  ): Promise<void> {
    try {
      await this.runGit(workspace.worktreePath, ['reset', '--hard', revision]);
      await this.runGit(workspace.worktreePath, ['clean', '-fd']);
    } catch {
      throw new CandidateRepositoryError('resetTo');
    }
  }

  public async commitCompositionToCurrent(
    projectPath: string,
    workspace: CandidateWorkspace,
    message: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      assertNotAborted(signal);
      const currentBranch = (
        await this.runGit(
          projectPath,
          ['symbolic-ref', '--quiet', '--short', 'HEAD'],
          signal,
        )
      ).trim();
      if (currentBranch !== 'main') {
        throw new CandidateRepositoryError('commitCompositionToCurrent');
      }
    } catch {
      throw new CandidateRepositoryError('commitCompositionToCurrent');
    }

    let originalMainRevision: string | undefined;
    try {
      originalMainRevision = (
        await this.runGit(projectPath, ['rev-parse', 'main'])
      ).trim();
      assertNotAborted(signal);

      const source = await readFile(
        join(workspace.worktreePath, 'composition.abc'),
        'utf8',
      );
      assertNotAborted(signal);
      await atomicWrite(join(projectPath, 'composition.abc'), source);
      assertNotAborted(signal);
      await this.runGit(projectPath, ['add', '--', 'composition.abc']);
      assertNotAborted(signal);

      try {
        await this.runGit(
          projectPath,
          ['commit', '--allow-empty', '-m', message],
          signal,
        );
      } catch (error) {
        const currentRevision = (
          await this.runGit(projectPath, ['rev-parse', 'main'])
        ).trim();
        if (currentRevision !== originalMainRevision) {
          return currentRevision;
        }
        throw error;
      }

      const currentRevision = (
        await this.runGit(projectPath, ['rev-parse', 'main'])
      ).trim();
      if (currentRevision === originalMainRevision) {
        throw new CandidateRepositoryError('commitCompositionToCurrent');
      }
      return currentRevision;
    } catch {
      await this.runGit(projectPath, [
        'restore',
        '--source',
        'main',
        '--staged',
        '--worktree',
        '--',
        'project.json',
        'composition.abc',
      ]).catch(() => undefined);
      throw new CandidateRepositoryError('commitCompositionToCurrent');
    }
  }

  public async remove(workspace: CandidateWorkspace): Promise<void> {
    const projectPath = projectPathFromWorkspace(workspace);
    try {
      if (await exists(workspace.worktreePath)) {
        await this.runGit(projectPath, [
          'worktree',
          'remove',
          '--force',
          workspace.worktreePath,
        ]);
      } else {
        await this.runGit(projectPath, ['worktree', 'prune']);
      }

      const branchExists = (
        await this.runGit(projectPath, [
          'branch',
          '--list',
          '--format=%(refname:short)',
          workspace.branchName,
        ])
      ).trim();
      if (branchExists !== '') {
        await this.runGit(projectPath, ['branch', '-D', workspace.branchName]);
      }
    } catch {
      throw new CandidateRepositoryError('remove');
    }
  }

  public async listCandidateResourceIds(
    projectPath: string,
  ): Promise<readonly CandidateId[]> {
    try {
      const branchOutput = await this.runGit(projectPath, [
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads/candidate/',
      ]);
      const ids = new Set<string>();
      for (const line of branchOutput.split(/\r?\n/u)) {
        if (line.startsWith('candidate/')) {
          const id = line.slice('candidate/'.length);
          if (UUID_PATTERN.test(id)) {
            ids.add(id);
          }
        }
      }

      const worktreeRoot = join(projectPath, '.agent-music', 'worktrees');
      try {
        const entries = await readdir(worktreeRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && UUID_PATTERN.test(entry.name)) {
            ids.add(entry.name);
          }
        }
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }

      return [...ids].sort() as CandidateId[];
    } catch {
      throw new CandidateRepositoryError('listCandidateResourceIds');
    }
  }

  private async runGit(
    repositoryPath: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await execFileAsync('git', ['-C', repositoryPath, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    });
    return result.stdout;
  }

  private parseNullPaths(output: string): string[] {
    return output.split('\0').filter((path) => path.length > 0);
  }
}
