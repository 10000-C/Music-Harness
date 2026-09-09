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
  const terminal: CoreMcpCliTerminalPort = {
    question: vi.fn().mockResolvedValue('n'),
    write: (text) => {
      writes.push(text);
    },
    close,
  };
  return { terminal, writes, close };
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(parents.splice(0).map(removeTemporaryDirectory));
});

describe('runCoreMcpCli', { concurrent: false }, () => {
  it('opens a real project and serves the seven P0 tools to a standard MCP client', async () => {
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
