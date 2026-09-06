import { ProjectFoundation, ProjectIpcHandler } from './index.js';
import {
  isProjectCommand,
  type CoreProjectRequest,
  type CoreProjectResponse,
} from '../../shared/project-bridge.js';
import {
  isMainToServiceMessage,
  type ServiceKind,
} from '../../shared/service-lifecycle.js';

const service: ServiceKind = 'core';
const handler = new ProjectIpcHandler(new ProjectFoundation());
let commandQueue = Promise.resolve();

const send = (message: unknown): void => {
  process.parentPort?.postMessage(message);
  process.send?.(message);
};

send({ type: 'ready', protocolVersion: 1, service });

const unwrapMessage = (message: unknown): unknown =>
  typeof message === 'object' && message !== null && 'data' in message
    ? (message as { readonly data: unknown }).data
    : message;

const handle = async (message: unknown): Promise<void> => {
  message = unwrapMessage(message);
  if (isMainToServiceMessage(message)) {
    if (message.type === 'healthCheck') {
      send({
        type: 'healthResult',
        protocolVersion: 1,
        requestId: message.requestId,
      });
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
    }
    if (message.type !== 'projectCommand') return;
  }

  const request = message as CoreProjectRequest;
  if (request?.type !== 'projectCommand' || !isProjectCommand(request.command))
    return;
  commandQueue = commandQueue
    .then(async () => {
      const event = await handler.handle(request.command);
      send({
        type: 'projectEvent',
        protocolVersion: 1,
        event,
      } satisfies CoreProjectResponse);
    })
    .catch(() => undefined);
  await commandQueue;
};

process.on('message', (message: unknown) => void handle(message));
process.parentPort?.on('message', (message: unknown) => void handle(message));
