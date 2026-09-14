import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  ConfirmationDecision,
  GenerationPlanConfirmationPort,
  ScopeExtensionConfirmationPort,
} from '../core/mcp/music-core-tool-host.js';

export interface CoreMcpCliOptions {
  readonly projectPath: string;
  readonly runtimeDirectory: string;
}

export interface CoreMcpCliPathContext {
  readonly currentDirectory: string;
  readonly homeDirectory: string;
}

export interface CoreMcpCliTerminalPort {
  question(prompt: string, signal?: AbortSignal): Promise<string>;
  write(text: string): void;
  close(): void;
}

export const CORE_MCP_CLI_USAGE =
  'Usage: pnpm core:mcp --project <path> [--runtime-dir <path>]';

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

export const parseCoreMcpCliOptions = (
  argv: readonly string[],
  paths: CoreMcpCliPathContext = {
    currentDirectory: process.cwd(),
    homeDirectory: homedir(),
  },
): CoreMcpCliOptions => {
  let project: string | undefined;
  let runtimeDirectory: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--project') {
      if (project !== undefined) {
        throw new Error('Duplicate --project');
      }
      project = readOptionValue(argv, index, '--project');
      index += 1;
      continue;
    }
    if (argument === '--runtime-dir') {
      if (runtimeDirectory !== undefined) {
        throw new Error('Duplicate --runtime-dir');
      }
      runtimeDirectory = readOptionValue(argv, index, '--runtime-dir');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${String(argument)}`);
  }

  if (project === undefined) {
    throw new Error(CORE_MCP_CLI_USAGE);
  }

  const projectPath = resolve(paths.currentDirectory, project);
  const resolvedRuntimeDirectory =
    runtimeDirectory === undefined
      ? join(paths.homeDirectory, '.agent-music', 'runtime')
      : resolve(paths.currentDirectory, runtimeDirectory);
  const projectToRuntime = relative(projectPath, resolvedRuntimeDirectory);
  if (
    projectToRuntime === '' ||
    (projectToRuntime !== '..' &&
      !projectToRuntime.startsWith(`..${sep}`) &&
      !isAbsolute(projectToRuntime))
  ) {
    throw new Error('Runtime directory must be outside the project');
  }

  return {
    projectPath,
    runtimeDirectory: resolvedRuntimeDirectory,
  };
};

const isSignalAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

const BRACKETED_PASTE_START = '\u001B[200~';
const BRACKETED_PASTE_END = '\u001B[201~';

const normalizeTerminalAnswer = (answer: string): string =>
  answer
    .replaceAll(BRACKETED_PASTE_START, '')
    .replaceAll(BRACKETED_PASTE_END, '')
    .trim()
    .toLowerCase();

const isApproved = (answer: string): boolean => {
  const normalized = normalizeTerminalAnswer(answer);
  return normalized === 'y' || normalized === 'yes';
};

const terminalDecision = async (
  terminal: CoreMcpCliTerminalPort,
  prompt: string,
  signal: AbortSignal,
): Promise<ConfirmationDecision> => {
  if (isSignalAborted(signal)) return 'cancelled';
  try {
    const answer = await terminal.question(prompt, signal);
    if (isSignalAborted(signal)) return 'cancelled';
    return isApproved(answer) ? 'approved' : 'rejected';
  } catch (error) {
    if (isSignalAborted(signal)) return 'cancelled';
    throw error;
  }
};

export class TerminalGenerationPlanConfirmation implements GenerationPlanConfirmationPort {
  public constructor(private readonly terminal: CoreMcpCliTerminalPort) {}

  public async request(
    input: Parameters<GenerationPlanConfirmationPort['request']>[0],
  ): Promise<ConfirmationDecision> {
    this.terminal.write(
      `\nGeneration plan\nOperation ID: ${input.operationId}\nSummary: ${input.summary}\nScope: ${JSON.stringify(input.scope)}\n`,
    );
    const decision = await terminalDecision(
      this.terminal,
      'Approve? [y/N] ',
      input.signal,
    );
    this.terminal.write(`Decision: ${decision}\n`);
    return decision;
  }
}

export class TerminalScopeExtensionConfirmation implements ScopeExtensionConfirmationPort {
  public constructor(private readonly terminal: CoreMcpCliTerminalPort) {}

  public async request(
    input: Parameters<ScopeExtensionConfirmationPort['request']>[0],
  ): Promise<ConfirmationDecision> {
    this.terminal.write(
      `\nScope extension requested\nOperation ID: ${input.operationId}\nRequest ID: ${input.request.requestId}\nRequested Scope: ${JSON.stringify(input.request.requestedScope)}\n`,
    );
    const decision = await terminalDecision(
      this.terminal,
      'Approve scope extension? [y/N] ',
      input.signal,
    );
    this.terminal.write(`Decision: ${decision}\n`);
    return decision;
  }
}
