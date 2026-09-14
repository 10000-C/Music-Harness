import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CandidateError } from '../candidate/candidate-error.js';
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
  const call = vi.fn(
    (
      name: string,
      input: unknown,
      options?: { readonly signal?: AbortSignal },
    ) => {
      void input;
      void options;
      return Promise.resolve({ name, taskId });
    },
  );
  const server = new MusicCoreMcpHttpServer({
    resolveProjectId: () => projectId,
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
    const descriptorPath = join(runtimeDirectory, 'core.json');

    expect(JSON.parse(await readFile(descriptorPath, 'utf8'))).toEqual(
      descriptor,
    );
    if (process.platform !== 'win32') {
      expect((await stat(descriptorPath)).mode & 0o777).toBe(0o600);
    }
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

  it('closes the HTTP server when runtime descriptor publication fails', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const descriptorStore = {
      cleanupStale: vi.fn(() => Promise.resolve()),
      write: vi
        .fn()
        .mockRejectedValueOnce(new Error('descriptor write failed'))
        .mockResolvedValue(undefined),
      remove: vi.fn(() => Promise.resolve()),
    };
    const options = {
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () => Promise.resolve({ ok: true }),
      },
      createToken: () => 'publish-failure-token',
      descriptorStore,
    };
    const server = new MusicCoreMcpHttpServer(options);
    servers.push(server);

    await expect(server.start()).rejects.toThrow('descriptor write failed');
    await expect(server.start()).resolves.toMatchObject({ pid: process.pid });
  });

  it('closes the HTTP server even when runtime descriptor removal fails', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const descriptorStore = {
      cleanupStale: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      remove: vi
        .fn()
        .mockRejectedValueOnce(new Error('descriptor remove failed'))
        .mockResolvedValue(undefined),
    };
    const options = {
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () => Promise.resolve({ ok: true }),
      },
      createToken: () => 'remove-failure-token',
      descriptorStore,
    };
    const server = new MusicCoreMcpHttpServer(options);
    servers.push(server);
    await server.start();

    await expect(server.stop()).rejects.toThrow('descriptor remove failed');
    await expect(server.start()).resolves.toMatchObject({ pid: process.pid });
  });

  it('preserves stable sanitized Candidate errors in MCP Tool Results', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () =>
          Promise.reject(
            new CandidateError(
              'OPERATION_NOT_ALLOWED',
              'Operation is not allowed by the current Task Scope',
              {
                worktreePath: '/private/worktree',
                stderr: 'secret git stderr',
              },
            ),
          ),
      },
      createToken: () => 'stable-error-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const client = await connectMcpTestClient(
      descriptor.endpoint,
      descriptor.instanceToken,
    );

    const result = await client.callTool({
      name: 'getTaskContext',
      arguments: { taskId },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      code: 'OPERATION_NOT_ALLOWED',
      message: 'Operation is not allowed by the current Task Scope',
    });
    expect(JSON.stringify(result)).not.toContain('/private/worktree');
    expect(JSON.stringify(result)).not.toContain('secret git stderr');
    await client.close();
  });

  it('exposes safe pending Scope Extension recovery metadata to MCP clients', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const requestId = '44444444-4444-4444-8444-444444444444';
    const requestedScope = {
      type: 'wholeProject',
      trackIds: ['track.drums', 'track.bass'],
    };
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () =>
          Promise.reject(
            new CandidateError(
              'TASK_SCOPE_EXTENSION_PENDING',
              'Candidate writes are blocked while a Scope Extension is pending',
              {
                requestId,
                requestedScope,
                fromScopeRevision: 0,
                createdAt: '2026-09-12T00:00:00.000Z',
                privatePath: '/private/worktree',
              },
            ),
          ),
      },
      createToken: () => 'pending-error-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const client = await connectMcpTestClient(
      descriptor.endpoint,
      descriptor.instanceToken,
    );

    const result = await client.callTool({
      name: 'getTaskContext',
      arguments: { taskId },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      code: 'TASK_SCOPE_EXTENSION_PENDING',
      message:
        'Candidate writes are blocked while a Scope Extension is pending',
      details: {
        requestId,
        requestedScope,
        fromScopeRevision: 0,
        createdAt: '2026-09-12T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(result)).not.toContain('/private/worktree');
    await client.close();
  });

  it('exposes only safe validation phase metadata to MCP clients', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () =>
          Promise.reject(
            new CandidateError(
              'VALIDATION_FAILED',
              'Composition validation failed',
              {
                phase: 'currentComposition',
                validation: {
                  valid: false,
                  issues: [
                    {
                      code: 'ABC_NOT_CANONICAL',
                      message: 'Current Candidate source is not canonical',
                    },
                  ],
                },
                source: '/private/project/composition.abc',
              },
            ),
          ),
      },
      createToken: () => 'validation-phase-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const client = await connectMcpTestClient(
      descriptor.endpoint,
      descriptor.instanceToken,
    );

    const result = await client.callTool({
      name: 'getTaskContext',
      arguments: { taskId },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Composition validation failed',
      details: {
        phase: 'currentComposition',
        validation: {
          valid: false,
          issues: [
            {
              code: 'ABC_NOT_CANONICAL',
              message: 'Current Candidate source is not canonical',
            },
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('/private/project');
    await client.close();
  });

  it('redacts unexpected MCP Tool failures behind the stable A3 fallback', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () => Promise.reject(new Error('/secret/path provider detail')),
      },
      createToken: () => 'generic-error-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const client = await connectMcpTestClient(
      descriptor.endpoint,
      descriptor.instanceToken,
    );

    const result = await client.callTool({
      name: 'getTaskContext',
      arguments: { taskId },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      code: 'CANDIDATE_TRANSACTION_FAILED',
      message: 'Candidate transaction failed',
    });
    expect(JSON.stringify(result)).not.toContain('/secret/path');
    await client.close();
  });

  it('propagates MCP request timeout cancellation to the active Tool Call signal', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    let wasAborted = false;
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: (_name, _input, options) =>
          new Promise((resolve) => {
            const fallback = setTimeout(() => {
              resolve({ aborted: false });
            }, 300);
            options?.signal?.addEventListener(
              'abort',
              () => {
                wasAborted = true;
                clearTimeout(fallback);
                resolve({ aborted: true });
              },
              { once: true },
            );
          }),
      },
      createToken: () => 'timeout-cancellation-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const client = await connectMcpTestClient(
      descriptor.endpoint,
      descriptor.instanceToken,
    );

    const timedOut = client
      .callTool(
        { name: 'getTaskContext', arguments: { taskId } },
        { timeout: 50 },
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    const timeoutError = await timedOut;
    expect(timeoutError).toBeInstanceOf(Error);
    if (!(timeoutError instanceof Error)) {
      throw new Error('Expected MCP timeout error');
    }
    expect(timeoutError.message).toContain('Request timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(wasAborted).toBe(true);

    await client.close();
  });

  it('fails submitGenerationPlan with PROJECT_NOT_OPEN when no Project is open', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const call = vi.fn(() => Promise.resolve({ ok: true }));
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => undefined,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call,
      },
      createToken: () => 'no-project-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const client = await connectMcpTestClient(
      descriptor.endpoint,
      descriptor.instanceToken,
    );

    const result = await client.callTool({
      name: 'submitGenerationPlan',
      arguments: {
        operationId: '55555555-5555-4555-8555-555555555555',
        summary: 'plan',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      code: 'PROJECT_NOT_OPEN',
      message: 'No Project is open in this Core process',
    });
    expect(call).not.toHaveBeenCalled();
    await client.close();
  });

  it('routes control cancel-task through the host control port with token auth', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const cancelTask = vi.fn(() => Promise.resolve({ cancelled: true }));
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () => Promise.resolve({ ok: true }),
      },
      control: { cancelTask },
      createToken: () => 'control-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const controlUrl = `${descriptor.endpoint.slice(0, -'/mcp'.length)}/control/cancel-task`;
    const body = JSON.stringify({
      projectId,
      candidateId: '33333333-3333-4333-8333-333333333333',
      taskId,
    });

    const unauthorized = await fetch(controlUrl, {
      method: 'POST',
      body,
    });
    expect(unauthorized.status).toBe(401);
    expect(cancelTask).not.toHaveBeenCalled();

    const invalid = await fetch(controlUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.instanceToken}` },
      body: '{"projectId": "not-a-uuid"}',
    });
    expect(invalid.status).toBe(400);
    expect(cancelTask).not.toHaveBeenCalled();

    const accepted = await fetch(controlUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.instanceToken}` },
      body,
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true });
    expect(cancelTask).toHaveBeenCalledWith({
      projectId,
      candidateId: '33333333-3333-4333-8333-333333333333',
      taskId,
    });

    const unknown = await fetch(
      `${descriptor.endpoint.slice(0, -'/mcp'.length)}/control/other`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${descriptor.instanceToken}` },
        body,
      },
    );
    expect(unknown.status).toBe(404);
  });

  it('reports CandidateError payloads from control cancel-task as 500 JSON', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => projectId,
      runtimeDirectory,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: () => Promise.resolve({ ok: true }),
      },
      control: {
        cancelTask: () =>
          Promise.reject(
            new CandidateError('TASK_NOT_ACTIVE', 'Task already finished'),
          ),
      },
      createToken: () => 'control-error-token',
    });
    servers.push(server);
    const descriptor = await server.start();
    const controlUrl = `${descriptor.endpoint.slice(0, -'/mcp'.length)}/control/cancel-task`;

    const response = await fetch(controlUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.instanceToken}` },
      body: JSON.stringify({
        projectId,
        candidateId: '33333333-3333-4333-8333-333333333333',
        taskId,
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'TASK_NOT_ACTIVE',
      message: 'Task already finished',
    });
  });

  it('serves exactly ten tools over real Streamable HTTP and delegates calls', async () => {
    const { call, descriptor } = await makeServer();
    const client = await connectMcpTestClient(
      descriptor.endpoint,
      descriptor.instanceToken,
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(P0_MCP_TOOL_NAMES);
    expect(
      tools.tools.find((tool) => tool.name === 'getScopedComposition')
        ?.description,
    ).toContain('canonical voice-body fragments');
    const replacementTool = tools.tools.find(
      (tool) => tool.name === 'replaceScopedMusic',
    );
    expect(replacementTool?.description).toContain('voice-body fragment');
    expect(replacementTool?.description).toContain('ABC_NOT_CANONICAL');
    expect(replacementTool?.description).toContain('currentComposition');

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
    expect(call).toHaveBeenCalledTimes(1);
    const callArguments = call.mock.calls[0];
    expect(callArguments?.[0]).toBe('getTaskContext');
    expect(callArguments?.[1]).toEqual({ taskId });
    expect(callArguments?.[2]?.signal).toBeInstanceOf(AbortSignal);

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
      join(runtimeDirectory, 'core.json'),
      JSON.stringify({
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
      stat(join(runtimeDirectory, 'core.json')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
