import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

const makeTerminal = () => {
  const writes: string[] = [];
  const close = vi.fn();
  const question = vi.fn().mockResolvedValue('n');
  const terminal: CoreMcpCliTerminalPort = {
    question,
    write: (text) => {
      writes.push(text);
    },
    close,
  };
  return { terminal, writes, close, question };
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(parents.splice(0).map(removeTemporaryDirectory));
});

describe('runCoreMcpCli', { concurrent: false }, () => {
  it('opens a real project and serves the eight P0 tools to a standard MCP client', async () => {
    const parent = await createTemporaryDirectory('core-mcp-cli-');
    parents.push(parent);
    const projectPath = join(parent, 'Claude MCP 工程');
    const initialFoundation = new ProjectFoundation();
    const created = await initialFoundation.createProject(projectPath);
    await initialFoundation.closeProject();
    const runtimeDirectory = join(parent, 'runtime-outside-project');
    const { terminal, writes, close } = makeTerminal();

    const runtime = await runCoreMcpCli(
      { projectPath, runtimeDirectory },
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
      const generationPlanTool = listed.tools.find(
        (tool) => tool.name === 'submitGenerationPlan',
      );
      expect(generationPlanTool?.inputSchema?.properties).not.toHaveProperty(
        'projectId',
      );
      expect(generationPlanTool?.inputSchema?.required).toEqual([
        'summary',
        'scope',
      ]);
      expect(runtime.descriptor.projectId).toBe(created.projectId);
      expect(writes.join('')).toContain('Music Core MCP ready');
      expect(writes.join('')).toContain(runtime.descriptor.endpoint);
      expect(writes.join('')).toContain(runtime.descriptor.instanceToken);
      expect(writes.join('')).toContain(
        'claude mcp add --transport http agent-music',
      );

      const competingFoundation = new ProjectFoundation();
      await expect(
        competingFoundation.openProject(projectPath),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }

    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);
    expect(close).toHaveBeenCalledTimes(1);

    const reopened = new ProjectFoundation();
    await expect(reopened.openProject(projectPath)).resolves.toMatchObject({
      projectId: created.projectId,
      state: 'ready',
    });
    await reopened.closeProject();
  });
  it('binds submitGenerationPlan to the opened Project and approves terminal y over real MCP', async () => {
    const parent = await createTemporaryDirectory('core-mcp-cli-plan-');
    parents.push(parent);
    const projectPath = join(parent, 'plan-project');
    const foundation = new ProjectFoundation();
    const created = await foundation.createProject(projectPath);
    await foundation.closeProject();
    const runtimeDirectory = join(parent, 'runtime');
    const { terminal, question } = makeTerminal();
    question.mockResolvedValue('y');

    const runtime = await runCoreMcpCli(
      { projectPath, runtimeDirectory },
      terminal,
    );
    runtimes.push(runtime);
    const client = await connectMcpTestClient(
      runtime.descriptor.endpoint,
      runtime.descriptor.instanceToken,
    );

    try {
      const result = await client.callTool({
        name: 'submitGenerationPlan',
        arguments: {
          summary: 'Generate all six tracks.',
          scope: {
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
      });
      const content = result.content[0];
      expect(content).toBeDefined();
      const payload = JSON.parse(content?.text ?? '{}') as {
        readonly approved?: boolean;
        readonly task?: { readonly projectId?: string };
      };
      expect(payload.approved).toBe(true);
      expect(payload.task?.projectId).toBe(created.projectId);
    } finally {
      await client.close();
    }
  });

  it('cancels a timed-out generation-plan prompt before approving a retry', async () => {
    const parent = await createTemporaryDirectory(
      'core-mcp-cli-timeout-retry-',
    );
    parents.push(parent);
    const projectPath = join(parent, 'timeout-retry-project');
    const foundation = new ProjectFoundation();
    const created = await foundation.createProject(projectPath);
    await foundation.closeProject();
    let questionCount = 0;
    const writes: string[] = [];
    const terminal: CoreMcpCliTerminalPort = {
      question: vi.fn((_prompt: string, signal?: AbortSignal) => {
        questionCount += 1;
        if (questionCount === 1) {
          return new Promise<string>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            );
          });
        }
        return Promise.resolve('y');
      }),
      write: (text) => {
        writes.push(text);
      },
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
        summary: 'Generate all six tracks.',
        scope: {
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
    } as const;

    try {
      const timedOut = client.callTool(request, { timeout: 50 }).then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.waitFor(() => {
        expect(questionCount).toBe(1);
      });
      const timeoutError = await timedOut;
      expect(timeoutError).toBeInstanceOf(Error);
      if (!(timeoutError instanceof Error)) {
        throw new Error('Expected MCP timeout error');
      }
      expect(timeoutError.message).toContain('Request timed out');

      const retried = await client.callTool(request, { timeout: 1_000 });
      const payload = JSON.parse(retried.content[0]?.text ?? '{}') as {
        readonly approved?: boolean;
        readonly task?: { readonly projectId?: string };
      };
      expect(payload.approved).toBe(true);
      expect(payload.task?.projectId).toBe(created.projectId);
      expect(questionCount).toBe(2);
      expect(writes.join('')).toContain('Decision: cancelled');
      expect(writes.join('')).toContain('Decision: approved');
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
