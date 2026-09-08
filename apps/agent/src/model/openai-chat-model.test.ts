import { createServer } from 'node:http';

import { Agent } from '@strands-agents/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentModelConfig } from '../settings/index.js';
import { createOpenAiChatModel } from './openai-chat-model.js';

const servers: ReturnType<typeof createServer>[] = [];

const startFakeOpenAi = async () => {
  const requests: {
    readonly url: string | undefined;
    readonly authorization: string | undefined;
    readonly body: unknown;
  }[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      raw += chunk;
    });
    request.on('end', () => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(raw) as unknown,
      });
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      response.write(
        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n',
      );
      response.write(
        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      );
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

describe('createOpenAiChatModel', () => {
  it('uses the configured OpenAI-compatible Chat Completions endpoint and model', async () => {
    const fake = await startFakeOpenAi();
    const config: AgentModelConfig = {
      id: 'local-test',
      endpoint: fake.endpoint,
      apiKey: 'local-test-key',
      model: 'test-model',
      parameters: { temperature: 0.25 },
    };
    const model = createOpenAiChatModel(config);
    const agent = new Agent({ model, printer: false });

    const result = await agent.invoke('say hello');

    expect(result.stopReason).toBe('endTurn');
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      url: '/v1/chat/completions',
      authorization: 'Bearer local-test-key',
      body: {
        model: 'test-model',
        stream: true,
        temperature: 0.25,
      },
    });
  });
});
