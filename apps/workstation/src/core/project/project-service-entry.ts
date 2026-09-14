import {
  CurrentPlaybackReader,
  ProjectFoundation,
  ProjectIpcHandler,
} from './index.js';
import {
  CandidateCleanupManager,
  CandidateGitRepository,
  CandidateIpcHandler,
  CandidateTransaction,
} from '../candidate/index.js';
import { CompositionPipeline } from '../composition/index.js';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type CoreProjectRequest,
  type CoreProjectResponse,
} from '../../shared/project-bridge.js';
import {
  type CoreCandidateRequest,
  type CoreCandidateResponse,
} from '../../shared/candidate-bridge.js';
import {
  isMainToServiceMessage,
  type ServiceKind,
} from '../../shared/service-lifecycle.js';
import type {
  CorePlaybackResponse,
  CorePlaybackSnapshotResponse,
} from '../../shared/playback-bridge.js';
import { currentPlaybackFailure } from './current-playback-response.js';
import { createAutoApproveConfirmation } from '../mcp/auto-approve-confirmation.js';
import { MusicCoreMcpHttpServer } from '../mcp/music-core-mcp-server.js';
import { MusicCoreToolHost } from '../mcp/music-core-tool-host.js';

const service: ServiceKind = 'core';
const foundation = new ProjectFoundation();
const handler = new ProjectIpcHandler(foundation);
const playback = new CurrentPlaybackReader(foundation);
const candidateRepository = new CandidateGitRepository();
const candidateTransaction = new CandidateTransaction({
  project: foundation,
  composition: new CompositionPipeline(),
  repository: candidateRepository,
  cleanup: new CandidateCleanupManager(candidateRepository),
  createId: randomUUID,
  now: () => new Date().toISOString(),
});
const candidateHandler = new CandidateIpcHandler(candidateTransaction);

/**
 * Shared user-level Agent Music home. The Agent process resolves the same
 * root (settings, session storage, runtime descriptor discovery), so both
 * sides must agree on the override and the default.
 */
const agentMusicHome =
  process.env.AGENT_MUSIC_HOME ?? join(homedir(), '.agent-music');

const confirmation = createAutoApproveConfirmation();
const toolHost = new MusicCoreToolHost({
  agent: candidateTransaction,
  control: candidateTransaction,
  generationPlanConfirmation: confirmation.generationPlan,
  scopeExtensionConfirmation: confirmation.scopeExtension,
});
const mcpServer = new MusicCoreMcpHttpServer({
  resolveProjectId: () => foundation.getProjectId(),
  runtimeDirectory: join(agentMusicHome, 'runtime'),
  toolHost,
  control: candidateTransaction,
});

let commandQueue = Promise.resolve();
const utilityParentPort = (
  process as unknown as {
    readonly parentPort?: {
      postMessage(message: unknown): void;
      on(event: 'message', listener: (message: unknown) => void): void;
    };
  }
).parentPort;

const send = (message: unknown): void => {
  utilityParentPort?.postMessage(message);
  process.send?.(message);
};

const failFatal = (code: string, message: string): void => {
  send({ type: 'fatal', protocolVersion: 1, service, code, message });
};

const stopMcpServer = async (): Promise<void> => {
  try {
    await mcpServer.stop();
  } catch (error: unknown) {
    send({
      type: 'fatal',
      protocolVersion: 1,
      service,
      code: 'MCP_SERVER_STOP_FAILED',
      message:
        error instanceof Error ? error.message : 'MCP server cleanup failed',
    });
  }
};

process.on('message', (message: unknown) => void handle(message));
utilityParentPort?.on('message', (message: unknown) => void handle(message));

// The MCP server is Core-process-scoped: it starts before any Project is
// open and stays alive across Project close/open. Core only reports ready
// to the supervisor once the descriptor is published, so the Agent can
// never observe a ready Core without a connectable endpoint.
void mcpServer
  .start()
  .then(() => {
    send({ type: 'ready', protocolVersion: 1, service });
  })
  .catch((error: unknown) => {
    failFatal(
      'MCP_SERVER_START_FAILED',
      error instanceof Error ? error.message : 'MCP server failed to start',
    );
    process.exitCode = 1;
    process.exit(1);
  });

const unwrapMessage = (message: unknown): unknown =>
  typeof message === 'object' && message !== null && 'data' in message
    ? (message as { readonly data: unknown }).data
    : message;

const enqueue = async (
  command: CoreProjectRequest['command'],
): Promise<void> => {
  commandQueue = commandQueue
    .then(async () => {
      const event = await handler.handle(command);
      send({
        type: 'projectEvent',
        protocolVersion: 1,
        event,
      } satisfies CoreProjectResponse);
    })
    .catch(() => undefined);
  await commandQueue;
};

const enqueueCandidate = async (
  command: CoreCandidateRequest['command'],
): Promise<void> => {
  commandQueue = commandQueue
    .then(async () => {
      const events = await candidateHandler.handle(command);
      send({
        type: 'candidateEvents',
        protocolVersion: 1,
        requestId: command.requestId,
        events,
      } satisfies CoreCandidateResponse);
    })
    .catch(() => undefined);
  await commandQueue;
};

const handle = async (message: unknown): Promise<void> => {
  message = unwrapMessage(message);
  if (isMainToServiceMessage(message)) {
    if (message.type === 'healthCheck') {
      send({
        type: 'healthResult',
        protocolVersion: 1,
        requestId: message.requestId,
      });
      return;
    } else if (message.type === 'shutdown') {
      await commandQueue;
      await handler.handle({
        type: 'project.close',
        requestId: `shutdown-${message.requestId}`,
      });
      // Stop the MCP server last so the Agent process retains its rollback
      // control endpoint for as long as possible during its own shutdown.
      await stopMcpServer();
      send({
        type: 'shutdownComplete',
        protocolVersion: 1,
        requestId: message.requestId,
      });
      process.exit(0);
      return;
    } else if (message.type === 'playback.readCurrent') {
      try {
        const current = await playback.read();
        send({
          type: 'playback.current',
          protocolVersion: 1,
          requestId: message.requestId,
          ...current,
        } satisfies CorePlaybackResponse);
      } catch (error: unknown) {
        // Do not send partially compiled or stale authority data across this
        // boundary. The Renderer can show an actionable fail-safe state.
        send(currentPlaybackFailure(message.requestId, error));
      }
      return;
    } else if (message.type === 'playback.readSnapshot') {
      if (message.source.kind === 'current') {
        try {
          const current = await playback.read();
          send({
            type: 'playback.snapshot',
            protocolVersion: 1,
            requestId: message.requestId,
            projectId: message.projectId,
            source: message.source,
            revision: current.revision,
            compilation: current.compilation,
            timeline: current.timeline,
          } satisfies CorePlaybackSnapshotResponse);
        } catch (error: unknown) {
          send({
            type: 'playback.snapshotFailed',
            protocolVersion: 1,
            requestId: message.requestId,
            code: 'CURRENT_UNAVAILABLE',
            userMessage:
              error instanceof Error ? error.message : 'Unknown error',
          } satisfies CorePlaybackSnapshotResponse);
        }
      } else {
        send({
          type: 'playback.snapshotFailed',
          protocolVersion: 1,
          requestId: message.requestId,
          code: 'CANDIDATE_UNAVAILABLE',
          userMessage:
            'Candidate snapshot reading is not yet implemented in Core.',
        } satisfies CorePlaybackSnapshotResponse);
      }
      return;
    }
    if (message.type === 'candidateCommand') {
      await enqueueCandidate(message.command);
      return;
    }
    await enqueue(message.command);
    return;
  }
};
