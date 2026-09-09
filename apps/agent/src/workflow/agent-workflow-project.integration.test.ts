import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  TRACK_IDS,
  type AgentEvent,
  type AgentExecutionId,
  type AgentSessionId,
  type CandidateId,
  type TaskId,
} from '@agent-music/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { CandidateCleanupManager } from '../../../workstation/src/core/candidate/candidate-cleanup.js';
import { CandidateGitRepository } from '../../../workstation/src/core/candidate/candidate-repository.js';
import { CandidateTransaction } from '../../../workstation/src/core/candidate/candidate-transaction.js';
import { CompositionPipeline } from '../../../workstation/src/core/composition/index.js';
import { MusicCoreMcpHttpServer } from '../../../workstation/src/core/mcp/music-core-mcp-server.js';
import { MusicCoreToolHost } from '../../../workstation/src/core/mcp/music-core-tool-host.js';
import { ProjectFoundation } from '../../../workstation/src/core/project/project-foundation.js';
import { createTemporaryDirectory } from '../../../workstation/src/core/project/test-support.js';
import { StrandsTaskBootstrapper } from '../mcp/task-bootstrapper.js';
import { StrandsAgentRuntimeFactory } from '../runtime/strands-agent-factory.js';
import { AgentWorkflow } from './agent-workflow.js';

const execFileAsync = promisify(execFile);
const candidateId = '70000000-0000-4000-8000-000000000001' as CandidateId;
const firstTaskId = '70000000-0000-4000-8000-000000000002' as TaskId;
const secondTaskId = '70000000-0000-4000-8000-000000000003' as TaskId;
const thirdTaskId = '70000000-0000-4000-8000-000000000004' as TaskId;
const executionId = '70000000-0000-4000-8000-000000000010' as AgentExecutionId;
const firstSessionId = '70000000-0000-4000-8000-000000000011' as AgentSessionId;
const secondSessionId =
  '70000000-0000-4000-8000-000000000012' as AgentSessionId;

interface ToolCallTurn {
  readonly toolCall: {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
}

interface TextTurn {
  readonly text: string;
}

type ModelTurn = ToolCallTurn | TextTurn;

const fakeServers: ReturnType<typeof createServer>[] = [];
const mcpServers: MusicCoreMcpHttpServer[] = [];
const tempDirectories: string[] = [];
const foundations: ProjectFoundation[] = [];

const git = async (path: string, ...args: string[]): Promise<string> =>
  (
    await execFileAsync('git', ['-C', path, ...args], {
      encoding: 'utf8',
      windowsHide: true,
    })
  ).stdout.trim();

const startFakeOpenAi = async (turns: readonly ModelTurn[]) => {
  const requests: unknown[] = [];
  let index = 0;
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      raw += chunk;
    });
    request.on('end', () => {
      requests.push(JSON.parse(raw) as unknown);
      const turn = turns[index];
      index += 1;
      if (turn === undefined) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: {
              message: 'Unexpected model call',
              type: 'invalid_request',
            },
          }),
        );
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      if ('toolCall' in turn) {
        response.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${String(index)}`,
            object: 'chat.completion.chunk',
            created: index,
            model: 'project-test-model',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: `call-${String(index)}`,
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
          })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${String(index)}`,
            object: 'chat.completion.chunk',
            created: index,
            model: 'project-test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}\n\n`,
        );
      } else {
        response.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${String(index)}`,
            object: 'chat.completion.chunk',
            created: index,
            model: 'project-test-model',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: turn.text },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${String(index)}`,
            object: 'chat.completion.chunk',
            created: index,
            model: 'project-test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}\n\n`,
        );
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

const makeStorageRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'project-workflow-session-'));
  tempDirectories.push(directory);
  return directory;
};

