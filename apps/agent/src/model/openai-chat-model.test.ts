import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from '@strands-agents/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentSessionId } from '@agent-music/contracts';

import { createStrandsSession } from '../session/index.js';
import type { AgentModelConfig } from '../settings/index.js';
import { createOpenAiChatModel } from './openai-chat-model.js';

const servers: ReturnType<typeof createServer>[] = [];
const tempDirectories: string[] = [];
const sessionId = '77777777-7777-4777-8777-777777777777' as AgentSessionId;

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

const storageContains = async (
  root: string,
  marker: string,
): Promise<boolean> => {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (await storageContains(path, marker)) {
        return true;
      }
      continue;
    }
    if (
      entry.isFile() &&
      (await readFile(path)).includes(Buffer.from(marker))
    ) {
      return true;
    }
  }
  return false;
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
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
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

  it('does not persist the configured API key in Strands Session Storage', async () => {
    const fake = await startFakeOpenAi();
    const storageRoot = await mkdtemp(join(tmpdir(), 'agent-api-key-session-'));
    tempDirectories.push(storageRoot);
    const apiKey = 'session-secret-marker-do-not-persist';
    const resources = createStrandsSession(sessionId, storageRoot);
    const model = createOpenAiChatModel({
      id: 'session-safety-test',
      endpoint: fake.endpoint,
      apiKey,
      model: 'test-model',
    });
    const agent = new Agent({
      model,
      sessionManager: resources.sessionManager,
      storage: resources.storage,
      contextManager: 'auto',
      printer: false,
    });

    await agent.invoke('persist only this conversation');

    await expect(storageContains(storageRoot, apiKey)).resolves.toBe(false);
  });
});
