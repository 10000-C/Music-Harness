import {
  isMainToServiceMessage,
  type ServiceKind,
} from '../shared/service-lifecycle.js';

const service = process.argv[2] as ServiceKind;
const send = (message: unknown): void => {
  process.send?.(message);
};
send({ type: 'ready', protocolVersion: 1, service });
process.on('message', (message: unknown) => {
  if (!isMainToServiceMessage(message)) return;
  if (message.type === 'healthCheck')
    send({
      type: 'healthResult',
      protocolVersion: 1,
      requestId: message.requestId,
    });
  if (message.type === 'shutdown') {
    send({
      type: 'shutdownComplete',
      protocolVersion: 1,
      requestId: message.requestId,
    });
    process.exit(0);
  }
});
