import { createServer } from 'node:http';

import { Agent } from '@strands-agents/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { createOpenAiChatModel } from '../model/openai-chat-model.js';
import {
  MUSIC_STYLE_SKILL_NAMES,
  createMusicStyleReferenceTool,
  createMusicStyleSkillsPlugin,
} from './music-style-skills.js';

const servers: ReturnType<typeof createServer>[] = [];

const startFakeOpenAi = async (expectedSkill: string) => {
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

      const index = requests.length;
      const toolCall =
        index === 1
          ? {
              id: `call-skill-${expectedSkill}`,
              name: 'skills',
              input: { skill_name: expectedSkill },
            }
          : index === 2
            ? {
                id: `call-reference-${expectedSkill}`,
                name: 'music_style_reference',
                input: {
                  skill_name: expectedSkill,
                  resource: 'style-guide.md',
                },
              }
            : undefined;

      if (toolCall !== undefined) {
        response.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${index}`,
            object: 'chat.completion.chunk',
            created: index,
            model: 'test-model',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: toolCall.id,
                      type: 'function',
                      function: {
                        name: toolCall.name,
                        arguments: JSON.stringify(toolCall.input),
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
            id: `chatcmpl-${index}`,
            object: 'chat.completion.chunk',
            created: index,
            model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}\n\n`,
        );
      } else {
        response.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${index}`,
            object: 'chat.completion.chunk',
            created: index,
            model: 'test-model',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: `${expectedSkill} loaded.`,
                },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${index}`,
            object: 'chat.completion.chunk',
            created: index,
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

describe('music style skills Strands tool loop', () => {
  for (const skillName of MUSIC_STYLE_SKILL_NAMES) {
    it(`exposes, activates, and reads ${skillName} progressively`, async () => {
      const fake = await startFakeOpenAi(skillName);
      const agent = new Agent({
        model: createOpenAiChatModel({
          id: `style-${skillName}-test`,
          endpoint: fake.endpoint,
          apiKey: 'test-key',
          model: 'test-model',
        }),
        plugins: [createMusicStyleSkillsPlugin()],
        tools: [createMusicStyleReferenceTool()],
        printer: false,
      });

      const toolNames: string[] = [];
      for await (const event of agent.stream(
        `Arrange this idea as ${skillName}.`,
      )) {
        if (
          typeof event === 'object' &&
          event !== null &&
          'type' in event &&
          event.type === 'afterToolCallEvent' &&
          'toolUse' in event &&
          typeof event.toolUse === 'object' &&
          event.toolUse !== null &&
          'name' in event.toolUse &&
          typeof event.toolUse.name === 'string'
        ) {
          toolNames.push(event.toolUse.name);
        }
      }

      expect(toolNames).toEqual(['skills', 'music_style_reference']);
      expect(fake.requests).toHaveLength(3);

      const firstRequest = JSON.stringify(fake.requests[0]);
      for (const availableSkill of MUSIC_STYLE_SKILL_NAMES) {
        expect(firstRequest).toContain(`<name>${availableSkill}</name>`);
      }
      expect(firstRequest).toContain('"name":"skills"');
      expect(firstRequest).toContain('"name":"music_style_reference"');

      const secondRequest = JSON.stringify(fake.requests[1]);
      expect(secondRequest).toContain(`call-skill-${skillName}`);
      expect(secondRequest).toContain('style-guide.md');

      const thirdRequest = JSON.stringify(fake.requests[2]);
      expect(thirdRequest).toContain(`call-reference-${skillName}`);
      expect(thirdRequest).toContain('Aesthetic center');
    });
  }
});
