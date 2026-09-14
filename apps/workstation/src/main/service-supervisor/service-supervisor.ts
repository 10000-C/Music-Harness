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
  isCoreCandidateResponse,
  isCoreCandidateEventNotification,
  isCoreCandidateStateResponse,
  type CandidateStateSnapshot,
  type CoreCandidateEventNotification,
  type CoreCandidateRequest,
  type CoreCandidateStateRequest,
} from '../../shared/candidate-bridge.js';
import {
  isCorePlaybackResponse,
  isCorePlaybackSnapshotResponse,
  type CorePlaybackSnapshot,
  type CorePlaybackSnapshotRequest,
  type CorePlaybackRequest,
  type CorePlaybackResponse,
  type PlaybackSnapshotSource,
} from '../../shared/playback-bridge.js';
import type { ProjectEvent } from '@agent-music/contracts';
import type { CandidateEvent } from '@agent-music/contracts';
import type { ProjectId } from '@agent-music/contracts';
import {
  isAgentProcessEvent,
  type AgentCommand,
  type AgentCommandResult,
  type AgentEvent,
  type AgentProcessCommand,
} from '@agent-music/contracts';

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
  dispatchCandidate(
    command: CoreCandidateRequest['command'],
  ): Promise<readonly CandidateEvent[]>;
  readCandidateState(
    projectId: CoreCandidateStateRequest['projectId'],
  ): Promise<CandidateStateSnapshot>;
  onCandidateEvent(
    listener: (notification: CoreCandidateEventNotification) => void,
  ): () => void;
  dispatchAgent(command: AgentCommand): Promise<AgentCommandResult>;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  /**
   * Tracks the Core-side Active Project so an unexpected Agent exit can roll
   * back its authoritative Active Task via cancelActiveTaskForAgentLoss.
   */
  trackActiveProject(projectId: ProjectId | null): void;
  getActiveProjectId(): ProjectId | null;
  readCurrentPlayback(): Promise<CorePlaybackResponse>;
  readPlaybackSnapshot(
    projectId: CorePlaybackSnapshotRequest['projectId'],
    source: PlaybackSnapshotSource,
  ): Promise<CorePlaybackSnapshot>;
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
  const pendingPlaybackSnapshots = new Map<
    string,
    {
      readonly generation: number;
      readonly projectId: CorePlaybackSnapshotRequest['projectId'];
      readonly source: PlaybackSnapshotSource;
      readonly resolve: (snapshot: CorePlaybackSnapshot) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingCandidates = new Map<
    string,
    {
      readonly generation: number;
      readonly resolve: (events: readonly CandidateEvent[]) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingCandidateStates = new Map<
    string,
    {
      readonly generation: number;
      readonly projectId: CoreCandidateStateRequest['projectId'];
      readonly resolve: (state: CandidateStateSnapshot) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingAgents = new Map<
    string,
    {
      readonly generation: number;
      readonly resolve: (result: AgentCommandResult) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const agentEventListeners = new Set<(event: AgentEvent) => void>();
  const candidateEventListeners = new Set<
    (notification: CoreCandidateEventNotification) => void
  >();
  const listeners = new Set<(value: ServiceFleetSnapshot) => void>();
  const stopResolvers = new Map<ServiceKind, () => void>();
  let trackedProjectId: ProjectId | null = null;
  let stopping = false;
  let requestSequence = 0;
  let shutdownPromise: Promise<void> | undefined;

  const emit = (): void => {
    const value = createSnapshot(states);
    listeners.forEach((listener) => {
      listener(value);
    });
  };

  const setState = (service: ServiceKind, state: ServiceState): void => {
    states[service] = state;
    emit();
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
      for (const [requestId, pending] of pendingPlaybackSnapshots) {
        if (pending.generation !== generations.core) continue;
        cancel(pending.timeout);
        pending.reject(new Error('The Music Core process restarted.'));
        pendingPlaybackSnapshots.delete(requestId);
      }
      for (const [requestId, pending] of pendingCandidates) {
        if (pending.generation !== generations.core) continue;
        cancel(pending.timeout);
        pending.reject(new Error('The Music Core process restarted.'));
        pendingCandidates.delete(requestId);
      }
      for (const [requestId, pending] of pendingCandidateStates) {
        if (pending.generation !== generations.core) continue;
        cancel(pending.timeout);
        pending.reject(new Error('The Music Core process restarted.'));
        pendingCandidateStates.delete(requestId);
      }
    }
    if (service === 'agent') {
      for (const [requestId, pending] of pendingAgents) {
        if (pending.generation !== generations.agent) continue;
        cancel(pending.timeout);
        pending.reject(new Error('The Agent process restarted.'));
        pendingAgents.delete(requestId);
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
    const resolver = stopResolvers.get(service);
    if (resolver !== undefined) {
      stopResolvers.delete(service);
      resolver();
    }
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
      else {
        if (service === 'agent') rollbackTrackedProjectForAgentLoss();
        fail(service, generation);
      }
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

  /**
   * Best-effort Core-side rollback after the Agent process was lost with an
   * Active Task possibly outstanding. Core treats this command as idempotent
   * when no Active Task exists, so firing it unconditionally is safe.
   */
  const rollbackTrackedProjectForAgentLoss = (): void => {
    if (stopping || trackedProjectId === null) return;
    const projectId = trackedProjectId;
    const core = processes.get('core');
    if (core === undefined || states.core !== 'ready') return;
    const requestId = `agent-loss-${String(++requestSequence)}`;
    const timeout = schedule(() => {
      pendingCandidates.delete(requestId);
    }, 15_000);
    pendingCandidates.set(requestId, {
      generation: generations.core,
      resolve: () => undefined,
      reject: () => undefined,
      timeout,
    });
    try {
      core.send({
        type: 'candidateCommand',
        protocolVersion: 1,
        command: {
          type: 'candidate.cancelActiveTaskForAgentLoss',
          requestId,
          projectId,
        },
      } satisfies CoreCandidateRequest);
    } catch {
      cancel(timeout);
      pendingCandidates.delete(requestId);
    }
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
    if (service === 'agent') {
      processes.get(service)?.send({
        type: 'agent.process.health',
        requestId,
      } satisfies AgentProcessCommand);
    } else {
      processes.get(service)?.send({
        type: 'healthCheck',
        protocolVersion: 1,
        requestId,
      } satisfies MainToServiceMessage);
    }
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
      if (message.event.type === 'project.opened') {
        trackedProjectId = message.event.project.projectId;
      } else if (message.event.type === 'project.closed') {
        trackedProjectId = null;
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
    if (service === 'core' && isCorePlaybackSnapshotResponse(message)) {
      const pending = pendingPlaybackSnapshots.get(message.requestId);
      if (pending?.generation === generation) {
        cancel(pending.timeout);
        pendingPlaybackSnapshots.delete(message.requestId);
        if (
          message.type !== 'playback.snapshot' ||
          pending.projectId !== message.projectId ||
          pending.source.kind !== message.source.kind ||
          pending.source.revision !== message.source.revision ||
          (pending.source.kind === 'candidate' &&
            (message.source.kind !== 'candidate' ||
              pending.source.candidateId !== message.source.candidateId))
        ) {
          pending.reject(
            new Error('Music Core returned a mismatched playback snapshot.'),
          );
        } else {
          pending.resolve(message);
        }
      }
      return;
    }
    if (service === 'core' && isCoreCandidateResponse(message)) {
      const pending = pendingCandidates.get(message.requestId);
      if (pending?.generation === generation) {
        cancel(pending.timeout);
        pendingCandidates.delete(message.requestId);
        pending.resolve(message.events);
      }
      return;
    }
    if (service === 'core' && isCoreCandidateStateResponse(message)) {
      const pending = pendingCandidateStates.get(message.requestId);
      if (pending?.generation === generation) {
        cancel(pending.timeout);
        pendingCandidateStates.delete(message.requestId);
        if (pending.projectId !== message.state.projectId) {
          pending.reject(
            new Error('Music Core returned the wrong project state.'),
          );
        } else {
          pending.resolve(message.state);
        }
      }
      return;
    }
    if (service === 'core' && isCoreCandidateEventNotification(message)) {
      candidateEventListeners.forEach((listener) => {
        listener(message);
      });
      return;
    }
    if (service === 'agent' && isAgentProcessEvent(message)) {
      switch (message.type) {
        case 'agent.process.ready':
          handleReady('agent', generation);
          return;
        case 'agent.process.healthy':
          handleHealthResult('agent', generation, message.requestId);
          return;
        case 'agent.process.stopped':
          if (message.requestId === pendingShutdown.agent) {
            finalizeStopped('agent', generation, false);
          }
          return;
        case 'agent.process.commandResult': {
          const pending = pendingAgents.get(message.result.requestId);
          if (pending?.generation === generation) {
            cancel(pending.timeout);
            pendingAgents.delete(message.result.requestId);
            pending.resolve(message.result);
          }
          return;
        }
        case 'agent.process.commandFailed': {
          const pending = pendingAgents.get(message.requestId);
          if (pending?.generation === generation) {
            cancel(pending.timeout);
            pendingAgents.delete(message.requestId);
            const err = new Error(message.message);
            (err as { code?: string }).code = message.code;
            pending.reject(err);
          }
          return;
        }
        case 'agent.process.agentEvent':
          agentEventListeners.forEach((listener) => {
            listener(message.event);
          });
          return;
        case 'agent.process.fatal':
          rollbackTrackedProjectForAgentLoss();
          fail('agent', generation);
          return;
      }
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

  const stopService = (service: ServiceKind): Promise<void> => {
    clearTimers(service);
    clearStableTimer(service);
    Reflect.deleteProperty(pendingHealth, service);
    const process = processes.get(service);
    if (!process || states[service] === 'stopped') {
      invalidateGeneration(service, false);
      setState(service, 'stopped');
      return Promise.resolve();
    }

    const generation = generations[service];
    setState(service, 'stopping');
    const requestId = `shutdown-${String(++requestSequence)}`;
    pendingShutdown[service] = requestId;

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      stopResolvers.set(service, settle);

      addTimer(
        service,
        () => {
          if (pendingShutdown[service] === requestId)
            finalizeStopped(service, generation, true);
        },
        config.shutdownTimeoutMs,
      );
      try {
        if (service === 'agent') {
          process.send({
            type: 'agent.process.shutdown',
            requestId,
          } satisfies AgentProcessCommand);
        } else {
          process.send({
            type: 'shutdown',
            protocolVersion: 1,
            requestId,
          });
        }
      } catch {
        finalizeStopped(service, generation, true);
      }
    });
  };

  return {
    start() {
      stopping = false;
      shutdownPromise = undefined;
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
      shutdownPromise = (async () => {
        // Stop Agent first so its in-flight rollback HTTP requests can still
        // reach Music Core's MCP HTTP server before Core stops.
        for (const service of ['agent', 'core'] as const) {
          await stopService(service);
        }
      })();
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

    dispatchCandidate(command) {
      if (states.core !== 'ready') {
        return Promise.reject(new Error('Music Core is not ready.'));
      }
      const process = processes.get('core');
      if (process === undefined) {
        return Promise.reject(new Error('Music Core is unavailable.'));
      }
      const generation = generations.core;
      if (pendingCandidates.has(command.requestId)) {
        return Promise.reject(
          new Error('A matching Candidate command is already pending.'),
        );
      }
      return new Promise<readonly CandidateEvent[]>((resolve, reject) => {
        const timeout = schedule(() => {
          pendingCandidates.delete(command.requestId);
          reject(
            new Error('Music Core did not respond to the Candidate command.'),
          );
        }, 15_000);
        pendingCandidates.set(command.requestId, {
          generation,
          resolve,
          reject,
          timeout,
        });
        try {
          process.send({
            type: 'candidateCommand',
            protocolVersion: 1,
            command,
          } satisfies CoreCandidateRequest);
        } catch {
          cancel(timeout);
          pendingCandidates.delete(command.requestId);
          reject(
            new Error('Music Core could not receive the Candidate command.'),
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

    readPlaybackSnapshot(projectId, source) {
      if (states.core !== 'ready') {
        return Promise.reject(new Error('Music Core is not ready.'));
      }
      const process = processes.get('core');
      if (process === undefined) {
        return Promise.reject(new Error('Music Core is unavailable.'));
      }
      const requestId = `playback-snapshot-${String(++requestSequence)}`;
      const generation = generations.core;
      return new Promise<CorePlaybackSnapshot>((resolve, reject) => {
        const timeout = schedule(() => {
          pendingPlaybackSnapshots.delete(requestId);
          reject(new Error('Music Core did not return a playback snapshot.'));
        }, 15_000);
        pendingPlaybackSnapshots.set(requestId, {
          generation,
          projectId,
          source,
          resolve,
          reject,
          timeout,
        });
        try {
          process.send({
            type: 'playback.readSnapshot',
            protocolVersion: 1,
            requestId,
            projectId,
            source,
          } satisfies CorePlaybackSnapshotRequest);
        } catch {
          cancel(timeout);
          pendingPlaybackSnapshots.delete(requestId);
          reject(
            new Error(
              'Music Core could not receive playback snapshot request.',
            ),
          );
        }
      });
    },

    readCandidateState(projectId) {
      if (states.core !== 'ready') {
        return Promise.reject(new Error('Music Core is not ready.'));
      }
      const process = processes.get('core');
      if (process === undefined) {
        return Promise.reject(new Error('Music Core is unavailable.'));
      }
      const requestId = `candidate-state-${String(++requestSequence)}`;
      const generation = generations.core;
      if (pendingCandidateStates.has(requestId)) {
        return Promise.reject(
          new Error('A matching Candidate state request is already pending.'),
        );
      }
      return new Promise<CandidateStateSnapshot>((resolve, reject) => {
        const timeout = schedule(() => {
          pendingCandidateStates.delete(requestId);
          reject(new Error('Music Core did not return Candidate state.'));
        }, 15_000);
        pendingCandidateStates.set(requestId, {
          generation,
          projectId,
          resolve,
          reject,
          timeout,
        });
        try {
          process.send({
            type: 'candidateState.read',
            protocolVersion: 1,
            requestId,
            projectId,
          } satisfies CoreCandidateStateRequest);
        } catch {
          cancel(timeout);
          pendingCandidateStates.delete(requestId);
          reject(
            new Error('Music Core could not receive Candidate state request.'),
          );
        }
      });
    },

    dispatchAgent(command) {
      if (states.agent !== 'ready') {
        return Promise.reject(new Error('Agent service is not ready.'));
      }
      const process = processes.get('agent');
      if (process === undefined) {
        return Promise.reject(new Error('Agent service is unavailable.'));
      }
      const generation = generations.agent;
      if (pendingAgents.has(command.requestId)) {
        return Promise.reject(
          new Error('A matching Agent command is already pending.'),
        );
      }
      return new Promise<AgentCommandResult>((resolve, reject) => {
        const timeout = schedule(() => {
          pendingAgents.delete(command.requestId);
          reject(new Error('Agent service did not respond to the command.'));
        }, 30_000);
        pendingAgents.set(command.requestId, {
          generation,
          resolve,
          reject,
          timeout,
        });
        try {
          process.send(command);
        } catch {
          cancel(timeout);
          pendingAgents.delete(command.requestId);
          reject(new Error('Agent service could not receive the command.'));
        }
      });
    },

    onAgentEvent(listener) {
      agentEventListeners.add(listener);
      return () => {
        agentEventListeners.delete(listener);
      };
    },

    trackActiveProject(projectId) {
      trackedProjectId = projectId;
    },

    getActiveProjectId: () => trackedProjectId,

    onCandidateEvent(listener) {
      candidateEventListeners.add(listener);
      return () => {
        candidateEventListeners.delete(listener);
      };
    },
  };
};
