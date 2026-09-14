import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpTaskRollback } from './http-task-rollback.js';
import type { McpRuntimeDescriptor } from '@agent-music/contracts';
import type { CandidateId, ProjectId, TaskId } from '@agent-music/contracts';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const candidateId = '22222222-2222-4222-8222-222222222222' as CandidateId;
const taskId = '33333333-3333-4333-8333-333333333333' as TaskId;

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    ),
  );
});

const startControlStub = async (
  handler: (
    request: { readonly url: string | undefined; readonly body: string },
    respond: (status: number, body: string) => void,
  ) => void,
): Promise<{ readonly endpoint: string; readonly token: string }> => {
  let resolveReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      handler(
        {
          url: request.url,
          body: Buffer.concat(chunks).toString('utf8'),
        },
        (status, body) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(body);
        },
      );
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1', () => {
    resolveReady?.();
  });
  await ready;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('control stub failed to bind');
  }
  return {
    endpoint: `http://127.0.0.1:${String(address.port)}/mcp`,
    token: 'rollback-test-token',
  };
};

const descriptorsFor = (
  endpoint: string,
  token: string,
): { read(): Promise<McpRuntimeDescriptor> } => ({
  read: () =>
    Promise.resolve({
      endpoint,
      instanceToken: token,
      pid: process.pid,
    }),
});

describe('HttpTaskRollback', () => {
  it('posts the cancel-task control request derived from the descriptor', async () => {
    const seen: { url: string | undefined; body: string }[] = [];
    const { endpoint, token } = await startControlStub((request, respond) => {
      seen.push({ url: request.url, body: request.body });
      respond(200, '{"ok":true}');
    });
    const rollback = new HttpTaskRollback({
      descriptors: descriptorsFor(endpoint, token),
    });

    await expect(
      rollback.cancelTask({ projectId, candidateId, taskId }),
    ).resolves.toEqual({ ok: true });
    expect(seen).toEqual([
      {
        url: '/control/cancel-task',
        body: JSON.stringify({ projectId, candidateId, taskId }),
      },
    ]);
  });

  it('sends the instance token as a bearer credential', async () => {
    const authorizations: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('control stub failed to bind');
    }
    const endpoint = `http://127.0.0.1:${String(address.port)}/mcp`;

    const rollback = new HttpTaskRollback({
      descriptors: descriptorsFor(endpoint, 'rollback-test-token'),
    });
    await rollback.cancelTask({ projectId, candidateId, taskId });

    expect(authorizations).toEqual(['Bearer rollback-test-token']);
  });

  it('surfaces stable Candidate error payloads as errors', async () => {
    const { endpoint, token } = await startControlStub((_request, respond) => {
      respond(
        500,
        JSON.stringify({ code: 'TASK_NOT_ACTIVE', message: 'Task finished' }),
      );
    });
    const rollback = new HttpTaskRollback({
      descriptors: descriptorsFor(endpoint, token),
    });

    await expect(
      rollback.cancelTask({ projectId, candidateId, taskId }),
    ).rejects.toMatchObject({
      code: 'TASK_NOT_ACTIVE',
      message: 'Task finished',
    });
  });

  it('rejects when the control endpoint is unreachable', async () => {
    const read = vi.fn(() =>
      Promise.reject(new Error('descriptor unavailable')),
    );
    const rollback = new HttpTaskRollback({ descriptors: { read } });

    await expect(
      rollback.cancelTask({ projectId, candidateId, taskId }),
    ).rejects.toThrow('descriptor unavailable');
  });

  it('maps unexpected non-JSON failures to a stable rollback error', async () => {
    const { endpoint, token } = await startControlStub((_request, respond) => {
      respond(500, 'not-json');
    });
    const rollback = new HttpTaskRollback({
      descriptors: descriptorsFor(endpoint, token),
    });

    await expect(
      rollback.cancelTask({ projectId, candidateId, taskId }),
    ).rejects.toMatchObject({ code: 'AGENT_ROLLBACK_FAILED' });
  });
});
