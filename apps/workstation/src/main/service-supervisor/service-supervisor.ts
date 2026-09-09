import {
  isServiceToMainMessage,
  type MainToServiceMessage,
  type ServiceKind,
  type ServiceToMainMessage,
} from '../../shared/service-lifecycle.js';
import type {
  ManagedProcess,
  ManagedProcessAdapter,
} from './process-adapters.js';
import type {
  ServiceFleetSnapshot,
  ServiceState,
} from '../../shared/service-status.js';
import {
  isCoreProjectResponse,
  type CoreProjectRequest,
} from '../../shared/project-bridge.js';
import {
  isCorePlaybackResponse,
  type CorePlaybackRequest,
  type CorePlaybackResponse,
} from '../../shared/playback-bridge.js';
import type { ProjectEvent } from '@agent-music/contracts';

export type {
  ServiceFleetSnapshot,
  ServiceState,
} from '../../shared/service-status.js';

export interface ServiceSupervisor {
  start(): Promise<void>;
  restart(service: ServiceKind): Promise<void>;
  shutdown(reason: 'appQuit' | 'windowClosed'): Promise<void>;
  getSnapshot(): ServiceFleetSnapshot;
  subscribe(listener: (snapshot: ServiceFleetSnapshot) => void): () => void;
  dispatchProject(
    command: CoreProjectRequest['command'],
  ): Promise<ProjectEvent>;
  readCurrentPlayback(): Promise<CorePlaybackResponse>;
}

export interface SupervisorOptions {
  readonly readyTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly stableReadyMs?: number;
  readonly restartDelaysMs?: readonly number[];
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
}

const serviceKinds: readonly ServiceKind[] = ['core', 'agent'];
const defaultOptions = {
  readyTimeoutMs: 10_000,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 2_000,
  shutdownTimeoutMs: 3_000,
  stableReadyMs: 30_000,
  restartDelaysMs: [250, 1_000],
} as const;

const createSnapshot = (
  states: Record<ServiceKind, ServiceState>,
): ServiceFleetSnapshot =>
  Object.freeze({ core: states.core, agent: states.agent });

