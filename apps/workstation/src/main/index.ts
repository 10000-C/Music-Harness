import { app, utilityProcess, type BrowserWindow } from 'electron';
import { installAppLifecycle } from './app-lifecycle.js';
import { createMainWindow } from './create-main-window.js';
import { registerShellIpc } from './register-shell-ipc.js';
import { createServiceSupervisor } from './service-supervisor/index.js';
import {
  createAgentChildProcessAdapter,
  createCoreUtilityProcessAdapter,
  type ManagedProcessAdapter,
} from './service-supervisor/process-adapters.js';
import { resolveServiceEntry } from './service-entry-resolver.js';
import { fork } from 'node:child_process';
import { writeSmokeLog } from './smoke-log.js';

const isSpessaSynthSmoke =
  process.env.AGENT_MUSIC_SMOKE === '1' &&
  process.env.AGENT_MUSIC_SPESSA_SPIKE === '1';

if (isSpessaSynthSmoke) {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

const requireServiceEntry = (service: 'core' | 'agent'): string => {
  const entry = resolveServiceEntry(service);
  if (!entry) throw new Error(`${service} service entry is not configured.`);
  return entry;
};

const fakeAdapter = createAgentChildProcessAdapter((service) => {
  return fork(requireServiceEntry(service), [service], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
});

const coreAdapter = createCoreUtilityProcessAdapter((service) =>
  utilityProcess.fork(requireServiceEntry(service), [service]),
);
const agentAdapter = createAgentChildProcessAdapter((service) => {
  const child = fork(requireServiceEntry(service), [service], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout?.on('data', (chunk: Buffer | string) => {
    process.stdout.write(`[agent] ${chunk.toString()}`);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    process.stderr.write(`[agent] ${chunk.toString()}`);
  });
  return child;
});
const productionAdapter: ManagedProcessAdapter = {
  spawn: (service) =>
    service === 'core'
      ? coreAdapter.spawn(service)
      : agentAdapter.spawn(service),
};
const fakeAgentProductionCoreAdapter: ManagedProcessAdapter = {
  spawn: (service) =>
    service === 'core'
      ? coreAdapter.spawn(service)
      : fakeAdapter.spawn(service),
};

const supervisor = createServiceSupervisor(
  process.env.AGENT_MUSIC_FAKE_SERVICES === '1'
    ? fakeAdapter
    : process.env.AGENT_MUSIC_FAKE_AGENT === '1'
      ? fakeAgentProductionCoreAdapter
      : productionAdapter,
);

const wireShellIpc = (window: BrowserWindow): BrowserWindow => {
  const unregister = registerShellIpc(window, supervisor);
  window.once('closed', unregister);
  return window;
};

if (process.env.AGENT_MUSIC_SMOKE === '1') {
  let rendererReady = false;
  let servicesReady = false;
  let completed = false;

  const complete = (): void => {
    if (!completed && rendererReady && servicesReady) {
      completed = true;
      writeSmokeLog('SMOKE:complete');
      app.quit();
    }
  };

  supervisor.subscribe((snapshot) => {
    if (
      !servicesReady &&
      snapshot.core === 'ready' &&
      snapshot.agent === 'ready'
    ) {
      servicesReady = true;
      writeSmokeLog('SMOKE:services-ready');
      complete();
    }
  });

  installAppLifecycle(app, supervisor, () =>
    wireShellIpc(
      createMainWindow({
        onRendererReady: (state) => {
          rendererReady = true;
          writeSmokeLog(`SMOKE:renderer-security:${JSON.stringify(state)}`);
          complete();
        },
        onSpessaSynthReady: (state) => {
          rendererReady = true;
          writeSmokeLog(`SMOKE:spessasynth:${JSON.stringify(state)}`);
          complete();
        },
      }),
    ),
  );
} else {
  installAppLifecycle(app, supervisor, () => wireShellIpc(createMainWindow()));
}
