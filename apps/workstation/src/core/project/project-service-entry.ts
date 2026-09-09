import {
  CurrentPlaybackReader,
  ProjectFoundation,
  ProjectIpcHandler,
} from './index.js';
import {
  type CoreProjectRequest,
  type CoreProjectResponse,
} from '../../shared/project-bridge.js';
import {
  isMainToServiceMessage,
  type ServiceKind,
} from '../../shared/service-lifecycle.js';
import type { CorePlaybackResponse } from '../../shared/playback-bridge.js';

const service: ServiceKind = 'core';
const foundation = new ProjectFoundation();
const handler = new ProjectIpcHandler(foundation);
const playback = new CurrentPlaybackReader(foundation);
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

send({ type: 'ready', protocolVersion: 1, service });

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
      } catch {
        // Do not send partially compiled or stale authority data across this
        // boundary. The Renderer can show an actionable fail-safe state.
        send({
          type: 'playback.failed',
          protocolVersion: 1,
          requestId: message.requestId,
          code: 'COMPILATION_FAILED',
          userMessage: 'Current could not be compiled for playback.',
        } satisfies CorePlaybackResponse);
      }
      return;
    }
    await enqueue(message.command);
    return;
  }
};

process.on('message', (message: unknown) => void handle(message));
utilityParentPort?.on('message', (message: unknown) => void handle(message));
