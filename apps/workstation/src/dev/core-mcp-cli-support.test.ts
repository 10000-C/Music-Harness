import {
  type OperationId,
  type PendingScopeExtensionView,
  type ProjectId,
  type ScopeExtensionRequestId,
  type TaskId,
} from '@agent-music/contracts';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  TerminalGenerationPlanConfirmation,
  TerminalScopeExtensionConfirmation,
  parseCoreMcpCliOptions,
  type CoreMcpCliTerminalPort,
} from './core-mcp-cli-support.js';

const projectId = '10000000-0000-4000-8000-000000000001' as ProjectId;
const taskId = '10000000-0000-4000-8000-000000000003' as TaskId;
const operationId = '10000000-0000-4000-8000-000000000004' as OperationId;

const makeTerminal = (answer: string): CoreMcpCliTerminalPort => ({
  question: vi.fn().mockResolvedValue(answer),
  write: vi.fn(),
  close: vi.fn(),
});

describe('parseCoreMcpCliOptions', () => {
  it('requires a project and defaults runtime data outside the project', () => {
    expect(
      parseCoreMcpCliOptions(['--project', './demo'], {
        currentDirectory: '/workspace',
        homeDirectory: '/home/tester',
      }),
    ).toEqual({
      projectPath: resolve('/workspace', './demo'),
      runtimeDirectory: join('/home/tester', '.agent-music', 'runtime'),
    });
  });

  it('accepts an explicit runtime directory and rejects invalid arguments', () => {
    expect(
      parseCoreMcpCliOptions(
        ['--project', '/music/project', '--runtime-dir', './runtime'],
        { currentDirectory: '/workspace', homeDirectory: '/home/tester' },
      ),
    ).toEqual({
      projectPath: resolve('/workspace', '/music/project'),
      runtimeDirectory: resolve('/workspace', './runtime'),
    });
    expect(() =>
      parseCoreMcpCliOptions(
        ['--project', './demo', '--runtime-dir', './demo/runtime'],
        { currentDirectory: '/workspace', homeDirectory: '/home/tester' },
      ),
    ).toThrow('Runtime directory must be outside the project');
    expect(() =>
      parseCoreMcpCliOptions([], {
        currentDirectory: '/workspace',
        homeDirectory: '/home/tester',
      }),
    ).toThrow('Usage: pnpm core:mcp --project <path>');
  });
});

describe('terminal operation confirmations', () => {
  it('maps generation-plan answers and includes operation identity in output', async () => {
    const write = vi.fn();
    const terminal: CoreMcpCliTerminalPort = { ...makeTerminal('yes'), write };
    const controller = new AbortController();
    await expect(
      new TerminalGenerationPlanConfirmation(terminal).request({
        operationId,
        projectId,
        summary: 'Generate drums',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
        signal: controller.signal,
      }),
    ).resolves.toBe('approved');
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining(`Operation ID: ${operationId}`),
    );
    expect(write).toHaveBeenCalledWith('Decision: approved\n');
  });

  it('maps scope-extension answers against the exact operation/request pair', async () => {
    const write = vi.fn();
    const terminal: CoreMcpCliTerminalPort = { ...makeTerminal('n'), write };
    const request: PendingScopeExtensionView = {
      operationId,
      taskId,
      requestId:
        '10000000-0000-4000-8000-000000000005' as ScopeExtensionRequestId,
      fromScopeRevision: 0,
      requestedScope: {
        type: 'wholeProject',
        trackIds: ['track.drums', 'track.bass'],
      },
      createdAt: '2026-09-12T00:00:00.000Z',
    };
    await expect(
      new TerminalScopeExtensionConfirmation(terminal).request({
        operationId,
        request,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('rejected');
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining(`Request ID: ${request.requestId}`),
    );
    expect(write).toHaveBeenCalledWith('Decision: rejected\n');
  });

  it('returns cancelled when business operation cancellation aborts the prompt', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new TerminalGenerationPlanConfirmation(makeTerminal('yes')).request({
        operationId,
        projectId,
        summary: 'Generate drums',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
        signal: controller.signal,
      }),
    ).resolves.toBe('cancelled');
  });
});
