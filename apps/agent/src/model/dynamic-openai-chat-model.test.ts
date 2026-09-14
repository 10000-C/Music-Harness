import { createServer } from 'node:http';

import { Message } from '@strands-agents/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentModelConfig } from '../settings/index.js';
import { DynamicOpenAiChatModel } from './dynamic-openai-chat-model.js';

const servers: ReturnType<typeof createServer>[] = [];

const startFakeOpenAi = async (responseText: string) => {
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
      response.write(
        `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":${JSON.stringify(responseText)}},"finish_reason":null}]}\n\n`,
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

const consume = async (model: DynamicOpenAiChatModel): Promise<void> => {
  for await (const event of model.stream([
    Message.fromMessageData({
      role: 'user',
      content: [{ text: 'continue' }],
    }),
  ])) {
    void event;
  }
};

describe('DynamicOpenAiChatModel', () => {
  it('resolves the active model configuration for every Strands model call', async () => {
    const first = await startFakeOpenAi('first');
    const second = await startFakeOpenAi('second');
    const modelA: AgentModelConfig = {
      id: 'a',
      endpoint: first.endpoint,
      apiKey: 'key-a',
      model: 'model-a',
    };
    const modelB: AgentModelConfig = {
      id: 'b',
      endpoint: second.endpoint,
      apiKey: 'key-b',
      model: 'model-b',
    };
    const getActiveModelConfig = vi
      .fn()
      .mockResolvedValueOnce(modelA)
      .mockResolvedValueOnce(modelB);
    const dynamic = new DynamicOpenAiChatModel(modelA, {
      getActiveModelConfig,
    });

    await consume(dynamic);
    await consume(dynamic);

    expect(getActiveModelConfig).toHaveBeenCalledTimes(2);
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(1);
    expect(first.requests[0]).toMatchObject({ model: 'model-a' });
    expect(second.requests[0]).toMatchObject({ model: 'model-b' });
    expect(dynamic.activeConfigurationId).toBe('b');
  });
});
