import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GitAdapter } from '../core/project/git-adapter.js';
import { ProjectFoundation } from '../core/project/project-foundation.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from '../core/project/test-support.js';
import {
  parseProjectCreateCliOptions,
  runProjectCreateCli,
  type ProjectCreateCliOutputPort,
} from './project-create-cli.js';

const parents: string[] = [];

afterEach(async () => {
  await Promise.all(parents.splice(0).map(removeTemporaryDirectory));
});

describe('parseProjectCreateCliOptions', () => {
  it('requires --path and resolves it from the current directory', () => {
    expect(
      parseProjectCreateCliOptions(['--path', './my-project'], '/workspace'),
    ).toEqual({ projectPath: '/workspace/my-project' });
  });

  it('rejects missing, duplicate, and unknown arguments', () => {
    expect(() => parseProjectCreateCliOptions([], '/workspace')).toThrow(
      'Usage: pnpm project:create --path <path>',
    );
    expect(() =>
      parseProjectCreateCliOptions(
        ['--path', 'one', '--path', 'two'],
        '/workspace',
      ),
    ).toThrow('Duplicate --path');
    expect(() =>
      parseProjectCreateCliOptions(['--path', 'one', '--wat'], '/workspace'),
    ).toThrow('Unknown argument: --wat');
  });
});

describe('runProjectCreateCli', { concurrent: false }, () => {
  it('creates a real clean Project that can be reopened', async () => {
    const parent = await createTemporaryDirectory('project-create-cli-');
    parents.push(parent);
    const projectPath = join(parent, 'my project');
    const writes: string[] = [];
    const output: ProjectCreateCliOutputPort = {
      write: (text) => {
        writes.push(text);
      },
    };

    const created = await runProjectCreateCli({ projectPath }, output);

    expect(created.projectPath).toBe(projectPath);
    expect(created.state).toBe('ready');
    expect(writes.join('')).toContain('Project created');
    expect(writes.join('')).toContain(projectPath);
    expect(writes.join('')).toContain(created.projectId);
    expect(await new GitAdapter().statusPorcelain(projectPath)).toBe('');

    const foundation = new ProjectFoundation();
    await expect(foundation.openProject(projectPath)).resolves.toMatchObject({
      projectId: created.projectId,
      state: 'ready',
    });
    await foundation.closeProject();
  });
});
