import type { McpRuntimeDescriptor } from '@agent-music/contracts';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CandidateCleanupManager } from '../core/candidate/candidate-cleanup.js';
import { CandidateGitRepository } from '../core/candidate/candidate-repository.js';
import { CandidateTransaction } from '../core/candidate/candidate-transaction.js';
import { CompositionPipeline } from '../core/composition/index.js';
import { MusicCoreMcpHttpServer } from '../core/mcp/music-core-mcp-server.js';
import { MusicCoreToolHost } from '../core/mcp/music-core-tool-host.js';
import { ProjectFoundation } from '../core/project/project-foundation.js';
import {
  CORE_MCP_CLI_USAGE,
  InteractiveCandidateAgentPort,
  TerminalGenerationPlanConfirmation,
  parseCoreMcpCliOptions,
  type CoreMcpCliOptions,
  type CoreMcpCliTerminalPort,
} from './core-mcp-cli-support.js';

export interface CoreMcpCliRuntime {
  readonly descriptor: McpRuntimeDescriptor;
  close(): Promise<void>;
}

class NodeCoreMcpCliTerminal implements CoreMcpCliTerminalPort {
  private readonly readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  private closed = false;

  public question(prompt: string, signal?: AbortSignal): Promise<string> {
    return signal === undefined
      ? this.readline.question(prompt)
      : this.readline.question(prompt, { signal });
  }

  public write(text: string): void {
    process.stdout.write(text);
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.readline.close();
  }
}

const closeRuntimeResources = async (
  server: MusicCoreMcpHttpServer | undefined,
  project: ProjectFoundation,
  terminal: CoreMcpCliTerminalPort,
): Promise<void> => {
  const errors: unknown[] = [];
  if (server !== undefined) {
    try {
      await server.stop();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await project.closeProject();
  } catch (error) {
    errors.push(error);
  }
  terminal.close();

  if (errors.length === 1) {
    throw errors[0] instanceof Error
      ? errors[0]
      : new Error('Core MCP CLI cleanup failed', { cause: errors[0] });
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Core MCP CLI cleanup failed');
  }
};

const claudeCodeCommand = (descriptor: McpRuntimeDescriptor): string =>
  `claude mcp add --transport http agent-music ${descriptor.endpoint} --header "Authorization: Bearer ${descriptor.instanceToken}"`;

export const runCoreMcpCli = async (
  options: CoreMcpCliOptions,
  terminal: CoreMcpCliTerminalPort,
): Promise<CoreMcpCliRuntime> => {
  const project = new ProjectFoundation();
  let server: MusicCoreMcpHttpServer | undefined;
  try {
    const opened = await project.openProject(options.projectPath);
    if (opened.state !== 'ready') {
      throw new Error(
        'Project Current must be ready before starting the MCP server',
      );
    }
    const repository = new CandidateGitRepository();
    const transaction = new CandidateTransaction({
      project,
      composition: new CompositionPipeline(),
      repository,
      cleanup: new CandidateCleanupManager(repository),
      createId: randomUUID,
      now: () => new Date().toISOString(),
    });
    const interactiveAgent = new InteractiveCandidateAgentPort(
      transaction,
      transaction,
      terminal,
    );
    const toolHost = new MusicCoreToolHost({
      agent: interactiveAgent,
      control: transaction,
      confirmation: new TerminalGenerationPlanConfirmation(terminal),
    });
    server = new MusicCoreMcpHttpServer({
      projectId: opened.projectId,
      runtimeDirectory: options.runtimeDirectory,
      toolHost,
    });
    const descriptor = await server.start();
    terminal.write(
      [
        '',
        'Music Core MCP ready',
        `Project: ${options.projectPath}`,
        `Project ID: ${opened.projectId}`,
        `Endpoint: ${descriptor.endpoint}`,
        `Instance Token: ${descriptor.instanceToken}`,
        '',
        'Claude Code:',
        claudeCodeCommand(descriptor),
        '',
        'Press Ctrl+C to stop.',
        '',
      ].join('\n'),
    );

    let closed = false;
    return {
      descriptor,
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        await closeRuntimeResources(server, project, terminal);
      },
    };
  } catch (error) {
    try {
      if (server !== undefined) {
        await closeRuntimeResources(server, project, terminal);
      } else {
        await project.closeProject();
        terminal.close();
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Core MCP CLI startup and cleanup failed',
        { cause: cleanupError },
      );
    }
    throw error;
  }
};

const runMain = async (): Promise<void> => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`${CORE_MCP_CLI_USAGE}\n`);
    return;
  }

  const options = parseCoreMcpCliOptions(process.argv.slice(2));
  const terminal = new NodeCoreMcpCliTerminal();
  const runtime = await runCoreMcpCli(options, terminal);
  let closing = false;
  const closeAndExit = async (exitCode: number): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    try {
      await runtime.close();
      process.exitCode = exitCode;
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Core MCP CLI cleanup failed'}\n`,
      );
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => {
    void closeAndExit(0);
  });
  process.once('SIGTERM', () => {
    void closeAndExit(0);
  });
};

const executablePath = process.argv[1];
if (
  executablePath !== undefined &&
  import.meta.url === pathToFileURL(resolve(executablePath)).href
) {
  runMain().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Core MCP CLI failed'}\n`,
    );
    process.exitCode = 1;
  });
}
