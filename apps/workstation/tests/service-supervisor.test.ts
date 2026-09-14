import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileComposition,
  createInitialCanonicalAbc,
} from '../src/core/composition/index.js';
import { createServiceSupervisor as createProductionServiceSupervisor } from '../src/main/service-supervisor/index.js';
import type { OperationId, ProjectId } from '@agent-music/contracts';
import type {
  ManagedProcess,
  ManagedProcessAdapter,
} from '../src/main/service-supervisor/process-adapters.js';
import {
  createAgentChildProcessAdapter,
  createCoreUtilityProcessAdapter,
} from '../src/main/service-supervisor/process-adapters.js';

const createServiceSupervisor: typeof createProductionServiceSupervisor = (
  processAdapter,
  options,
) =>
  createProductionServiceSupervisor(processAdapter, {
    shutdownTimeoutMs: 0,
    ...options,
  });

const agentProjectId = '00000000-0000-4000-8000-000000000002' as ProjectId;

const adapter = (): ManagedProcessAdapter & {
  emit(service: 'core' | 'agent', message: unknown): void;
  exit(service: 'core' | 'agent'): void;
  readonly sent: unknown[];
} => {
  const messages = new Map<string, (message: unknown) => void>();
  const exits = new Map<string, () => void>();
  const sent: unknown[] = [];
  return {
    sent,
    spawn(service) {
      return {
        send(message) {
          sent.push(message);
        },
        terminate() {},
        onMessage(listener) {
          messages.set(service, listener);
          return () => {};
        },
        onExit(listener) {
          exits.set(service, listener);
          return () => {};
        },
      };
    },
    emit(service, message) {
      messages.get(service)?.(message);
    },
    exit(service) {
      exits.get(service)?.();
    },
  };
};

