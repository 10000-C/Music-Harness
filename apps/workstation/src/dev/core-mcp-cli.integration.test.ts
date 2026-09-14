import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { OperationView, TaskContextView } from '@agent-music/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectMcpTestClient } from '../core/mcp/mcp-sdk-test-client.js';
import { P0_MCP_TOOL_NAMES } from '../core/mcp/music-core-tool-host.js';
import { ProjectFoundation } from '../core/project/project-foundation.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from '../core/project/test-support.js';
import { runCoreMcpCli, type CoreMcpCliRuntime } from './core-mcp-cli.js';
import type { CoreMcpCliTerminalPort } from './core-mcp-cli-support.js';

const parents: string[] = [];
const runtimes: CoreMcpCliRuntime[] = [];
const generationOperationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scopeOperationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const makeTerminal = () => {
  const writes: string[] = [];
  const close = vi.fn();
  const question = vi.fn().mockResolvedValue('n');
  const terminal: CoreMcpCliTerminalPort = {
    question,
    write: (text) => writes.push(text),
    close,
  };
  return { terminal, writes, close, question };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseResult = (result: {
  readonly content: readonly unknown[];
}): unknown => {
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== 'string') {
    throw new Error('Expected MCP text result');
  }
  return JSON.parse(first.text) as unknown;
};

const operationResult = (value: unknown): OperationView => {
  if (
    !isRecord(value) ||
    typeof value.operationId !== 'string' ||
    (value.type !== 'generationPlan' && value.type !== 'scopeExtension') ||
    (value.state !== 'pending' &&
      value.state !== 'succeeded' &&
      value.state !== 'rejected' &&
      value.state !== 'cancelled' &&
      value.state !== 'failed') ||
    typeof value.createdAt !== 'string'
  ) {
    throw new Error('Expected Operation result');
  }
  return value as unknown as OperationView;
};

const succeededGenerationTask = (value: unknown): TaskContextView => {
  const operation = operationResult(value);
  if (operation.type !== 'generationPlan' || operation.state !== 'succeeded') {
    throw new Error('Expected succeeded generation Operation');
  }
  return operation.result.task;
};

const taskContextResult = (value: unknown): TaskContextView => {
  if (
    !isRecord(value) ||
    typeof value.taskId !== 'string' ||
    typeof value.projectId !== 'string' ||
    typeof value.candidateId !== 'string' ||
    typeof value.baseRevision !== 'string' ||
    typeof value.scopeRevision !== 'number'
  ) {
    throw new Error('Expected Task context result');
  }
  return value as unknown as TaskContextView;
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(parents.splice(0).map(removeTemporaryDirectory));
});

