import type { OpenedProject } from '@agent-music/contracts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ProjectFoundation } from '../core/project/project-foundation.js';

export interface ProjectCreateCliOptions {
  readonly projectPath: string;
}

export interface ProjectCreateCliOutputPort {
  write(text: string): void;
}

export const PROJECT_CREATE_CLI_USAGE =
  'Usage: pnpm project:create --path <path>';

const readOptionValue = (
  argv: readonly string[],
  index: number,
  name: string,
): string => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
};

export const parseProjectCreateCliOptions = (
  argv: readonly string[],
  currentDirectory = process.cwd(),
): ProjectCreateCliOptions => {
  let projectPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--path') {
      if (projectPath !== undefined) {
        throw new Error('Duplicate --path');
      }
      projectPath = readOptionValue(argv, index, '--path');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${String(argument)}`);
  }

  if (projectPath === undefined) {
    throw new Error(PROJECT_CREATE_CLI_USAGE);
  }

  return { projectPath: resolve(currentDirectory, projectPath) };
};

export const runProjectCreateCli = async (
  options: ProjectCreateCliOptions,
  output: ProjectCreateCliOutputPort,
): Promise<OpenedProject> => {
  const foundation = new ProjectFoundation();
  let created: OpenedProject;
  try {
    created = await foundation.createProject(options.projectPath);
  } finally {
    await foundation.closeProject();
  }

  output.write(
    [
      'Project created',
      `Path: ${created.projectPath}`,
      `Project ID: ${created.projectId}`,
      `Current Revision: ${created.currentRevision}`,
      '',
      `Next: pnpm core:mcp --project "${created.projectPath}"`,
      '',
    ].join('\n'),
  );
  return created;
};

const runMain = async (): Promise<void> => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`${PROJECT_CREATE_CLI_USAGE}\n`);
    return;
  }

  await runProjectCreateCli(
    parseProjectCreateCliOptions(process.argv.slice(2)),
    {
      write: (text) => {
        process.stdout.write(text);
      },
    },
  );
};

const executablePath = process.argv[1];
if (
  executablePath !== undefined &&
  import.meta.url === pathToFileURL(resolve(executablePath)).href
) {
  runMain().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Project creation failed'}\n`,
    );
    process.exitCode = 1;
  });
}
