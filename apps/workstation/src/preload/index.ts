import { contextBridge, ipcRenderer } from 'electron';
import { isServiceKind } from '../shared/service-lifecycle.js';
import {
  isCommandResult,
  isDirectoryDialogResult,
  isExportPathRequest,
  isProjectDirectoryPurpose,
  isProjectCommand,
  isProjectCommandResult,
  isCandidateCommand,
  isCandidateCommandResult,
  isCorePlaybackResponse,
  isAgentCommand,
  isAgentEvent,
  isDesktopAgentCommandResult,
  shellIpcChannels,
  type CommandResult,
  type DirectoryDialogResult,
  type AgentEvent,
} from '../shared/shell-contracts.js';
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
} satisfies DesktopBridge;
contextBridge.exposeInMainWorld('agentMusic', bridge);