describe('runCoreMcpCli operation protocol', { concurrent: false }, () => {
  it('opens a real project and serves exactly the ten P0 tools', async () => {
    const parent = await createTemporaryDirectory('core-mcp-cli-');
    parents.push(parent);
    const projectPath = join(parent, 'Claude MCP 工程');
    const foundation = new ProjectFoundation();
    const created = await foundation.createProject(projectPath);
    await foundation.closeProject();
    const { terminal, writes } = makeTerminal();
    const runtime = await runCoreMcpCli(
      { projectPath, runtimeDirectory: join(parent, 'runtime') },
      terminal,
    );
    runtimes.push(runtime);
    const client = await connectMcpTestClient(
      runtime.descriptor.endpoint,
      runtime.descriptor.instanceToken,
    );

    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(P0_MCP_TOOL_NAMES);
      const generationPlan = listed.tools.find(
        (tool) => tool.name === 'submitGenerationPlan',
      );
      expect(generationPlan?.inputSchema?.properties).not.toHaveProperty(
        'projectId',
      );
      expect(generationPlan?.inputSchema?.required).toEqual([
        'operationId',
        'summary',
        'scope',
      ]);
      expect(writes.join('')).toContain(String(created.projectId));
      expect(writes.join('')).toContain('Music Core MCP ready');
    } finally {
      await client.close();
    }
  });

  it('returns generation-plan pending immediately and recovers the Task through getOperation', async () => {
    const parent = await createTemporaryDirectory('core-mcp-operation-plan-');
    parents.push(parent);
    const projectPath = join(parent, 'plan-project');
    const foundation = new ProjectFoundation();
    const created = await foundation.createProject(projectPath);
    await foundation.closeProject();
    const { terminal, question, writes } = makeTerminal();
    question.mockResolvedValue('y');
    const runtime = await runCoreMcpCli(
      { projectPath, runtimeDirectory: join(parent, 'runtime') },
      terminal,
    );
    runtimes.push(runtime);
    const client = await connectMcpTestClient(
      runtime.descriptor.endpoint,
      runtime.descriptor.instanceToken,
    );

    try {
      const submitted = await client.callTool({
        name: 'submitGenerationPlan',
        arguments: {
          operationId: generationOperationId,
          summary: 'Generate guitar.',
          scope: { type: 'wholeProject', trackIds: ['track.guitar'] },
        },
      });
      expect(operationResult(parseResult(submitted))).toMatchObject({
        operationId: generationOperationId,
        type: 'generationPlan',
        state: 'pending',
      });

      let completedTask: TaskContextView | undefined;
      await vi.waitFor(async () => {
        const result = await client.callTool({
          name: 'getOperation',
          arguments: { operationId: generationOperationId },
        });
        const operation = operationResult(parseResult(result));
        expect(operation.state).toBe('succeeded');
        if (
          operation.type === 'generationPlan' &&
          operation.state === 'succeeded'
        ) {
          completedTask = operation.result.task;
        }
      });
      expect(completedTask?.projectId).toBe(created.projectId);
      expect(writes.join('')).toContain(
        `Operation ID: ${generationOperationId}`,
      );
      expect(writes.join('')).toContain('Decision: approved');
    } finally {
      await client.close();
    }
  });

  it('retries the same generation operation idempotently after the original response is ignored', async () => {
    const parent = await createTemporaryDirectory('core-mcp-operation-retry-');
    parents.push(parent);
    const projectPath = join(parent, 'retry-project');
    const foundation = new ProjectFoundation();
    await foundation.createProject(projectPath);
    await foundation.closeProject();
    let resolveQuestion: ((answer: string) => void) | undefined;
    let questionCount = 0;
    const terminal: CoreMcpCliTerminalPort = {
      question: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            questionCount += 1;
            resolveQuestion = resolve;
          }),
      ),
      write: vi.fn(),
      close: vi.fn(),
    };
    const runtime = await runCoreMcpCli(
      { projectPath, runtimeDirectory: join(parent, 'runtime') },
      terminal,
    );
    runtimes.push(runtime);
    const client = await connectMcpTestClient(
      runtime.descriptor.endpoint,
      runtime.descriptor.instanceToken,
    );
    const request = {
      name: 'submitGenerationPlan',
      arguments: {
        operationId: generationOperationId,
        summary: 'Generate guitar.',
        scope: { type: 'wholeProject', trackIds: ['track.guitar'] },
      },
    } as const;

    try {
      await client.callTool(request); // Treat this response as lost/ignored.
      const retry = await client.callTool(request);
      expect(operationResult(parseResult(retry))).toMatchObject({
        operationId: generationOperationId,
        state: 'pending',
      });
      expect(questionCount).toBe(1);

      resolveQuestion?.('y');
      await vi.waitFor(async () => {
        const result = await client.callTool({
          name: 'getOperation',
          arguments: { operationId: generationOperationId },
        });
        expect(operationResult(parseResult(result)).state).toBe('succeeded');
      });

      const recoveredTask = succeededGenerationTask(
        parseResult(
          await client.callTool({
            name: 'getOperation',
            arguments: { operationId: generationOperationId },
          }),
        ),
      );
      const recoveredTaskId = recoveredTask.taskId;
      expect(recoveredTaskId).toBeTruthy();
      const retryAfterCommitTask = succeededGenerationTask(
        parseResult(await client.callTool(request)),
      );
      expect(retryAfterCommitTask.taskId).toBe(recoveredTaskId);
      expect(questionCount).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('uses generic cancelOperation to retract a pending Scope Extension', async () => {
    const parent = await createTemporaryDirectory('core-mcp-scope-operation-');
    parents.push(parent);
    const projectPath = join(parent, 'scope-project');
    const foundation = new ProjectFoundation();
    await foundation.createProject(projectPath);
    await foundation.closeProject();
    let questionCount = 0;
    const terminal: CoreMcpCliTerminalPort = {
      question: vi.fn((_prompt: string, signal?: AbortSignal) => {
        questionCount += 1;
        if (questionCount === 1) return Promise.resolve('y');
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      }),
      write: vi.fn(),
      close: vi.fn(),
    };
    const runtime = await runCoreMcpCli(
      { projectPath, runtimeDirectory: join(parent, 'runtime') },
      terminal,
    );
    runtimes.push(runtime);
    const client = await connectMcpTestClient(
      runtime.descriptor.endpoint,
      runtime.descriptor.instanceToken,
    );

    try {
      await client.callTool({
        name: 'submitGenerationPlan',
        arguments: {
          operationId: generationOperationId,
          summary: 'Generate guitar.',
          scope: { type: 'wholeProject', trackIds: ['track.guitar'] },
        },
      });
      let task: TaskContextView | undefined;
      await vi.waitFor(async () => {
        const operation = parseResult(
          await client.callTool({
            name: 'getOperation',
            arguments: { operationId: generationOperationId },
          }),
        );
        const parsed = operationResult(operation);
        if (parsed.type === 'generationPlan' && parsed.state === 'succeeded') {
          task = parsed.result.task;
        }
        expect(task).toBeDefined();
      });
      if (task === undefined) throw new Error('Expected generated Task');
      const envelope = {
        taskId: task.taskId,
        projectId: task.projectId,
        candidateId: task.candidateId,
        baseRevision: task.baseRevision,
        expectedScopeRevision: task.scopeRevision,
      };
      const scopeResult = operationResult(
        parseResult(
          await client.callTool({
            name: 'requestScopeExtension',
            arguments: {
              operationId: scopeOperationId,
              envelope,
              requestedScope: {
                type: 'wholeProject',
                trackIds: [
                  'track.drums',
                  'track.bass',
                  'track.guitar',
                  'track.keys',
                  'track.strings',
                  'track.winds',
                ],
              },
            },
          }),
        ),
      );
      expect(scopeResult).toMatchObject({ state: 'pending' });
      const contextBefore = taskContextResult(
        parseResult(
          await client.callTool({
            name: 'getTaskContext',
            arguments: { taskId: task.taskId },
          }),
        ),
      );
      expect(contextBefore.pendingScopeExtension?.operationId).toBe(
        scopeOperationId,
      );

      const cancelled = operationResult(
        parseResult(
          await client.callTool({
            name: 'cancelOperation',
            arguments: { operationId: scopeOperationId },
          }),
        ),
      );
      expect(cancelled.state).toBe('cancelled');
      const contextAfter = taskContextResult(
        parseResult(
          await client.callTool({
            name: 'getTaskContext',
            arguments: { taskId: task.taskId },
          }),
        ),
      );
      expect(contextAfter.pendingScopeExtension).toBeUndefined();
      expect(contextAfter.scopeRevision).toBe(0);
    } finally {
      await client.close();
    }
  });

  it('refuses a recovery-required Current and releases the Project lock', async () => {
    const parent = await createTemporaryDirectory('core-mcp-cli-dirty-');
    parents.push(parent);
    const projectPath = join(parent, 'dirty-project');
    const foundation = new ProjectFoundation();
    const created = await foundation.createProject(projectPath);
    await foundation.closeProject();
    await writeFile(join(projectPath, 'composition.abc'), '% dirty\n', 'utf8');
    const { terminal, close } = makeTerminal();

    const outcome = await runCoreMcpCli(
      { projectPath, runtimeDirectory: join(parent, 'runtime') },
      terminal,
    ).then(
      async (runtime) => {
        await runtime.close();
        return { ok: true as const, error: undefined };
      },
      (error: unknown) => ({ ok: false as const, error }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({
      message: 'Project Current must be ready before starting the MCP server',
    });
    expect(close).toHaveBeenCalledTimes(1);

    const reopened = new ProjectFoundation();
    await expect(reopened.openProject(projectPath)).resolves.toMatchObject({
      projectId: created.projectId,
      state: 'recoveryRequired',
    });
    await reopened.closeProject();
  });
});
