import type {
  MainToServiceMessage,
  ServiceKind,
} from '../../shared/service-lifecycle.js';
import type { AgentCommand, AgentProcessCommand } from '@agent-music/contracts';
import type { CoreCandidateStateRequest } from '../../shared/candidate-bridge.js';
import type { CorePlaybackSnapshotRequest } from '../../shared/playback-bridge.js';

/** Messages accepted by a managed Core or Agent process transport. */
export type ManagedProcessMessage =
  | MainToServiceMessage
  | CoreCandidateStateRequest
  | CorePlaybackSnapshotRequest
  | AgentProcessCommand
  | AgentCommand;

export interface ManagedProcess {
  readonly send: (message: ManagedProcessMessage) => void;
  readonly terminate: () => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
  readonly onExit: (listener: () => void) => () => void;
}

export interface ManagedProcessAdapter {
  spawn(service: ServiceKind): ManagedProcess;
}

interface ProcessLike {
  postMessage?(message: ManagedProcessMessage): void;
  send?(message: ManagedProcessMessage): void;
  kill(): void;
  on(event: 'message' | 'exit', listener: (value?: unknown) => void): void;
  off?(event: 'message' | 'exit', listener: (value?: unknown) => void): void;
}
type ProcessFactory = (service: ServiceKind) => ProcessLike;
const bridge = (factory: ProcessFactory): ManagedProcessAdapter => ({
  spawn(service) {
    const process = factory(service);
    return {
      send(message) {
        if (process.postMessage) process.postMessage(message);
        else process.send?.(message);
      },
      terminate() {
        process.kill();
      },
      onMessage(listener) {
        const wrapped = (message?: unknown): void => {
          listener(message);
        };
        process.on('message', wrapped);
        return () => process.off?.('message', wrapped);
      },
      onExit(listener) {
        const wrapped = (): void => {
          listener();
        };
        process.on('exit', wrapped);
        return () => process.off?.('exit', wrapped);
      },
    };
  },
});
/** Private production seam: the caller supplies Electron's utilityProcess.fork. */
export const createCoreUtilityProcessAdapter = (
  fork: ProcessFactory,
): ManagedProcessAdapter => bridge(fork);
/** Private production seam: the caller supplies child_process.fork. */
export const createAgentChildProcessAdapter = (
  fork: ProcessFactory,
): ManagedProcessAdapter => bridge(fork);
