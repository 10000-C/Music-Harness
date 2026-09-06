import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceSupervisor as createProductionServiceSupervisor } from '../src/main/service-supervisor/index.js';
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
});
