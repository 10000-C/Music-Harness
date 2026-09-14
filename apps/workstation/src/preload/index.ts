import { contextBridge, ipcRenderer } from 'electron';
import { isAgentSettings } from '../shared/settings-bridge.js';
import { isServiceKind } from '../shared/service-lifecycle.js';
import { isProjectId } from '../shared/candidate-bridge.js';
import { isPlaybackSnapshotSource } from '../shared/playback-bridge.js';
import {
  isCommandResult,
  isDirectoryDialogResult,
  isExportPathRequest,
  isProjectDirectoryPurpose,
  isProjectCommand,
  isProjectCommandResult,
  isCandidateCommand,
  isCandidateCommandResult,
  isCandidateEventNotification,
  isCandidateStateResult,
  isPlaybackSnapshotResult,
  isCorePlaybackResponse,
  isAgentCommand,
  isAgentEvent,
  isDesktopAgentCommandResult,
  shellIpcChannels,
  type CommandResult,
  type DirectoryDialogResult,
  type AgentEvent,
} from '../shared/shell-contracts.js';
import type { CoreCandidateEventNotification } from '../shared/candidate-bridge.js';
import {
  isCoreOperationEventNotification,
  isOperationControlCommand,
  isOperationControlResult,
  isOperationStateResult,
} from '../shared/operation-bridge.js';
import {
  isExportFileWriteCommand,
  isExportFileWriteResult,
  isExportPreparationResult,
} from '../shared/export-bridge.js';
import {
  isServiceFleetSnapshot,
  unavailableServiceSnapshot,
  type ServiceFleetSnapshot,
} from '../shared/service-status.js';
import type { DesktopBridge } from '../shared/desktop-bridge.js';

const unavailable = (): CommandResult => ({
  ok: false,
  code: 'IPC_UNAVAILABLE',
  userMessage: 'The desktop service is unavailable. Try again.',
});

const invoke = async (
  channel: string,
  ...args: readonly unknown[]
): Promise<unknown> => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch {
    return undefined;
  }
};

