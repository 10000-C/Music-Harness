import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { ProjectError } from './project-error.js';

const execFileAsync = promisify(execFile);
export const AUTHORITY_FILES = ['project.json', 'composition.abc'] as const;
export type AuthorityFile = (typeof AUTHORITY_FILES)[number];

export class GitAdapter {
  async init(repositoryPath: string): Promise<void> {
    await this.run(repositoryPath, [
      '-c',
      'core.longpaths=true',
      'init',
      '-b',
      'main',
    ]);
    await writeFile(
      join(repositoryPath, '.git', 'info', 'exclude'),
      '.agent-music/\nexports/\n',
      'utf8',
    );
    await this.run(repositoryPath, ['config', 'user.name', 'Music Harness']);
    await this.run(repositoryPath, [
      'config',
      'user.email',
      'agent-music@localhost',
    ]);
    await this.run(repositoryPath, ['config', 'core.longpaths', 'true']);
    await this.configureRepository(repositoryPath);
  }

  async configureRepository(repositoryPath: string): Promise<void> {
    await this.run(repositoryPath, ['config', 'core.autocrlf', 'false']);
    await this.run(repositoryPath, ['config', 'core.eol', 'lf']);
  }

  async commitAuthorityFiles(
    repositoryPath: string,
    message: string,
  ): Promise<void> {
    await this.run(repositoryPath, ['add', '--', ...AUTHORITY_FILES]);
    await this.run(repositoryPath, ['commit', '-m', message]);
  }

  async statusPorcelain(repositoryPath: string): Promise<string> {
    return (await this.run(repositoryPath, ['status', '--porcelain'])).trim();
  }

  async mainRevision(repositoryPath: string): Promise<string> {
    return (await this.run(repositoryPath, ['rev-parse', 'main'])).trim();
  }

  async readMainFile(
    repositoryPath: string,
    relativePath: AuthorityFile,
  ): Promise<string> {
    return this.run(repositoryPath, ['show', `main:${relativePath}`]);
  }

  async restoreAuthorityFiles(repositoryPath: string): Promise<void> {
    await this.run(repositoryPath, [
      'restore',
      '--source',
      'main',
      '--staged',
      '--worktree',
      '--',
      ...AUTHORITY_FILES,
    ]);
  }

  async revisionCount(repositoryPath: string): Promise<number> {
    const output = await this.run(repositoryPath, [
      'rev-list',
      '--count',
      'main',
    ]);
    return Number.parseInt(output.trim(), 10);
  }

  private async run(
    repositoryPath: string,
    arguments_: readonly string[],
  ): Promise<string> {
    try {
      const result = await execFileAsync(
        'git',
        ['-C', repositoryPath, ...arguments_],
        {
          encoding: 'utf8',
          windowsHide: true,
        },
      );
      return result.stdout;
    } catch {
      throw new ProjectError(
        'GIT_OPERATION_FAILED',
        `Git operation failed: git ${arguments_.join(' ')}`,
      );
    }
  }
}
