import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  CandidateAgentPort,
  CandidateControlPort,
} from '../core/candidate/index.js';
import type {
  GenerationPlanConfirmationPort,
  GenerationPlanDecision,
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

export class TerminalGenerationPlanConfirmation implements GenerationPlanConfirmationPort {
  private activeQuestionAbort: AbortController | undefined;

  public constructor(private readonly terminal: CoreMcpCliTerminalPort) {}

  public async request(
    input: Parameters<GenerationPlanConfirmationPort['request']>[0],
  ): Promise<GenerationPlanDecision> {
    if (isSignalAborted(input.signal)) {
      return 'cancelled';
    }

    this.activeQuestionAbort?.abort();
    const questionAbort = new AbortController();
    this.activeQuestionAbort = questionAbort;
    const questionSignal =
      input.signal === undefined
        ? questionAbort.signal
        : AbortSignal.any([input.signal, questionAbort.signal]);

    this.terminal.write(
      `\nGeneration plan\nSummary: ${input.summary}\nScope: ${JSON.stringify(input.scope)}\n`,
    );

    try {
      const answer = await this.terminal.question(
        'Approve? [y/N] ',
        questionSignal,
      );
      if (isSignalAborted(questionSignal)) {
        this.terminal.write('Decision: cancelled\n');
        return 'cancelled';
      }
      const decision = isApproved(answer) ? 'approved' : 'rejected';
      this.terminal.write(`Decision: ${decision}\n`);
      return decision;
    } catch (error) {
      if (isSignalAborted(questionSignal)) {
        this.terminal.write('Decision: cancelled\n');
        return 'cancelled';
      }
      throw error;
    } finally {
      if (this.activeQuestionAbort === questionAbort) {
        this.activeQuestionAbort = undefined;
      }
    }
  }
}

export class InteractiveCandidateAgentPort implements CandidateAgentPort {
  public constructor(
    private readonly agent: CandidateAgentPort,
    private readonly control: CandidateControlPort,
    private readonly terminal: CoreMcpCliTerminalPort,
  ) {}

  public getTaskContext(
    ...args: Parameters<CandidateAgentPort['getTaskContext']>
  ): ReturnType<CandidateAgentPort['getTaskContext']> {
    return this.agent.getTaskContext(...args);
  }

  public getScopedComposition(
    ...args: Parameters<CandidateAgentPort['getScopedComposition']>
  ): ReturnType<CandidateAgentPort['getScopedComposition']> {
    return this.agent.getScopedComposition(...args);
  }

  public async requestScopeExtension(
    ...args: Parameters<CandidateAgentPort['requestScopeExtension']>
  ): ReturnType<CandidateAgentPort['requestScopeExtension']> {
    const [input] = args;
    const pending = await this.agent.requestScopeExtension(input);
    this.terminal.write(
      `\nScope extension requested\nRequest ID: ${pending.requestId}\nRequested Scope: ${JSON.stringify(pending.requestedScope)}\n`,
    );
    const decision = {
      taskId: input.envelope.taskId,
      requestId: pending.requestId,
    };
    try {
      const answer = await this.terminal.question(
        'Approve scope extension? [y/N] ',
        input.signal,
      );
      if (isSignalAborted(input.signal)) {
        await this.control.rejectScopeExtension(decision);
        this.terminal.write('Decision: cancelled\n');
        return pending;
      }
      if (isApproved(answer)) {
        await this.control.approveScopeExtension(decision);
        this.terminal.write('Decision: approved\n');
      } else {
        await this.control.rejectScopeExtension(decision);
        this.terminal.write('Decision: rejected\n');
      }
      return pending;
    } catch (error) {
      if (isSignalAborted(input.signal)) {
        await this.control.rejectScopeExtension(decision);
        this.terminal.write('Decision: cancelled\n');
        return pending;
      }
      throw error;
    }
  }

  public cancelScopeExtension(
    ...args: Parameters<CandidateAgentPort['cancelScopeExtension']>
  ): ReturnType<CandidateAgentPort['cancelScopeExtension']> {
    return this.agent.cancelScopeExtension(...args);
  }

  public applyScopedMusicChange(
    ...args: Parameters<CandidateAgentPort['applyScopedMusicChange']>
  ): ReturnType<CandidateAgentPort['applyScopedMusicChange']> {
    return this.agent.applyScopedMusicChange(...args);
  }

  public updateMusicalProperties(
    ...args: Parameters<CandidateAgentPort['updateMusicalProperties']>
  ): ReturnType<CandidateAgentPort['updateMusicalProperties']> {
    return this.agent.updateMusicalProperties(...args);
  }

  public resizeComposition(
    ...args: Parameters<CandidateAgentPort['resizeComposition']>
  ): ReturnType<CandidateAgentPort['resizeComposition']> {
    return this.agent.resizeComposition(...args);
  }

  public finishTask(
    ...args: Parameters<CandidateAgentPort['finishTask']>
  ): ReturnType<CandidateAgentPort['finishTask']> {
    return this.agent.finishTask(...args);
  }
}
