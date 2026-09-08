import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { connectMcpTestClient } from './mcp-sdk-test-client.js';
import type { ProjectId } from '@agent-music/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { P0_MCP_TOOL_NAMES } from './music-core-tool-host.js';
import {
  MusicCoreMcpHttpServer,
  RuntimeDescriptorStore,
} from './music-core-mcp-server.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const taskId = '22222222-2222-4222-8222-222222222222';
const tempDirectories: string[] = [];
const servers: MusicCoreMcpHttpServer[] = [];

const makeRuntimeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'music-core-mcp-'));
  tempDirectories.push(directory);
  return directory;
};

const makeServer = async () => {
  const runtimeDirectory = await makeRuntimeDirectory();
  const call = vi.fn((name: string) => Promise.resolve({ name, taskId }));
  const server = new MusicCoreMcpHttpServer({
    projectId,
    runtimeDirectory,
    toolHost: {
      listTools: () => P0_MCP_TOOL_NAMES,
      call,
    },
    createToken: () => 'test-instance-token',
  });
  servers.push(server);
  const descriptor = await server.start();
  return { runtimeDirectory, call, server, descriptor };
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('MusicCoreMcpHttpServer', () => {
  it('publishes a user-only runtime descriptor and removes it on stop', async () => {
    const { runtimeDirectory, server, descriptor } = await makeServer();
    const descriptorPath = join(runtimeDirectory, `${projectId}.json`);

    expect(JSON.parse(await readFile(descriptorPath, 'utf8'))).toEqual(
      descriptor,
    );
    expect((await stat(descriptorPath)).mode & 0o777).toBe(0o600);
    expect(descriptor.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    await server.stop();
    await expect(stat(descriptorPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects requests without the Instance Token', async () => {
    const { descriptor } = await makeServer();
    const response = await fetch(descriptor.endpoint);
    expect(response.status).toBe(401);
  });

  it('serves exactly seven tools over real Streamable HTTP and delegates calls', async () => {
    const { call, descriptor } = await makeServer();
    const client = await connectMcpTestClient(
      descriptor.endpoint,
      descriptor.instanceToken,
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(P0_MCP_TOOL_NAMES);

    const result = await client.callTool({
      name: 'getTaskContext',
      arguments: { taskId },
    });
    const text = result.content[0];
    expect(text).toMatchObject({ type: 'text' });
    if (text === undefined) {
      throw new Error('Expected text MCP result');
    }
    expect(JSON.parse(text.text)).toEqual({ name: 'getTaskContext', taskId });
    expect(call).toHaveBeenCalledWith('getTaskContext', { taskId });

    await client.close();
  });
});

describe('RuntimeDescriptorStore', () => {
  it('removes malformed and dead-process descriptors during cleanup', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    await writeFile(
      join(runtimeDirectory, 'malformed.json'),
      '{broken',
      'utf8',
    );
    await writeFile(
      join(runtimeDirectory, `${projectId}.json`),
      JSON.stringify({
        projectId,
        endpoint: 'http://127.0.0.1:1234/mcp',
        instanceToken: 'old-token',
        pid: 999999,
      }),
      'utf8',
    );
    const store = new RuntimeDescriptorStore(runtimeDirectory, () => false);

    await store.cleanupStale();

    await expect(
      stat(join(runtimeDirectory, 'malformed.json')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      stat(join(runtimeDirectory, `${projectId}.json`)),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
