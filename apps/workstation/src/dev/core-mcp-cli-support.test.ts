import {
  TRACK_IDS,
  type CandidateId,
  type PendingScopeExtensionView,
  type ProjectId,
  type ScopeExtensionRequestId,
  type TaskContextView,
  type TaskExecutionEnvelope,
  type TaskId,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';

import type {
  CandidateAgentPort,
  CandidateControlPort,
} from '../core/candidate/index.js';
import {
  InteractiveCandidateAgentPort,
  TerminalGenerationPlanConfirmation,
  parseCoreMcpCliOptions,
  type CoreMcpCliTerminalPort,
} from './core-mcp-cli-support.js';

const projectId = '10000000-0000-4000-8000-000000000001' as ProjectId;
const candidateId = '10000000-0000-4000-8000-000000000002' as CandidateId;
const taskId = '10000000-0000-4000-8000-000000000003' as TaskId;
const envelope: TaskExecutionEnvelope = {
  taskId,
  projectId,
  candidateId,
  baseRevision: 'base-sha',
  expectedScopeRevision: 0,
};
const task: TaskContextView = {
  taskId,
  projectId,
  candidateId,
  baseRevision: 'base-sha',
  scope: { type: 'wholeProject', trackIds: ['track.drums'] },
  scopeRevision: 0,
  state: 'editing',
  candidateState: 'active',
  allowedOperations: ['replaceScopedMusic'],
  trackIds: TRACK_IDS,
  createdAt: '2026-09-09T00:00:00.000Z',
};

const makeTerminal = (answer: string): CoreMcpCliTerminalPort => ({
  question: vi.fn().mockResolvedValue(answer),
  write: vi.fn(),
  close: vi.fn(),
});

const makeAgent = (pending: PendingScopeExtensionView) => {
  const requestScopeExtension = vi.fn(
    (input: Parameters<CandidateAgentPort['requestScopeExtension']>[0]) => {
      void input;
      return Promise.resolve(pending);
    },
  );
  const port: CandidateAgentPort = {
    getTaskContext: vi.fn().mockResolvedValue(task),
    getScopedComposition: vi.fn(),
    requestScopeExtension,
    cancelScopeExtension: vi.fn(),
    applyScopedMusicChange: vi.fn(),
    updateMusicalProperties: vi.fn(),
    resizeComposition: vi.fn(),
    finishTask: vi.fn(),
  };
  return { port, requestScopeExtension };
};

const makeControl = () => {
  const approveScopeExtension = vi.fn(
    (input: Parameters<CandidateControlPort['approveScopeExtension']>[0]) => {
      void input;
      return Promise.resolve(task);
    },
  );
  const rejectScopeExtension = vi.fn(
    (input: Parameters<CandidateControlPort['rejectScopeExtension']>[0]) => {
      void input;
      return Promise.resolve(task);
    },
  );
  const port: CandidateControlPort = {
    startTask: vi.fn(),
    cancelTask: vi.fn(),
    cancelActiveTaskForAgentLoss: vi.fn(),
    approveScopeExtension,
    rejectScopeExtension,
    acceptCandidate: vi.fn(),
    rejectCandidate: vi.fn(),
    reconcileProjectResources: vi.fn(),
  };
  return { port, approveScopeExtension, rejectScopeExtension };
};

describe('parseCoreMcpCliOptions', () => {
  it('requires a project and defaults runtime data outside the project', () => {
    expect(
      parseCoreMcpCliOptions(['--project', './demo'], {
        currentDirectory: '/workspace',
        homeDirectory: '/home/tester',
      }),
    ).toEqual({
      projectPath: '/workspace/demo',
      runtimeDirectory: '/home/tester/.agent-music/runtime',
    });
  });

  it('accepts an explicit runtime directory', () => {
    expect(
      parseCoreMcpCliOptions(
        ['--project', '/music/project', '--runtime-dir', './runtime'],
        { currentDirectory: '/workspace', homeDirectory: '/home/tester' },
      ),
    ).toEqual({
      projectPath: '/music/project',
      runtimeDirectory: '/workspace/runtime',
    });
  });

  it('rejects a runtime directory inside the project', () => {
    expect(() =>
      parseCoreMcpCliOptions(
        ['--project', './demo', '--runtime-dir', './demo/runtime'],
        { currentDirectory: '/workspace', homeDirectory: '/home/tester' },
      ),
    ).toThrow('Runtime directory must be outside the project');
  });

  it('rejects missing, duplicate, and unknown arguments', () => {
    expect(() =>
      parseCoreMcpCliOptions([], {
        currentDirectory: '/workspace',
        homeDirectory: '/home/tester',
      }),
    ).toThrow('Usage: pnpm core:mcp --project <path>');
    expect(() =>
      parseCoreMcpCliOptions(['--project', 'one', '--project', 'two'], {
        currentDirectory: '/workspace',
        homeDirectory: '/home/tester',
      }),
    ).toThrow('Duplicate --project');
    expect(() =>
      parseCoreMcpCliOptions(['--project', 'one', '--wat'], {
        currentDirectory: '/workspace',
        homeDirectory: '/home/tester',
      }),
    ).toThrow('Unknown argument: --wat');
  });
});

describe('TerminalGenerationPlanConfirmation', () => {
  it('maps yes to approval and other input to rejection', async () => {
    const approving = makeTerminal('yes');
    const approvingShort = makeTerminal('y');
    const approvingBracketedPaste = makeTerminal('\u001B[200~y\u001B[201~');
    const rejecting = makeTerminal('no');

    await expect(
      new TerminalGenerationPlanConfirmation(approving).request({
        projectId,
        summary: 'Generate drums',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
      }),
    ).resolves.toBe('approved');
    await expect(
      new TerminalGenerationPlanConfirmation(approvingShort).request({
        projectId,
        summary: 'Generate drums',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
      }),
    ).resolves.toBe('approved');
    await expect(
      new TerminalGenerationPlanConfirmation(approvingBracketedPaste).request({
        projectId,
        summary: 'Generate drums',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
      }),
    ).resolves.toBe('approved');
    await expect(
      new TerminalGenerationPlanConfirmation(rejecting).request({
        projectId,
        summary: 'Generate drums',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
      }),
    ).resolves.toBe('rejected');
  });

  it('cancels an orphaned pending prompt before asking a retried generation plan', async () => {
    interface PendingQuestion {
      readonly prompt: string;
      resolve(answer: string): void;
      reject(error: unknown): void;
    }
    const pending: PendingQuestion[] = [];
    const terminal: CoreMcpCliTerminalPort = {
      question: vi.fn(
        (prompt: string, signal?: AbortSignal) =>
          new Promise<string>((resolve, reject) => {
            const current: PendingQuestion = { prompt, resolve, reject };
            pending.push(current);
            signal?.addEventListener(
              'abort',
              () => {
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            );
          }),
      ),
      write: vi.fn(),
      close: vi.fn(),
    };
    const confirmation = new TerminalGenerationPlanConfirmation(terminal);
    const first = confirmation.request({
      projectId,
      summary: 'First plan',
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });

    const second = confirmation.request({
      projectId,
      summary: 'Second plan',
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    await expect(first).resolves.toBe('cancelled');
    await vi.waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    const secondQuestion = pending[1];
    if (secondQuestion === undefined) {
      throw new Error('Expected retried generation-plan question');
    }
    secondQuestion.resolve('y');

    await expect(second).resolves.toBe('approved');
  });
  it('returns cancelled when the request signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new TerminalGenerationPlanConfirmation(makeTerminal('yes')).request({
        projectId,
        summary: 'Generate drums',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
        signal: controller.signal,
      }),
    ).resolves.toBe('cancelled');
  });
});

