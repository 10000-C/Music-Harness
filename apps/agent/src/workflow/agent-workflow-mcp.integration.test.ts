import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TRACK_IDS,
  type AgentEvent,
  type AgentExecutionId,
  type AgentSessionId,
  type CandidateId,
  type ProjectId,
  type TaskContextView,
  type TaskId,
} from '@agent-music/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MusicCoreMcpHttpServer } from '../../../workstation/src/core/mcp/music-core-mcp-server.js';
import { P0_MCP_TOOL_NAMES } from '../../../workstation/src/core/mcp/music-core-tool-host.js';
import { StrandsTaskBootstrapper } from '../mcp/task-bootstrapper.js';
import { StrandsAgentRuntimeFactory } from '../runtime/strands-agent-factory.js';
import { AgentWorkflow } from './agent-workflow.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const sessionId = '22222222-2222-4222-8222-222222222222' as AgentSessionId;
const executionId = '33333333-3333-4333-8333-333333333333' as AgentExecutionId;
const candidateId = '44444444-4444-4444-8444-444444444444' as CandidateId;
const taskId = '55555555-5555-4555-8555-555555555555' as TaskId;
const baseRevision = 'abc123';

const task: TaskContextView = {
  taskId,
  projectId,
  candidateId,
  baseRevision,
  scope: { type: 'wholeProject', trackIds: TRACK_IDS },
  scopeRevision: 0,
  state: 'editing',
  candidateState: 'active',
  allowedOperations: ['replaceScopedMusic', 'updateMusicalProperties'],
  trackIds: TRACK_IDS,
  createdAt: '2026-09-09T00:00:00.000Z',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const modelToolNames = (request: unknown): readonly string[] => {
  if (!isRecord(request) || !Array.isArray(request.tools)) {
    return [];
  }
  const names: string[] = [];
  for (const tool of request.tools) {
    if (!isRecord(tool) || !isRecord(tool.function)) {
      continue;
    }
    const name = tool.function.name;
    if (typeof name === 'string') {
      names.push(name);
    }
  }
  return names;
};

const fakeServers: ReturnType<typeof createServer>[] = [];
const mcpServers: MusicCoreMcpHttpServer[] = [];
const tempDirectories: string[] = [];

interface ToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

type FakeModelTurn =
  { readonly toolCall: ToolCall } | { readonly text: string };

const writeChunk = (
  response: Parameters<ReturnType<typeof createServer>['emit']>[1] & {
    write(chunk: string): boolean;
  },
  body: unknown,
): void => {
  response.write(`data: ${JSON.stringify(body)}\n\n`);
};

const startFakeOpenAi = async (turns: readonly FakeModelTurn[]) => {
  const requests: unknown[] = [];
  let turnIndex = 0;
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      raw += chunk;
    });
    request.on('end', () => {
      requests.push(JSON.parse(raw) as unknown);
      const turn = turns[turnIndex];
      turnIndex += 1;
      if (turn === undefined) {
        response.writeHead(500).end('unexpected model call');
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      if ('toolCall' in turn) {
        writeChunk(response as never, {
          id: `chatcmpl-${String(turnIndex)}`,
          object: 'chat.completion.chunk',
          created: turnIndex,
          model: 'workflow-test-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${String(turnIndex)}`,
                    type: 'function',
                    function: {
                      name: turn.toolCall.name,
                      arguments: JSON.stringify(turn.toolCall.arguments),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        writeChunk(response as never, {
          id: `chatcmpl-${String(turnIndex)}`,
          object: 'chat.completion.chunk',
          created: turnIndex,
          model: 'workflow-test-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      } else {
        writeChunk(response as never, {
          id: `chatcmpl-${String(turnIndex)}`,
          object: 'chat.completion.chunk',
          created: turnIndex,
          model: 'workflow-test-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: turn.text },
              finish_reason: null,
            },
          ],
        });
        writeChunk(response as never, {
          id: `chatcmpl-${String(turnIndex)}`,
          object: 'chat.completion.chunk',
          created: turnIndex,
          model: 'workflow-test-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      response.end('data: [DONE]\n\n');
    });
  });
  fakeServers.push(server);
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

const makeTempDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'workflow-mcp-'));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(mcpServers.splice(0).map((server) => server.stop()));
  await Promise.all(
    fakeServers.splice(0).map(
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

describe('AgentWorkflow + real Strands + MCP', () => {
  it('reaches submitGenerationPlan and finishTask through real afterToolCallEvent values', async () => {
    const fake = await startFakeOpenAi([
      {
        toolCall: {
          name: 'submitGenerationPlan',
          arguments: {
            summary: 'Generate one bar.',
            scope: { type: 'wholeProject', trackIds: TRACK_IDS },
          },
        },
      },
      {
        toolCall: {
          name: 'finishTask',
          arguments: {
            taskId,
            projectId,
            candidateId,
            baseRevision,
            expectedScopeRevision: 0,
          },
        },
      },
      { text: 'Candidate is ready.' },
    ]);
    const toolCalls: string[] = [];
    const mcpServer = new MusicCoreMcpHttpServer({
      projectId,
      runtimeDirectory: await makeTempDirectory(),
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: (name) => {
          toolCalls.push(name);
          if (name === 'submitGenerationPlan') {
            return Promise.resolve({ approved: true, task });
          }
          if (name === 'finishTask') {
            return Promise.resolve({
              candidate: {
                candidateId,
                projectId,
                baseRevision,
                state: 'ready',
              },
              validation: { valid: true, issues: [] },
            });
          }
          return Promise.resolve(task);
        },
      },
      createToken: () => 'workflow-mcp-token',
    });
    mcpServers.push(mcpServer);
    const descriptor = await mcpServer.start();
    const storageRoot = await makeTempDirectory();
    const settings = {
      getActiveModelConfig: () =>
        Promise.resolve({
          id: 'workflow-test',
          endpoint: fake.endpoint,
          apiKey: 'workflow-test-key',
          model: 'workflow-test-model',
        }),
      getMaxRepairAttempts: () => Promise.resolve(2),
    };
    const descriptors = { read: () => Promise.resolve(descriptor) };
    const workflow = new AgentWorkflow({
      runtimeFactory: new StrandsAgentRuntimeFactory({
        settings,
        descriptors,
        storageRoot,
      }),
      taskBootstrap: new StrandsTaskBootstrapper(descriptors),
      rollback: { cancelTask: vi.fn().mockResolvedValue(undefined) },
      settings,
      createExecutionId: () => executionId,
    });
    const events: AgentEvent[] = [];
    let resolveTerminal: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });

    workflow.startExecution(
      { projectId, sessionId, text: 'Create a one-bar idea.' },
      (event) => {
        events.push(event);
        if (event.type !== 'agent.textDelta') {
          resolveTerminal?.();
        }
      },
    );
    await terminal;

    expect(toolCalls).toEqual(['submitGenerationPlan', 'finishTask']);
    expect(fake.requests).toHaveLength(3);
    expect(events).toContainEqual({
      type: 'agent.textDelta',
      projectId,
      sessionId,
      executionId,
      text: 'Candidate is ready.',
    });
    expect(events.at(-1)).toEqual({
      type: 'agent.executionCompleted',
      projectId,
      sessionId,
      executionId,
    });
  });
  it('mechanically bootstraps a confirmed Task through MCP before the first model call', async () => {
    const fake = await startFakeOpenAi([
      {
        toolCall: {
          name: 'finishTask',
          arguments: {
            taskId,
            projectId,
            candidateId,
            baseRevision,
            expectedScopeRevision: 0,
          },
        },
      },
      { text: 'Confirmed Task finished.' },
    ]);
    const toolCalls: string[] = [];
    const mcpServer = new MusicCoreMcpHttpServer({
      projectId,
      runtimeDirectory: await makeTempDirectory(),
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: (name) => {
          toolCalls.push(name);
          if (name === 'getTaskContext') {
            return Promise.resolve(task);
          }
          if (name === 'finishTask') {
            return Promise.resolve({
              candidate: {
                candidateId,
                projectId,
                baseRevision,
                state: 'ready',
              },
              validation: { valid: true, issues: [] },
            });
          }
          return Promise.resolve({ ok: true });
        },
      },
      createToken: () => 'workflow-bootstrap-token',
    });
    mcpServers.push(mcpServer);
    const descriptor = await mcpServer.start();
    const storageRoot = await makeTempDirectory();
    const settings = {
      getActiveModelConfig: () =>
        Promise.resolve({
          id: 'workflow-bootstrap-test',
          endpoint: fake.endpoint,
          apiKey: 'workflow-bootstrap-key',
          model: 'workflow-test-model',
        }),
      getMaxRepairAttempts: () => Promise.resolve(2),
    };
    const descriptors = { read: () => Promise.resolve(descriptor) };
    const workflow = new AgentWorkflow({
      runtimeFactory: new StrandsAgentRuntimeFactory({
        settings,
        descriptors,
        storageRoot,
      }),
      taskBootstrap: new StrandsTaskBootstrapper(descriptors),
      rollback: { cancelTask: vi.fn().mockResolvedValue(undefined) },
      settings,
      createExecutionId: () => executionId,
    });
    const events: AgentEvent[] = [];
    let resolveTerminal: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });

    workflow.startExecution(
      {
        projectId,
        sessionId,
        task: { taskId, candidateId },
        text: 'Finish the confirmed local edit.',
      },
      (event) => {
        events.push(event);
        if (event.type !== 'agent.textDelta') {
          resolveTerminal?.();
        }
      },
    );
    await terminal;

    expect(toolCalls).toEqual(['getTaskContext', 'finishTask']);
    expect(fake.requests).toHaveLength(2);
    const firstModelRequest = JSON.stringify(fake.requests[0]);
    expect(firstModelRequest).toContain(`baseRevision: ${baseRevision}`);
    expect(firstModelRequest).toContain('expectedScopeRevision: 0');
    expect(events.at(-1)?.type).toBe('agent.executionCompleted');
  });

  it('enters repair from a real finishTask result and removes Scope Extension from repair tools', async () => {
    const fake = await startFakeOpenAi([
      {
        toolCall: {
          name: 'finishTask',
          arguments: {
            taskId,
            projectId,
            candidateId,
            baseRevision,
            expectedScopeRevision: 0,
          },
        },
      },
      {
        toolCall: {
          name: 'finishTask',
          arguments: {
            taskId,
            projectId,
            candidateId,
            baseRevision,
            expectedScopeRevision: 0,
          },
        },
      },
      { text: 'Repair succeeded.' },
    ]);
    const toolCalls: string[] = [];
    let finishCount = 0;
    const mcpServer = new MusicCoreMcpHttpServer({
      projectId,
      runtimeDirectory: await makeTempDirectory(),
      toolHost: {
        listTools: () => P0_MCP_TOOL_NAMES,
        call: (name) => {
          toolCalls.push(name);
          if (name === 'getTaskContext') {
            return Promise.resolve(task);
          }
          if (name === 'finishTask') {
            finishCount += 1;
            return Promise.resolve({
              candidate: {
                candidateId,
                projectId,
                baseRevision,
                state: finishCount === 1 ? 'active' : 'ready',
              },
              validation:
                finishCount === 1
                  ? {
                      valid: false,
                      issues: [
                        { code: 'METER_MISMATCH', message: 'Repair the bar.' },
                      ],
                    }
                  : { valid: true, issues: [] },
            });
          }
          return Promise.resolve({ ok: true });
        },
      },
      createToken: () => 'workflow-repair-token',
    });
    mcpServers.push(mcpServer);
    const descriptor = await mcpServer.start();
    const storageRoot = await makeTempDirectory();
    const settings = {
      getActiveModelConfig: () =>
        Promise.resolve({
          id: 'workflow-repair-test',
          endpoint: fake.endpoint,
          apiKey: 'workflow-repair-key',
          model: 'workflow-test-model',
        }),
      getMaxRepairAttempts: () => Promise.resolve(2),
    };
    const descriptors = { read: () => Promise.resolve(descriptor) };
    const rollback = vi.fn().mockResolvedValue(undefined);
    const workflow = new AgentWorkflow({
      runtimeFactory: new StrandsAgentRuntimeFactory({
        settings,
        descriptors,
        storageRoot,
      }),
      taskBootstrap: new StrandsTaskBootstrapper(descriptors),
      rollback: { cancelTask: rollback },
      settings,
      createExecutionId: () => executionId,
    });
    const events: AgentEvent[] = [];
    let resolveTerminal: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });

    workflow.startExecution(
      {
        projectId,
        sessionId,
        task: { taskId, candidateId },
        text: 'Validate this confirmed edit.',
      },
      (event) => {
        events.push(event);
        if (event.type !== 'agent.textDelta') {
          resolveTerminal?.();
        }
      },
    );
    await terminal;

    expect(toolCalls).toEqual([
      'getTaskContext',
      'finishTask',
      'getTaskContext',
      'finishTask',
    ]);
    expect(fake.requests).toHaveLength(3);
    const repairTools = modelToolNames(fake.requests[1]);
    expect(repairTools).not.toContain('requestScopeExtension');
    expect(repairTools).toContain('finishTask');
    expect(JSON.stringify(fake.requests[1])).toContain('Repair the bar.');
    expect(rollback).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('agent.executionCompleted');
  });
});