const runWorkflow = async (
  workflow: AgentWorkflow,
  input: Parameters<AgentWorkflow['startExecution']>[0],
): Promise<readonly AgentEvent[]> => {
  const events: AgentEvent[] = [];
  let resolveTerminal: (() => void) | undefined;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  workflow.startExecution(input, (event) => {
    events.push(event);
    if (event.type !== 'agent.textDelta') {
      resolveTerminal?.();
    }
  });
  await terminal;
  return events;
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
    foundations.splice(0).map((foundation) => foundation.closeProject()),
  );
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AgentWorkflow full project acceptance', { concurrent: false }, () => {
  it('runs first generation and a confirmed local edit through real MCP/A3/A2/Git while Current stays unchanged', async () => {
    const parent = await createTemporaryDirectory('agent-project-e2e-');
    tempDirectories.push(parent);
    const projectPath = join(parent, 'Agent 整路径工程');
    const foundation = new ProjectFoundation();
    foundations.push(foundation);
    const opened = await foundation.createProject(projectPath);
    const initialMain = opened.currentRevision;
    const initialCurrentAbc = await readFile(
      join(projectPath, 'composition.abc'),
      'utf8',
    );
    const repository = new CandidateGitRepository();
    const transaction = new CandidateTransaction({
      project: foundation,
      composition: new CompositionPipeline(),
      repository,
      cleanup: new CandidateCleanupManager(repository),
      createId: (() => {
        const ids = [candidateId, firstTaskId, secondTaskId, thirdTaskId];
        return () => ids.shift() ?? '70000000-0000-4000-8000-000000000099';
      })(),
      now: () => '2026-09-09T00:00:00.000Z',
    });
    const toolHost = new MusicCoreToolHost({
      agent: transaction,
      control: transaction,
      confirmation: { request: () => Promise.resolve('approved') },
    });
    const runtimeDirectory = await makeStorageRoot();
    const mcpServer = new MusicCoreMcpHttpServer({
      projectId: opened.projectId,
      runtimeDirectory,
      toolHost,
      createToken: () => 'project-e2e-token',
    });
    mcpServers.push(mcpServer);
    const descriptor = await mcpServer.start();
    const fake = await startFakeOpenAi([
      {
        toolCall: {
          name: 'submitGenerationPlan',
          arguments: {
            projectId: opened.projectId,
            summary: 'Create a one-bar drum note.',
            scope: { type: 'wholeProject', trackIds: TRACK_IDS },
          },
        },
      },
      {
        toolCall: {
          name: 'replaceScopedMusic',
          arguments: {
            envelope: {
              taskId: firstTaskId,
              projectId: opened.projectId,
              candidateId,
              baseRevision: initialMain,
              expectedScopeRevision: 0,
            },
            replacements: [{ trackId: 'track.drums', abc: 'C4' }],
          },
        },
      },
      {
        toolCall: {
          name: 'finishTask',
          arguments: {
            taskId: firstTaskId,
            projectId: opened.projectId,
            candidateId,
            baseRevision: initialMain,
            expectedScopeRevision: 0,
          },
        },
      },
      { text: 'Candidate generated.' },
    ]);
    const settings = {
      getActiveModelConfig: () =>
        Promise.resolve({
          id: 'project-e2e',
          endpoint: fake.endpoint,
          apiKey: 'project-e2e-key',
          model: 'project-test-model',
        }),
      getMaxRepairAttempts: () => Promise.resolve(2),
    };
    const descriptors = { read: () => Promise.resolve(descriptor) };
    const workflow = new AgentWorkflow({
      runtimeFactory: new StrandsAgentRuntimeFactory({
        settings,
        descriptors,
        storageRoot: await makeStorageRoot(),
      }),
      taskBootstrap: new StrandsTaskBootstrapper(descriptors),
      rollback: transaction,
      settings,
      createExecutionId: () => executionId,
    });

    const firstEvents = await runWorkflow(workflow, {
      projectId: opened.projectId,
      sessionId: firstSessionId,
      text: 'Create a one-bar idea.',
    });

    const worktreePath = join(
      projectPath,
      '.agent-music',
      'worktrees',
      candidateId,
    );
    const firstCandidateAbc = await readFile(
      join(worktreePath, 'composition.abc'),
      'utf8',
    );
    const firstCheckpoint = await git(worktreePath, 'rev-parse', 'HEAD');
    expect(firstEvents.at(-1)?.type).toBe('agent.executionCompleted');
    expect(firstCandidateAbc).toContain('[V:track.drums] C4 |');
    expect(firstCheckpoint).not.toBe(initialMain);
    expect(await git(projectPath, 'rev-parse', 'main')).toBe(initialMain);
    expect(await readFile(join(projectPath, 'composition.abc'), 'utf8')).toBe(
      initialCurrentAbc,
    );
    await expect(transaction.getTaskContext(firstTaskId)).rejects.toMatchObject(
      {
        code: 'TASK_NOT_ACTIVE',
      },
    );

    const secondTask = await transaction.startTask({
      projectId: opened.projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    expect(secondTask.taskId).toBe(secondTaskId);
    const secondFake = await startFakeOpenAi([
      {
        toolCall: {
          name: 'replaceScopedMusic',
          arguments: {
            envelope: {
              taskId: secondTaskId,
              projectId: opened.projectId,
              candidateId,
              baseRevision: initialMain,
              expectedScopeRevision: 0,
            },
            replacements: [{ trackId: 'track.drums', abc: 'D4' }],
          },
        },
      },
      {
        toolCall: {
          name: 'finishTask',
          arguments: {
            taskId: secondTaskId,
            projectId: opened.projectId,
            candidateId,
            baseRevision: initialMain,
            expectedScopeRevision: 0,
          },
        },
      },
      { text: 'Local edit finished.' },
    ]);
    const secondSettings = {
      getActiveModelConfig: () =>
        Promise.resolve({
          id: 'project-e2e-local',
          endpoint: secondFake.endpoint,
          apiKey: 'project-e2e-local-key',
          model: 'project-test-model',
        }),
      getMaxRepairAttempts: () => Promise.resolve(2),
    };
    const secondWorkflow = new AgentWorkflow({
      runtimeFactory: new StrandsAgentRuntimeFactory({
        settings: secondSettings,
        descriptors,
        storageRoot: await makeStorageRoot(),
      }),
      taskBootstrap: new StrandsTaskBootstrapper(descriptors),
      rollback: transaction,
      settings: secondSettings,
      createExecutionId: () => executionId,
    });
    const secondEvents = await runWorkflow(secondWorkflow, {
      projectId: opened.projectId,
      sessionId: secondSessionId,
      task: { taskId: secondTaskId, candidateId },
      text: 'Change the confirmed drum part.',
    });

    const secondCandidateAbc = await readFile(
      join(worktreePath, 'composition.abc'),
      'utf8',
    );
    const secondCheckpoint = await git(worktreePath, 'rev-parse', 'HEAD');
    expect(secondEvents.at(-1)?.type).toBe('agent.executionCompleted');
    expect(secondCandidateAbc).toContain('[V:track.drums] D4 |');
    expect(secondCheckpoint).not.toBe(firstCheckpoint);
    expect(await git(projectPath, 'rev-parse', 'main')).toBe(initialMain);
    expect(await readFile(join(projectPath, 'composition.abc'), 'utf8')).toBe(
      initialCurrentAbc,
    );
    expect(JSON.stringify(secondFake.requests[0])).toContain(
      `baseRevision: ${initialMain}`,
    );
    expect(JSON.stringify(secondFake.requests[0])).toContain(
      'expectedScopeRevision: 0',
    );

    const thirdTask = await transaction.startTask({
      projectId: opened.projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    expect(thirdTask.taskId).toBe(thirdTaskId);
    const thirdFake = await startFakeOpenAi([
      {
        toolCall: {
          name: 'replaceScopedMusic',
          arguments: {
            envelope: {
              taskId: thirdTaskId,
              projectId: opened.projectId,
              candidateId,
              baseRevision: initialMain,
              expectedScopeRevision: 0,
            },
            replacements: [{ trackId: 'track.drums', abc: 'E4' }],
          },
        },
      },
    ]);
    const thirdSettings = {
      getActiveModelConfig: () =>
        Promise.resolve({
          id: 'project-e2e-failure',
          endpoint: thirdFake.endpoint,
          apiKey: 'project-e2e-failure-key',
          model: 'project-test-model',
        }),
      getMaxRepairAttempts: () => Promise.resolve(2),
    };
    const thirdWorkflow = new AgentWorkflow({
      runtimeFactory: new StrandsAgentRuntimeFactory({
        settings: thirdSettings,
        descriptors,
        storageRoot: await makeStorageRoot(),
      }),
      taskBootstrap: new StrandsTaskBootstrapper(descriptors),
      rollback: transaction,
      settings: thirdSettings,
      createExecutionId: () => executionId,
    });
    const thirdEvents = await runWorkflow(thirdWorkflow, {
      projectId: opened.projectId,
      sessionId: '70000000-0000-4000-8000-000000000013' as AgentSessionId,
      task: { taskId: thirdTaskId, candidateId },
      text: 'Make one more confirmed drum change.',
    });

    const rolledBackAbc = await readFile(
      join(worktreePath, 'composition.abc'),
      'utf8',
    );
    expect(thirdEvents.at(-1)).toMatchObject({
      type: 'agent.executionFailed',
      code: 'AGENT_EXECUTION_FAILED',
    });
    expect(rolledBackAbc).toBe(secondCandidateAbc);
    expect(rolledBackAbc).toContain('[V:track.drums] D4 |');
    expect(rolledBackAbc).not.toContain('[V:track.drums] E4 |');
    expect(await git(worktreePath, 'rev-parse', 'HEAD')).toBe(secondCheckpoint);
    expect(await git(projectPath, 'rev-parse', 'main')).toBe(initialMain);
    await expect(transaction.getTaskContext(thirdTaskId)).rejects.toMatchObject(
      {
        code: 'TASK_NOT_ACTIVE',
      },
    );
  });
});