describe('InteractiveCandidateAgentPort', () => {
  const pending: PendingScopeExtensionView = {
    taskId,
    requestId:
      '10000000-0000-4000-8000-000000000004' as ScopeExtensionRequestId,
    fromScopeRevision: 0,
    requestedScope: { type: 'wholeProject', trackIds: TRACK_IDS },
    createdAt: '2026-09-09T00:00:01.000Z',
  };

  it('creates the real pending request before approving through the control seam', async () => {
    const events: string[] = [];
    const agent = makeAgent(pending);
    agent.requestScopeExtension.mockImplementation(() => {
      events.push('pending');
      return Promise.resolve(pending);
    });
    const control = makeControl();
    control.approveScopeExtension.mockImplementation(() => {
      events.push('approved');
      return Promise.resolve(task);
    });
    const write = vi.fn();
    const terminal: CoreMcpCliTerminalPort = { ...makeTerminal('y'), write };

    const result = await new InteractiveCandidateAgentPort(
      agent.port,
      control.port,
      terminal,
    ).requestScopeExtension({
      envelope,
      requestedScope: pending.requestedScope,
    });

    expect(result).toEqual(pending);
    expect(events).toEqual(['pending', 'approved']);
    expect(control.approveScopeExtension).toHaveBeenCalledWith({
      taskId,
      requestId: pending.requestId,
    });
    expect(control.rejectScopeExtension).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith('Decision: approved\n');
  });

  it('routes a rejected terminal decision through the existing rejection control seam', async () => {
    const agent = makeAgent(pending);
    const control = makeControl();

    const write = vi.fn();
    const terminal: CoreMcpCliTerminalPort = { ...makeTerminal('n'), write };
    await new InteractiveCandidateAgentPort(
      agent.port,
      control.port,
      terminal,
    ).requestScopeExtension({
      envelope,
      requestedScope: pending.requestedScope,
    });

    expect(control.rejectScopeExtension).toHaveBeenCalledWith({
      taskId,
      requestId: pending.requestId,
    });
    expect(control.approveScopeExtension).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith('Decision: rejected\n');
  });

  it('rejects the pending Scope Extension when the MCP signal is aborted', async () => {
    const agent = makeAgent(pending);
    const control = makeControl();
    const controller = new AbortController();
    const terminal: CoreMcpCliTerminalPort = {
      write: vi.fn(),
      close: vi.fn(),
      question: vi.fn(
        (_prompt: string, signal?: AbortSignal) =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                reject(new Error('aborted'));
              },
              { once: true },
            );
          }),
      ),
    };
    const request = new InteractiveCandidateAgentPort(
      agent.port,
      control.port,
      terminal,
    ).requestScopeExtension({
      envelope,
      requestedScope: pending.requestedScope,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(request).resolves.toEqual(pending);
    expect(control.rejectScopeExtension).toHaveBeenCalledWith({
      taskId,
      requestId: pending.requestId,
    });
    expect(control.approveScopeExtension).not.toHaveBeenCalled();
  });
});
