import { randomUUID } from 'node:crypto';

import type { AgentExecutionId, AgentSessionId } from '@agent-music/contracts';

import { RuntimeDescriptorDiscovery } from './mcp/runtime-descriptor.js';
import { StrandsTaskBootstrapper } from './mcp/task-bootstrapper.js';
import { StrandsAgentRuntimeFactory } from './runtime/index.js';
import { readStrandsConversation, SessionRegistry } from './session/index.js';
import { AgentService } from './service/index.js';
import { AgentSettingsStore } from './settings/index.js';
import { AgentWorkflow, type TaskRollbackPort } from './workflow/index.js';

export {
  AgentProcessEntrypoint,
  type AgentProcessEventSink,
  type AgentProcessServicePort,
} from './process/index.js';
export { AgentService, AgentServiceError } from './service/index.js';
export type {
  AgentConversationReader,
  AgentServiceDependencies,
  AgentServiceErrorCode,
  AgentServiceSessionPort,
  AgentServiceWorkflowPort,
} from './service/index.js';
export { AgentSettingsStore } from './settings/index.js';
export type { TaskRollbackPort } from './workflow/index.js';
export type {
  AgentModelConfig,
  AgentSettings,
  AgentSettingsErrorCode,
} from './settings/index.js';

export interface AgentServicePaths {
  readonly settingsPath: string;
  readonly sessionIndexPath: string;
  readonly sessionStorageRoot: string;
  readonly runtimeDirectory: string;
}

export interface CreateAgentServiceOptions {
  readonly paths: AgentServicePaths;
  readonly rollback: TaskRollbackPort;
  readonly createSessionId?: () => AgentSessionId;
  readonly createExecutionId?: () => AgentExecutionId;
  readonly now?: () => string;
}

const defaultCreateSessionId = (): AgentSessionId =>
  randomUUID() as AgentSessionId;
const defaultCreateExecutionId = (): AgentExecutionId =>
  randomUUID() as AgentExecutionId;
const defaultNow = (): string => new Date().toISOString();

export const createAgentService = (
  options: CreateAgentServiceOptions,
): AgentService => {
  const settings = new AgentSettingsStore(options.paths.settingsPath);
  const sessions = new SessionRegistry({
    indexPath: options.paths.sessionIndexPath,
    createId: options.createSessionId ?? defaultCreateSessionId,
    now: options.now ?? defaultNow,
  });
  const descriptors = new RuntimeDescriptorDiscovery(
    options.paths.runtimeDirectory,
  );
  const runtimeFactory = new StrandsAgentRuntimeFactory({
    settings,
    descriptors,
    storageRoot: options.paths.sessionStorageRoot,
  });
  const coreControl = new StrandsTaskBootstrapper(descriptors);
  const workflow = new AgentWorkflow({
    runtimeFactory,
    taskBootstrap: coreControl,
    operations: coreControl,
    rollback: options.rollback,
    settings,
    createExecutionId: options.createExecutionId ?? defaultCreateExecutionId,
  });

  return new AgentService({
    sessions,
    workflow,
    readConversation: (sessionId) =>
      readStrandsConversation(sessionId, options.paths.sessionStorageRoot),
  });
};