const bridge = {
  async getServiceSnapshot(): Promise<ServiceFleetSnapshot> {
    const value = await invoke(shellIpcChannels.snapshot);
    return isServiceFleetSnapshot(value) ? value : unavailableServiceSnapshot();
  },
  async restartService(service: unknown): Promise<CommandResult> {
    if (!isServiceKind(service))
      return {
        ok: false,
        code: 'INVALID_SERVICE',
        userMessage: 'Unknown service.',
      };
    const value = await invoke(shellIpcChannels.restart, service);
    return isCommandResult(value) ? value : unavailable();
  },
  onServiceSnapshot: (listener: (snapshot: ServiceFleetSnapshot) => void) => {
    const wrapped = (_event: unknown, snapshot: unknown) => {
      if (isServiceFleetSnapshot(snapshot)) listener(snapshot);
    };
    ipcRenderer.on(shellIpcChannels.subscribe, wrapped);
    return () =>
      ipcRenderer.removeListener(shellIpcChannels.subscribe, wrapped);
  },
  async chooseProjectDirectory(
    purpose: unknown,
  ): Promise<DirectoryDialogResult> {
    if (!isProjectDirectoryPurpose(purpose))
      return {
        ok: false,
        code: 'INVALID_DIRECTORY_PURPOSE',
        userMessage: 'Invalid directory request.',
      };
    const value = await invoke(shellIpcChannels.directory, purpose);
    return isDirectoryDialogResult(value) ? value : unavailable();
  },
  async chooseExportPath(request: unknown): Promise<DirectoryDialogResult> {
    if (!isExportPathRequest(request))
      return {
        ok: false,
        code: 'INVALID_EXPORT_REQUEST',
        userMessage: 'Invalid export request.',
      };
    const value = await invoke(shellIpcChannels.exportPath, request);
    return isDirectoryDialogResult(value) ? value : unavailable();
  },
  async dispatchProject(command: unknown) {
    if (!isProjectCommand(command))
      return {
        ok: false,
        code: 'INVALID_PROJECT_COMMAND',
        userMessage: 'Invalid project command.',
      };
    const value = await invoke(shellIpcChannels.project, command);
    return isProjectCommandResult(value)
      ? value
      : {
          ok: false,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'The desktop service is unavailable. Try again.',
        };
  },
  async dispatchCandidate(command: unknown) {
    if (!isCandidateCommand(command))
      return {
        ok: false,
        code: 'INVALID_CANDIDATE_COMMAND',
        userMessage: 'Invalid Candidate command.',
      };
    const value = await invoke(shellIpcChannels.candidate, command);
    return isCandidateCommandResult(value)
      ? value
      : {
          ok: false,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'The desktop service is unavailable. Try again.',
        };
  },
  async readCandidateState(projectId: unknown) {
    if (!isProjectId(projectId))
      return {
        ok: false as const,
        code: 'INVALID_PROJECT_ID',
        userMessage: 'Invalid project identity.',
      };
    const value = await invoke(shellIpcChannels.candidateState, projectId);
    return isCandidateStateResult(value)
      ? value
      : {
          ok: false as const,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'The desktop service is unavailable. Try again.',
        };
  },
  async readPlaybackSnapshot(projectId: unknown, source: unknown) {
    if (!isProjectId(projectId) || !isPlaybackSnapshotSource(source))
      return {
        ok: false as const,
        code: 'INVALID_PLAYBACK_SOURCE',
        userMessage: 'Invalid playback source.',
      };
    const value = await invoke(
      shellIpcChannels.playbackSnapshot,
      projectId,
      source,
    );
    return isPlaybackSnapshotResult(value)
      ? value
      : {
          ok: false as const,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'The desktop service is unavailable. Try again.',
        };
  },
  onCandidateEvent: (
    listener: (notification: CoreCandidateEventNotification) => void,
  ) => {
    const wrapped = (_event: unknown, notification: unknown) => {
      if (isCandidateEventNotification(notification)) listener(notification);
    };
    ipcRenderer.on(shellIpcChannels.candidateEvent, wrapped);
    return () =>
      ipcRenderer.removeListener(shellIpcChannels.candidateEvent, wrapped);
  },
  async dispatchAgent(command: unknown) {
    if (!isAgentCommand(command))
      return {
        ok: false,
        code: 'INVALID_AGENT_COMMAND',
        userMessage: 'Invalid Agent command.',
      };
    const value = await invoke(shellIpcChannels.agent, command);
    return isDesktopAgentCommandResult(value)
      ? value
      : {
          ok: false,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'The desktop service is unavailable. Try again.',
        };
  },
  onAgentEvent: (listener: (event: AgentEvent) => void) => {
    const wrapped = (_event: unknown, event: unknown) => {
      if (isAgentEvent(event)) listener(event);
    };
    ipcRenderer.on(shellIpcChannels.agentEvent, wrapped);
    return () =>
      ipcRenderer.removeListener(shellIpcChannels.agentEvent, wrapped);
  },
  async readCurrentPlayback() {
    const value = await invoke(shellIpcChannels.playback);
    return isCorePlaybackResponse(value) ? value : null;
  },
  async readOperationState(projectId: unknown) {
    if (!isProjectId(projectId))
      return {
        ok: false as const,
        code: 'INVALID_PROJECT_ID',
        userMessage: 'Invalid project identity.',
      };
    const value = await invoke(shellIpcChannels.operationState, projectId);
    return isOperationStateResult(value)
      ? value
      : {
          ok: false as const,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'The desktop service is unavailable. Try again.',
        };
  },
  async dispatchOperation(command: unknown) {
    if (!isOperationControlCommand(command))
      return {
        ok: false as const,
        code: 'INVALID_OPERATION_COMMAND',
        userMessage: 'Invalid operation command.',
      };
    const value = await invoke(shellIpcChannels.operation, command);
    return isOperationControlResult(value)
      ? value
      : {
          ok: false as const,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'The desktop service is unavailable. Try again.',
        };
  },
  onOperationEvent: (
    listener: Parameters<DesktopBridge['onOperationEvent']>[0],
  ) => {
    const wrapped = (_event: unknown, notification: unknown) => {
      if (isCoreOperationEventNotification(notification))
        listener(notification);
    };
    ipcRenderer.on(shellIpcChannels.operationEvent, wrapped);
    return () =>
      ipcRenderer.removeListener(shellIpcChannels.operationEvent, wrapped);
  },
  async prepareCurrentExport() {
    const value = await invoke(shellIpcChannels.exportPrepare);
    return isExportPreparationResult(value)
      ? value
      : {
          ok: false as const,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'Current export preparation is unavailable. Try again.',
        };
  },
  async writeCurrentExport(command: unknown) {
    if (!isExportFileWriteCommand(command))
      return {
        ok: false as const,
        code: 'INVALID_EXPORT_COMMAND',
        userMessage: 'Invalid export command.',
      };
    const value = await invoke(shellIpcChannels.exportWrite, command);
    return isExportFileWriteResult(value)
      ? value
      : {
          ok: false as const,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'The desktop export writer is unavailable. Try again.',
        };
  },
  async readSettings() {
    const value = await invoke(shellIpcChannels.settingsRead);
    return isAgentSettings(value) ? value : null;
  },
  async writeSettings(settings: unknown) {
    if (!isAgentSettings(settings))
      return {
        ok: false as const,
        code: 'INVALID_SETTINGS',
        userMessage: 'Invalid agent settings.',
      };
    const value = await invoke(shellIpcChannels.settingsWrite, settings);
    return isCommandResult(value)
      ? value
      : {
          ok: false as const,
          code: 'IPC_UNAVAILABLE',
          userMessage: 'Settings manager is unavailable.',
        };
  },
} satisfies DesktopBridge;
contextBridge.exposeInMainWorld('agentMusic', bridge);
