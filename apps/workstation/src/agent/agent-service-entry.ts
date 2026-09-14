import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentProcessEvent } from '@agent-music/contracts';
import {
  AgentProcessEntrypoint,
  HttpTaskRollback,
  RuntimeDescriptorDiscovery,
  createAgentService,
} from '@agent-music/agent';

/**
 * Fork-able Agent process entry. Electron Main launches this file with
 * child_process.fork (running under Electron's embedded Node); it wires
 * the shared AgentProcessEntrypoint protocol state machine to the IPC
 * channel and composes the production AgentService with the HTTP rollback
 * port.
 */

/**
 * Shared user-level Agent Music home. The Core process publishes its MCP
 * runtime descriptor under the same root, so both sides must agree on the
 * override and the default.
 */
const agentMusicHome =
  process.env.AGENT_MUSIC_HOME ?? join(homedir(), '.agent-music');
const runtimeDirectory = join(agentMusicHome, 'runtime');

const emit = (event: AgentProcessEvent): void => {
  process.send?.(event);
  if (event.type === 'agent.process.stopped') {
    process.exit(0);
  }
  if (event.type === 'agent.process.fatal') {
    process.exit(1);
  }
};

const service = createAgentService({
  paths: {
    settingsPath: join(agentMusicHome, 'settings.json'),
    sessionIndexPath: join(agentMusicHome, 'agent', 'session-index.json'),
    sessionStorageRoot: join(agentMusicHome, 'agent', 'sessions'),
    runtimeDirectory,
  },
  rollback: new HttpTaskRollback({
    descriptors: new RuntimeDescriptorDiscovery(runtimeDirectory),
  }),
});

const entrypoint = new AgentProcessEntrypoint(service, emit);

process.on('message', (message: unknown) => {
  void entrypoint.handle(message).catch(() => {
    // AgentProcessEntrypoint.handle only rejects on fatal protocol or
    // cleanup failures, both of which already emitted agent.process.fatal.
    process.exit(1);
  });
});

entrypoint.start();
