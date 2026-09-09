import { createServer } from 'node:http';

import { Agent } from '@strands-agents/sdk';
import type { ProjectId } from '@agent-music/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MusicCoreMcpHttpServer } from '../../../workstation/src/core/mcp/music-core-mcp-server.js';
import { P0_MCP_TOOL_NAMES } from '../../../workstation/src/core/mcp/music-core-tool-host.js';
import { createStrandsMcpClient } from '../mcp/strands-mcp.js';
import { createOpenAiChatModel } from '../model/openai-chat-model.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const taskId = '22222222-2222-4222-8222-222222222222';
const servers: ReturnType<typeof createServer>[] = [];
const mcpServers: MusicCoreMcpHttpServer[] = [];

const startFakeOpenAi = async () => {
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      raw += chunk;
    });
    request.on('end', () => {
      requests.push(JSON.parse(raw) as unknown);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      if (requests.length === 1) {
        response.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-tool-1',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-task-context',
                      type: 'function',
                      function: {
                        name: 'getTaskContext',
                        arguments: JSON.stringify({ taskId }),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-tool-1',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}\n\n`,
        );
      } else {
        response.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-tool-2',
            object: 'chat.completion.chunk',
            created: 2,
            model: 'test-model',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'Task context loaded.' },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-tool-2',
            object: 'chat.completion.chunk',
            created: 2,
            model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}\n\n`,
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fake OpenAI server failed to bind');
  }
  return {
    endpoint: `http://127.0.0.1:${String(address.port)}/v1`,
    requests,
  };
};

afterEach(async () => {
  await Promise.all(mcpServers.splice(0).map((server) => server.stop()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error !== undefined) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
});

describe('Strands real MCP tool loop', () => {
  it('turns a real OpenAI tool_call into MCP execution, afterToolCallEvent, and next model input', async () => {
    const fake = await startFakeOpenAi();
    const call = vi.fn(
      (
        name: string,
        input: unknown,
        options?: { readonly signal?: AbortSignal },
      ) => {
        void options;
        return Promise.resolve({
          name,
          input,
          task: { taskId, projectId, marker: 'from-real-mcp' },
        });
      },
    );
    const mcpServer = new MusicCoreMcpHttpServer({
      projectId,
      runtimeDirectory: `/tmp/strands-tool-loop-${String(process.pid)}-${String(Date.now())}`,
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call,
      },
      createToken: () => 'strands-tool-loop-token',
    });
    mcpServers.push(mcpServer);
    const descriptor = await mcpServer.start();
    const mcpClient = createStrandsMcpClient(descriptor);
    const agent = new Agent({
      model: createOpenAiChatModel({
        id: 'tool-loop-test',
        endpoint: fake.endpoint,
        apiKey: 'tool-loop-test-key',
        model: 'test-model',
      }),
      tools: [mcpClient],
      printer: false,
    });

    const events: unknown[] = [];
    for await (const event of agent.stream('Load the Task context.')) {
      events.push(event);
    }

    expect(call).toHaveBeenCalledOnce();
    const mcpCall = call.mock.calls[0];
    expect(mcpCall?.[0]).toBe('getTaskContext');
    expect(mcpCall?.[1]).toEqual({ taskId });
    expect(mcpCall?.[2]?.signal).toBeInstanceOf(AbortSignal);
    const afterToolCall = events.find(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'afterToolCallEvent',
    ) as
      | {
          readonly toolUse: { readonly name: string };
          readonly result: {
            readonly status: string;
            readonly content: readonly unknown[];
          };
        }
      | undefined;
    expect(afterToolCall).toBeDefined();
    expect(afterToolCall?.toolUse.name).toBe('getTaskContext');
    expect(afterToolCall?.result.status).toBe('success');
    expect(JSON.stringify(afterToolCall?.result.content)).toContain(
      'from-real-mcp',
    );
    expect(fake.requests).toHaveLength(2);
    expect(JSON.stringify(fake.requests[1])).toContain('call-task-context');
    expect(JSON.stringify(fake.requests[1])).toContain('from-real-mcp');

    await mcpClient.disconnect();
  });
});
