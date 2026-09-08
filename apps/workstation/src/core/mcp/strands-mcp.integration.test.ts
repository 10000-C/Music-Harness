import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectId } from '@agent-music/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createStrandsMcpClient } from '../../../../agent/src/mcp/strands-mcp.js';
import { MusicCoreMcpHttpServer } from './music-core-mcp-server.js';
import { P0_MCP_TOOL_NAMES } from './music-core-tool-host.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const tempDirectories: string[] = [];
const servers: MusicCoreMcpHttpServer[] = [];

const makeRuntimeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'strands-core-mcp-'));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Strands MCP integration', () => {
  it('discovers exactly the seven P0 tools through the authenticated Core endpoint', async () => {
    const server = new MusicCoreMcpHttpServer({
      projectId,
      runtimeDirectory: await makeRuntimeDirectory(),
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () => Promise.resolve({ ok: true }),
      },
      createToken: () => 'strands-integration-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const client = createStrandsMcpClient(descriptor);

    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(P0_MCP_TOOL_NAMES);
    await client.disconnect();
  });

  it('mechanically removes requestScopeExtension from the repair-mode tool list', async () => {
    const server = new MusicCoreMcpHttpServer({
      projectId,
      runtimeDirectory: await makeRuntimeDirectory(),
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () => Promise.resolve({ ok: true }),
      },
      createToken: () => 'strands-repair-integration-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const client = createStrandsMcpClient(descriptor, { repairMode: true });

    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      P0_MCP_TOOL_NAMES.filter((name) => name !== 'requestScopeExtension'),
    );
    await client.disconnect();
  });
});