export const createServiceSupervisor = (
  adapter: ManagedProcessAdapter,
  options: SupervisorOptions = {},
): ServiceSupervisor => {
  const config = { ...defaultOptions, ...options };
  const schedule = config.setTimeout ?? setTimeout;
  const cancel = config.clearTimeout ?? clearTimeout;
  const states: Record<ServiceKind, ServiceState> = {
    core: 'stopped',
    agent: 'stopped',
  };
  const generations: Record<ServiceKind, number> = { core: 0, agent: 0 };
  const restartAttempts: Record<ServiceKind, number> = { core: 0, agent: 0 };
  const pendingHealth: Partial<Record<ServiceKind, string>> = {};
  const pendingShutdown: Partial<Record<ServiceKind, string>> = {};
  const processes = new Map<ServiceKind, ManagedProcess>();
  const subscriptions = new Map<ServiceKind, readonly (() => void)[]>();
  const timers = new Map<ServiceKind, ReturnType<typeof setTimeout>[]>();
  const stableTimers = new Map<ServiceKind, ReturnType<typeof setTimeout>>();
  const pendingProjects = new Map<
    string,
    {
      readonly generation: number;
      readonly resolve: (event: ProjectEvent) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingPlayback = new Map<
    string,
    {
      readonly generation: number;
      readonly resolve: (response: CorePlaybackResponse) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const listeners = new Set<(value: ServiceFleetSnapshot) => void>();
  let stopping = false;
  let requestSequence = 0;
  let shutdownPromise: Promise<void> | undefined;
  let finishShutdown: (() => void) | undefined;

  const emit = (): void => {
    const value = createSnapshot(states);
    listeners.forEach((listener) => {
      listener(value);
    });
  };

  const completeShutdownIfSettled = (): void => {
    if (
      stopping &&
      serviceKinds.every((service) => states[service] === 'stopped')
    ) {
      const finish = finishShutdown;
      finishShutdown = undefined;
      finish?.();
    }
  };

  const setState = (service: ServiceKind, state: ServiceState): void => {
    states[service] = state;
    emit();
    completeShutdownIfSettled();
  };

  const addTimer = (
    service: ServiceKind,
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout> => {
    const timer = schedule(callback, delay);
    timers.set(service, [...(timers.get(service) ?? []), timer]);
    return timer;
  };

  const clearTimers = (service: ServiceKind): void => {
    (timers.get(service) ?? []).forEach(cancel);
    timers.delete(service);
  };

  const clearStableTimer = (service: ServiceKind): void => {
    const timer = stableTimers.get(service);
    if (timer !== undefined) cancel(timer);
    stableTimers.delete(service);
  };

  const detachProcess = (service: ServiceKind): void => {
    const dispose = subscriptions.get(service);
    subscriptions.delete(service);
    dispose?.forEach((unsubscribe) => {
      unsubscribe();
    });
  };

  const terminate = (process: ManagedProcess | undefined): void => {
    try {
      process?.terminate();
    } catch {
      return;
    }
  };

  const invalidateGeneration = (
    service: ServiceKind,
    terminateProcess: boolean,
  ): void => {
    if (service === 'core') {
      for (const [requestId, pending] of pendingProjects) {
        if (pending.generation !== generations.core) continue;
        cancel(pending.timeout);
        pending.reject(new Error('The Music Core process restarted.'));
        pendingProjects.delete(requestId);
      }
      for (const [requestId, pending] of pendingPlayback) {
        if (pending.generation !== generations.core) continue;
        cancel(pending.timeout);
        pending.reject(new Error('The Music Core process restarted.'));
        pendingPlayback.delete(requestId);
      }
    }
    generations[service] += 1;
    clearTimers(service);
    clearStableTimer(service);
    Reflect.deleteProperty(pendingHealth, service);
    Reflect.deleteProperty(pendingShutdown, service);
    detachProcess(service);
    const process = processes.get(service);
    processes.delete(service);
    if (terminateProcess) terminate(process);
  };

  const finalizeStopped = (
    service: ServiceKind,
    generation: number,
    terminateProcess: boolean,
  ): void => {
    if (generations[service] !== generation) return;
    invalidateGeneration(service, terminateProcess);
    setState(service, 'stopped');
  };

  const scheduleStableReset = (
    service: ServiceKind,
    generation: number,
  ): void => {
    clearStableTimer(service);
    stableTimers.set(
      service,
      schedule(() => {
        if (
          generations[service] === generation &&
          states[service] === 'ready'
        ) {
          restartAttempts[service] = 0;
        }
      }, config.stableReadyMs),
    );
  };

  const launch = (service: ServiceKind): void => {
    if (stopping) return;
    clearTimers(service);
    clearStableTimer(service);
    Reflect.deleteProperty(pendingHealth, service);
    const generation = ++generations[service];
    setState(
      service,
      restartAttempts[service] === 0 ? 'starting' : 'restarting',
    );

    let process: ManagedProcess;
    try {
      process = adapter.spawn(service);
    } catch {
      fail(service, generation);
      return;
    }

    processes.set(service, process);
    const unsubscribeMessage = process.onMessage((message) => {
      handleMessage(service, generation, message);
    });
    const unsubscribeExit = process.onExit(() => {
      if (generations[service] !== generation) return;
      if (stopping) finalizeStopped(service, generation, false);
      else fail(service, generation);
    });
    subscriptions.set(service, [unsubscribeMessage, unsubscribeExit]);
    addTimer(
      service,
      () => {
        fail(service, generation);
      },
      config.readyTimeoutMs,
    );
  };

  const fail = (service: ServiceKind, generation: number): void => {
    if (stopping || generations[service] !== generation) return;
    invalidateGeneration(service, true);
    if (restartAttempts[service] >= config.restartDelaysMs.length) {
      setState(service, 'failed');
      return;
    }
    const delay = config.restartDelaysMs[restartAttempts[service]++] ?? 0;
    setState(service, 'restarting');
    addTimer(
      service,
      () => {
        launch(service);
      },
      delay,
    );
  };

  const heartbeat = (
    service: ServiceKind,
    generation: number,
    misses = 0,
  ): void => {
    if (
      stopping ||
      generations[service] !== generation ||
      !['ready', 'degraded'].includes(states[service]) ||
      pendingHealth[service] !== undefined
    ) {
      return;
    }
    clearTimers(service);
    const requestId = `health-${String(++requestSequence)}`;
    pendingHealth[service] = requestId;
    processes.get(service)?.send({
      type: 'healthCheck',
      protocolVersion: 1,
      requestId,
    } satisfies MainToServiceMessage);
    addTimer(
      service,
      () => {
        Reflect.deleteProperty(pendingHealth, service);
        if (misses >= 1) {
          fail(service, generation);
        } else {
          clearStableTimer(service);
          setState(service, 'degraded');
          heartbeat(service, generation, misses + 1);
        }
      },
      config.heartbeatTimeoutMs,
    );
  };

  const handleReady = (service: ServiceKind, generation: number): void => {
    if (!['starting', 'restarting'].includes(states[service])) return;
    clearTimers(service);
    setState(service, 'ready');
    scheduleStableReset(service, generation);
    addTimer(
      service,
      () => {
        heartbeat(service, generation);
      },
      config.heartbeatIntervalMs,
    );
  };

  const handleHealthResult = (
    service: ServiceKind,
    generation: number,
    requestId: string,
  ): void => {
    if (requestId !== pendingHealth[service]) return;
    Reflect.deleteProperty(pendingHealth, service);
    clearTimers(service);
    if (states[service] === 'degraded') {
      setState(service, 'ready');
      scheduleStableReset(service, generation);
    }
    addTimer(
      service,
      () => {
        heartbeat(service, generation);
      },
      config.heartbeatIntervalMs,
    );
  };

  const handleMessage = (
    service: ServiceKind,
    generation: number,
    message: unknown,
  ): void => {
    if (generations[service] !== generation) return;
    if (service === 'core' && isCoreProjectResponse(message)) {
      const requestId = message.event.requestId;
      const pending = pendingProjects.get(requestId);
      if (pending?.generation === generation) {
        cancel(pending.timeout);
        pendingProjects.delete(requestId);
        pending.resolve(message.event);
      }
      return;
    }
    if (service === 'core' && isCorePlaybackResponse(message)) {
      const pending = pendingPlayback.get(message.requestId);
      if (pending?.generation === generation) {
        cancel(pending.timeout);
        pendingPlayback.delete(message.requestId);
        pending.resolve(message);
      }
      return;
    }
    if (!isServiceToMainMessage(message)) {
      fail(service, generation);
      return;
    }
    const value: ServiceToMainMessage = message;
    switch (value.type) {
      case 'ready':
        if (value.service === service) handleReady(service, generation);
        else fail(service, generation);
        break;
      case 'healthResult':
        handleHealthResult(service, generation, value.requestId);
        break;
      case 'shutdownComplete':
        if (value.requestId === pendingShutdown[service])
          finalizeStopped(service, generation, false);
        break;
      case 'fatal':
        fail(service, generation);
        break;
    }
  };

  return {
    start() {
      stopping = false;
      shutdownPromise = undefined;
      finishShutdown = undefined;
      serviceKinds.forEach((service) => {
        if (states[service] === 'stopped' || states[service] === 'failed')
          launch(service);
      });
      return Promise.resolve();
    },

    restart(service) {
      if (stopping) return Promise.resolve();
      restartAttempts[service] = 0;
      invalidateGeneration(service, true);
      launch(service);
      return Promise.resolve();
    },

    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      stopping = true;
      shutdownPromise = new Promise<void>((resolve) => {
        finishShutdown = resolve;
      });

      serviceKinds.forEach((service) => {
        clearTimers(service);
        clearStableTimer(service);
        Reflect.deleteProperty(pendingHealth, service);
        const process = processes.get(service);
        if (!process) {
          invalidateGeneration(service, false);
          setState(service, 'stopped');
          return;
        }

        const generation = generations[service];
        setState(service, 'stopping');
        const requestId = `shutdown-${String(++requestSequence)}`;
        pendingShutdown[service] = requestId;
        addTimer(
          service,
          () => {
            if (pendingShutdown[service] === requestId)
              finalizeStopped(service, generation, true);
          },
          config.shutdownTimeoutMs,
        );
        try {
          process.send({
            type: 'shutdown',
            protocolVersion: 1,
            requestId,
          });
        } catch {
          finalizeStopped(service, generation, true);
        }
      });
      completeShutdownIfSettled();
      return shutdownPromise;
    },

    getSnapshot: () => createSnapshot(states),

    subscribe(listener) {
      listeners.add(listener);
      listener(createSnapshot(states));
      return () => listeners.delete(listener);
    },

    dispatchProject(command) {
      if (states.core !== 'ready') {
        return Promise.reject(new Error('Music Core is not ready.'));
      }
      const process = processes.get('core');
      if (process === undefined) {
        return Promise.reject(new Error('Music Core is unavailable.'));
      }
      const generation = generations.core;
      if (pendingProjects.has(command.requestId)) {
        return Promise.reject(
          new Error('A matching project command is already pending.'),
        );
      }
      return new Promise<ProjectEvent>((resolve, reject) => {
        const timeout = schedule(() => {
          pendingProjects.delete(command.requestId);
          reject(
            new Error('Music Core did not respond to the project command.'),
          );
        }, 15_000);
        pendingProjects.set(command.requestId, {
          generation,
          resolve,
          reject,
          timeout,
        });
        try {
          process.send({
            type: 'projectCommand',
            protocolVersion: 1,
            command,
          } satisfies CoreProjectRequest);
        } catch {
          cancel(timeout);
          pendingProjects.delete(command.requestId);
          reject(
            new Error('Music Core could not receive the project command.'),
          );
        }
      });
    },

    readCurrentPlayback() {
      if (states.core !== 'ready') {
        return Promise.reject(new Error('Music Core is not ready.'));
      }
      const process = processes.get('core');
      if (process === undefined) {
        return Promise.reject(new Error('Music Core is unavailable.'));
      }
      const requestId = `playback-${String(++requestSequence)}`;
      const generation = generations.core;
      return new Promise<CorePlaybackResponse>((resolve, reject) => {
        const timeout = schedule(() => {
          pendingPlayback.delete(requestId);
          reject(new Error('Music Core did not return a playback bundle.'));
        }, 15_000);
        pendingPlayback.set(requestId, {
          generation,
          resolve,
          reject,
          timeout,
        });
        try {
          process.send({
            type: 'playback.readCurrent',
            protocolVersion: 1,
            requestId,
          } satisfies CorePlaybackRequest);
        } catch {
          cancel(timeout);
          pendingPlayback.delete(requestId);
          reject(new Error('Music Core could not receive playback request.'));
        }
      });
    },
  };
};