describe('ServiceSupervisor', () => {
  let active: ReturnType<typeof createServiceSupervisor> | undefined;
  afterEach(async () => {
    if (active) {
      if (!vi.isFakeTimers()) vi.useFakeTimers();
      const shutdown = active.shutdown('appQuit');
      await vi.runAllTimersAsync();
      await shutdown;
    }
    vi.useRealTimers();
    active = undefined;
  });
  it('keeps Core and Agent states independent through its public interface', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    expect(supervisor.getSnapshot()).toEqual({
      core: 'starting',
      agent: 'starting',
    });
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    processes.emit('agent', {
      type: 'fatal',
      protocolVersion: 1,
      service: 'agent',
      code: 'X',
      message: 'failed',
    });
    expect(supervisor.getSnapshot()).toEqual({
      core: 'ready',
      agent: 'restarting',
    });
  });
  it('routes a project result only to the matching Core generation', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    const command = { type: 'project.close' as const, requestId: 'close-1' };
    const pending = supervisor.dispatchProject(command);
    expect(processes.sent).toContainEqual({
      type: 'projectCommand',
      protocolVersion: 1,
      command,
    });
    processes.emit('core', {
      type: 'projectEvent',
      protocolVersion: 1,
      event: { type: 'project.closed', requestId: 'close-1', sequence: 1 },
    });
    await expect(pending).resolves.toEqual({
      type: 'project.closed',
      requestId: 'close-1',
      sequence: 1,
    });
  });
  it('routes a Current playback result only to its matching Core request', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    const pending = supervisor.readCurrentPlayback();
    const request = processes.sent.find(
      (message): message is { type: string; requestId: string } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'playback.readCurrent',
    );
    processes.emit('core', {
      type: 'playback.failed',
      protocolVersion: 1,
      requestId: request?.requestId,
      code: 'COMPILATION_FAILED',
      userMessage: 'Current could not be compiled for playback.',
    });
    await expect(pending).resolves.toMatchObject({
      type: 'playback.failed',
      code: 'COMPILATION_FAILED',
    });
  });
  it('routes a source-aware playback snapshot to its matching Core request', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    const projectId = '00000000-0000-4000-8000-000000000001' as ProjectId;
    const source = { kind: 'current' as const, revision: 'current-1' };
    const pending = supervisor.readPlaybackSnapshot(projectId, source);
    const request = processes.sent.find(
      (message): message is { type: string; requestId: string } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'playback.readSnapshot',
    );
    expect(request).toBeDefined();
    const compiled = compileComposition(createInitialCanonicalAbc());
    processes.emit('core', {
      type: 'playback.snapshot',
      protocolVersion: 1,
      requestId: request?.requestId,
      projectId,
      source,
      revision: source.revision,
      compilation: compiled.playback,
      timeline: compiled.timelineViewModel,
    });
    await expect(pending).resolves.toMatchObject({
      type: 'playback.snapshot',
      source,
      revision: source.revision,
    });
  });
  it('routes the complete Candidate event batch only to its matching request', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    const command = {
      type: 'candidate.reject' as const,
      requestId: 'candidate-reject-1',
      projectId: '00000000-0000-4000-8000-000000000001' as never,
      candidateId: '00000000-0000-4000-8000-000000000002' as never,
    };
    const pending = supervisor.dispatchCandidate(command);
    expect(processes.sent).toContainEqual({
      type: 'candidateCommand',
      protocolVersion: 1,
      command,
    });
    const events = [
      {
        type: 'candidate.invalidated' as const,
        requestId: command.requestId,
        sequence: 1,
        candidateId: command.candidateId,
      },
      {
        type: 'candidate.changed' as const,
        requestId: command.requestId,
        sequence: 2,
      },
    ];
    processes.emit('core', {
      type: 'candidateEvents',
      protocolVersion: 1,
      requestId: command.requestId,
      events,
    });
    await expect(pending).resolves.toEqual(events);
  });
  it('reads Candidate state and publishes project-scoped Core notifications', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });

    const notifications: unknown[] = [];
    supervisor.onCandidateEvent((notification) => {
      notifications.push(notification);
    });
    const pending = supervisor.readCandidateState(
      '00000000-0000-4000-8000-000000000001' as ProjectId,
    );
    const request = processes.sent.find(
      (message): message is { type: string; requestId: string } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'candidateState.read',
    );
    expect(request).toBeDefined();
    processes.emit('core', {
      type: 'candidateState.readResult',
      protocolVersion: 1,
      requestId: request?.requestId,
      state: {
        projectId: '00000000-0000-4000-8000-000000000001',
        sequence: 4,
        candidate: null,
        task: null,
        candidatePlaybackSnapshot: null,
      },
    });
    await expect(pending).resolves.toMatchObject({
      sequence: 4,
      candidate: null,
    });

    const notification = {
      type: 'candidateState.event' as const,
      protocolVersion: 1 as const,
      projectId: '00000000-0000-4000-8000-000000000001' as ProjectId,
      candidatePlaybackSnapshot: null,
      event: {
        type: 'candidate.changed' as const,
        requestId: 'candidate-event-1',
        sequence: 5,
      },
    };
    processes.emit('core', notification);
    expect(notifications).toEqual([notification]);
  });
  it('routes Operation state, control results, and project-scoped notifications', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });

    const projectId = '00000000-0000-4000-8000-000000000001' as ProjectId;
    const operationNotifications: unknown[] = [];
    supervisor.onOperationEvent((notification) => {
      operationNotifications.push(notification);
    });

    const statePending = supervisor.readOperationState(projectId);
    const stateRequest = processes.sent.find(
      (message): message is { type: string; requestId: string } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'operationState.read',
    );
    expect(stateRequest).toBeDefined();
    processes.emit('core', {
      type: 'operationState.readResult',
      protocolVersion: 1,
      requestId: stateRequest?.requestId,
      state: { projectId, sequence: 2, operations: [] },
    });
    await expect(statePending).resolves.toEqual({
      projectId,
      sequence: 2,
      operations: [],
    });

    const command = {
      type: 'operation.resolve' as const,
      protocolVersion: 1 as const,
      requestId: 'operation-resolve-1',
      operationId: 'operation-1' as OperationId,
      decision: 'reject' as const,
    };
    const controlPending = supervisor.dispatchOperation(command);
    expect(processes.sent).toContainEqual(command);
    const result = {
      ok: false as const,
      code: 'OPERATION_NOT_FOUND',
      userMessage: 'The operation no longer exists.',
    };
    processes.emit('core', {
      type: 'operation.resolveResult',
      protocolVersion: 1,
      requestId: command.requestId,
      result,
    });
    await expect(controlPending).resolves.toEqual(result);

    const notification = {
      type: 'operationState.event' as const,
      protocolVersion: 1 as const,
      projectId,
      sequence: 3,
      operation: {
        operationId: 'operation-1',
        type: 'generationPlan' as const,
        state: 'cancelled' as const,
        createdAt: '2026-09-11T00:00:00.000Z',
      },
    };
    processes.emit('core', notification);
    expect(operationNotifications).toEqual([notification]);
  });
  it('routes Current export preparation through the Core process', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });

    const pending = supervisor.prepareCurrentExport();
    const request = processes.sent.find(
      (message): message is { type: string; command: { requestId: string } } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'exportCommand',
    );
    expect(request).toBeDefined();
    const prepared = {
      projectId: '00000000-0000-4000-8000-000000000001' as ProjectId,
      currentRevision: 'current-1',
      canonicalAbc: 'X:1\nK:C\n',
      midiFileBytes: new Uint8Array([0x4d, 0x54, 0x68, 0x64]),
    };
    processes.emit('core', {
      type: 'exportEvent',
      protocolVersion: 1,
      event: {
        type: 'export.prepared',
        requestId: request?.command.requestId,
        sequence: 1,
        result: prepared,
      },
    });
    await expect(pending).resolves.toEqual(prepared);
  });
  it('keeps an in-flight Core command when the Agent restarts', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    processes.emit('agent', {
      type: 'ready',
      protocolVersion: 1,
      service: 'agent',
    });
    const command = {
      type: 'project.close' as const,
      requestId: 'close-agent-restart',
    };
    const pending = supervisor.dispatchProject(command);
    await supervisor.restart('agent');
    processes.emit('core', {
      type: 'projectEvent',
      protocolVersion: 1,
      event: {
        type: 'project.closed',
        requestId: command.requestId,
        sequence: 1,
      },
    });
    await expect(pending).resolves.toMatchObject({ type: 'project.closed' });
  });

  it('rejects a duplicate project request id without replacing the original', async () => {
    const processes = adapter();
    const supervisor = (active = createServiceSupervisor(processes));
    await supervisor.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    const command = {
      type: 'project.close' as const,
      requestId: 'duplicate-project-command',
    };
    const first = supervisor.dispatchProject(command);
    await expect(supervisor.dispatchProject(command)).rejects.toThrow(
      'already pending',
    );
    processes.emit('core', {
      type: 'projectEvent',
      protocolVersion: 1,
      event: {
        type: 'project.closed',
        requestId: command.requestId,
        sequence: 1,
      },
    });
    await expect(first).resolves.toMatchObject({ type: 'project.closed' });
  });
  it('publishes immutable snapshots and supports independent unsubscribe', async () => {
    const supervisor = (active = createServiceSupervisor(adapter()));
    const received: unknown[] = [];
    const unsubscribe = supervisor.subscribe((snapshot) =>
      received.push(snapshot),
    );
    await supervisor.start();
    unsubscribe();
    expect(Object.isFrozen(received[0])).toBe(true);
    expect(received).toHaveLength(3);
  });
  it('sends a heartbeat after a service becomes ready', async () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const messages = new Map<'core' | 'agent', (message: unknown) => void>();
    active = createServiceSupervisor({
      spawn(service) {
        return {
          send(message) {
            sent.push(message);
          },
          terminate() {},
          onMessage(listener) {
            messages.set(service, listener);
            return () => {};
          },
          onExit() {
            return () => {};
          },
        };
      },
    });
    await active.start();
    messages.get('core')?.({
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    messages.get('agent')?.({
      type: 'ready',
      protocolVersion: 1,
      service: 'agent',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(2);
  });
  it('retries a service twice after ready timeouts, then marks it failed', async () => {
    vi.useFakeTimers();
    const processes = adapter();
    active = createServiceSupervisor(processes, {
      readyTimeoutMs: 10,
      restartDelaysMs: [1, 2],
    });
    await active.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(active.getSnapshot().core).toBe('restarting');
    await vi.advanceTimersByTimeAsync(1 + 10);
    expect(active.getSnapshot().core).toBe('restarting');
    await vi.advanceTimersByTimeAsync(2 + 10);
    expect(active.getSnapshot().core).toBe('failed');
  });
  it('manually restarts a failed service as a new failure chain', async () => {
    vi.useFakeTimers();
    const processes = adapter();
    active = createServiceSupervisor(processes, {
      readyTimeoutMs: 10,
      restartDelaysMs: [],
    });
    await active.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(active.getSnapshot().core).toBe('failed');
    await active.restart('core');
    expect(active.getSnapshot().core).toBe('starting');
  });
  it('counts a synchronous terminate exit as part of the same failure', async () => {
    vi.useFakeTimers();
    let coreSpawns = 0;
    let coreMessage: ((message: unknown) => void) | undefined;
    let coreExit: (() => void) | undefined;
    active = createServiceSupervisor(
      {
        spawn(service) {
          if (service === 'core') coreSpawns += 1;
          return {
            send() {},
            terminate() {
              if (service === 'core') coreExit?.();
            },
            onMessage(listener) {
              if (service === 'core') coreMessage = listener;
              return () => {};
            },
            onExit(listener) {
              if (service === 'core') coreExit = listener;
              return () => {};
            },
          };
        },
      },
      { restartDelaysMs: [1, 2] },
    );
    await active.start();
    coreMessage?.({
      type: 'fatal',
      protocolVersion: 1,
      service: 'core',
      code: 'X',
      message: 'failed',
    });
    expect(active.getSnapshot().core).toBe('restarting');
    await vi.advanceTimersByTimeAsync(1);
    expect(coreSpawns).toBe(2);
    expect(active.getSnapshot().core).toBe('restarting');
  });
  it('isolates a synchronous spawn failure to the affected service', async () => {
    active = createServiceSupervisor({
      spawn(service) {
        if (service === 'core') throw new Error('missing entry');
        return {
          send() {},
          terminate() {},
          onMessage() {
            return () => {};
          },
          onExit() {
            return () => {};
          },
        };
      },
    });
    await expect(active.start()).resolves.toBeUndefined();
    expect(active.getSnapshot()).toEqual({
      core: 'restarting',
      agent: 'starting',
    });
  });
  it('degrades after one missed heartbeat and recovers from its matching health result', async () => {
    vi.useFakeTimers();
    const processes = adapter();
    active = createServiceSupervisor(processes, {
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 2,
    });
    await active.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    await vi.advanceTimersByTimeAsync(7);
    expect(active.getSnapshot().core).toBe('degraded');
    const request = processes.sent
      .filter(
        (message): message is { requestId: string } =>
          typeof message === 'object' &&
          message !== null &&
          'requestId' in message,
      )
      .at(-1)?.requestId;
    processes.emit('core', {
      type: 'healthResult',
      protocolVersion: 1,
      requestId: request,
    });
    expect(active.getSnapshot().core).toBe('ready');
  });
  it('restarts only the service with two consecutive missed heartbeats', async () => {
    vi.useFakeTimers();
    const processes = adapter();
    active = createServiceSupervisor(processes, {
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 2,
    });
    await active.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    processes.emit('agent', {
      type: 'ready',
      protocolVersion: 1,
      service: 'agent',
    });
    await vi.advanceTimersByTimeAsync(5);
    const agentRequest = processes.sent
      .filter(
        (message): message is { requestId: string } =>
          typeof message === 'object' &&
          message !== null &&
          'requestId' in message,
      )
      .at(-1)?.requestId;
    processes.emit('agent', {
      type: 'healthResult',
      protocolVersion: 1,
      requestId: agentRequest,
    });
    await vi.advanceTimersByTimeAsync(4);
    expect(active.getSnapshot()).toEqual({
      core: 'restarting',
      agent: 'ready',
    });
  });
  it.each(['exit', 'invalid message'] as const)(
    'normalizes unexpected %s into retrying',
    async (kind) => {
      const processes = adapter();
      active = createServiceSupervisor(processes);
      await active.start();
      if (kind === 'exit') processes.exit('agent');
      else processes.emit('agent', { type: 'not-a-protocol-message' });
      expect(active.getSnapshot().agent).toBe('restarting');
      expect(active.getSnapshot().core).toBe('starting');
    },
  );
  it('ignores late messages from an older generation', async () => {
    const listeners: ((message: unknown) => void)[] = [];
    const adapterWithHistory: ManagedProcessAdapter = {
      spawn() {
        return {
          send() {},
          terminate() {},
          onMessage(listener) {
            listeners.push(listener);
            return () => {};
          },
          onExit() {
            return () => {};
          },
        };
      },
    };
    active = createServiceSupervisor(adapterWithHistory);
    await active.start();
    await active.restart('core');
    listeners[0]?.({ type: 'ready', protocolVersion: 1, service: 'core' });
    listeners[0]?.({
      type: 'fatal',
      protocolVersion: 1,
      service: 'core',
      code: 'X',
      message: 'late',
    });
    listeners[0]?.({
      type: 'healthResult',
      protocolVersion: 1,
      requestId: 'late',
    });
    expect(active.getSnapshot().core).toBe('starting');
  });
  it('resets the restart budget after the stable-ready period', async () => {
    vi.useFakeTimers();
    const processes = adapter();
    active = createServiceSupervisor(processes, {
      stableReadyMs: 5,
      restartDelaysMs: [1],
    });
    await active.start();
    processes.emit('core', {
      type: 'ready',
      protocolVersion: 1,
      service: 'core',
    });
    await vi.advanceTimersByTimeAsync(5);
    processes.emit('core', {
      type: 'fatal',
      protocolVersion: 1,
      service: 'core',
      code: 'X',
      message: 'failure',
    });
    expect(active.getSnapshot().core).toBe('restarting');
  });
  it.each([createCoreUtilityProcessAdapter, createAgentChildProcessAdapter])(
    'bridges a production process adapter',
    (createAdapter) => {
      const calls: string[] = [];
      let message: ((value?: unknown) => void) | undefined;
      let exit: (() => void) | undefined;
      const managed = createAdapter(() => ({
        postMessage() {
          calls.push('send');
        },
        kill() {
          calls.push('kill');
        },
        on(event, listener) {
          if (event === 'message') message = listener;
          else exit = listener;
        },
      })).spawn('core');
      managed.onMessage(() => calls.push('message'));
      managed.onExit(() => calls.push('exit'));
      managed.send({ type: 'shutdown', protocolVersion: 1, requestId: 'x' });
      managed.terminate();
      message?.({});
      exit?.();
      expect(calls).toEqual(['send', 'kill', 'message', 'exit']);
    },
  );
  it('stops gracefully when both services acknowledge shutdown', async () => {
    const processes = adapter();
    active = createServiceSupervisor(processes, { shutdownTimeoutMs: 10 });
    await active.start();
    let settled = false;
    const shutdown = active.shutdown('appQuit').then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    const shutdowns = processes.sent.filter(
      (value): value is { type: 'shutdown'; requestId: string } =>
        typeof value === 'object' &&
        value !== null &&
        (value as { type?: string }).type === 'shutdown',
    );
    processes.emit('core', {
      type: 'shutdownComplete',
      protocolVersion: 1,
      requestId: shutdowns[0]?.requestId,
    });
    processes.emit('agent', {
      type: 'shutdownComplete',
      protocolVersion: 1,
      requestId: shutdowns[1]?.requestId,
    });
    await shutdown;
    expect(settled).toBe(true);
    expect(active.getSnapshot()).toEqual({ core: 'stopped', agent: 'stopped' });
  });
  it('forces a non-acknowledging service to stop without restart', async () => {
    vi.useFakeTimers();
    let terminated = 0;
    const messages = new Map<string, (value: unknown) => void>();
    active = createServiceSupervisor(
      {
        spawn(service) {
          return {
            send() {},
            terminate() {
              terminated += 1;
            },
            onMessage(listener) {
              messages.set(service, listener);
              return () => {};
            },
            onExit() {
              return () => {};
            },
          };
        },
      },
      { shutdownTimeoutMs: 10 },
    );
    await active.start();
    const shutdown = active.shutdown('appQuit');
    await vi.advanceTimersByTimeAsync(10);
    await shutdown;
    expect(terminated).toBe(2);
    expect(active.getSnapshot()).toEqual({ core: 'stopped', agent: 'stopped' });
  });

  it('dispatches Agent commands when ready and forwards agent process events', async () => {
    const processes = adapter();
    active = createServiceSupervisor(processes);
    await active.start();

    await expect(
      active.dispatchAgent({
        type: 'agent.session.list',
        requestId: 'req-agent-1',
        projectId: agentProjectId,
      }),
    ).rejects.toThrow('Agent service is not ready.');

    processes.emit('agent', { type: 'agent.process.ready' });
    expect(active.getSnapshot().agent).toBe('ready');

    const agentEvents: unknown[] = [];
    const unsubscribe = active.onAgentEvent((event) => {
      agentEvents.push(event);
    });

    const commandPromise = active.dispatchAgent({
      type: 'agent.session.list',
      requestId: 'req-agent-2',
      projectId: agentProjectId,
    });

    expect(processes.sent).toContainEqual({
      type: 'agent.session.list',
      requestId: 'req-agent-2',
      projectId: '00000000-0000-4000-8000-000000000002',
    });

    // Emit an agent event while command is pending
    const deltaEvent = {
      type: 'agent.textDelta',
      projectId: '00000000-0000-4000-8000-000000000002',
      sessionId: '00000000-0000-4000-8000-000000000001',
      executionId: '00000000-0000-4000-8000-000000000003',
      text: 'Working on arrangement...',
    };
    processes.emit('agent', {
      type: 'agent.process.agentEvent',
      event: deltaEvent,
    });
    expect(agentEvents).toEqual([deltaEvent]);

    // Emit command result
    processes.emit('agent', {
      type: 'agent.process.commandResult',
      result: {
        type: 'agent.session.listed',
        requestId: 'req-agent-2',
        sessions: [],
      },
    });

    await expect(commandPromise).resolves.toEqual({
      type: 'agent.session.listed',
      requestId: 'req-agent-2',
      sessions: [],
    });

    unsubscribe();
    processes.emit('agent', {
      type: 'agent.process.agentEvent',
      event: { ...deltaEvent, text: 'Ignored after unsubscribe' },
    });
    expect(agentEvents.length).toBe(1);
  });
});
