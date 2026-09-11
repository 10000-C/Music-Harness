import { ipcMain, type BrowserWindow } from 'electron';
import { isServiceKind } from '../shared/service-lifecycle.js';
import {
  isExportPathRequest,
  isProjectDirectoryPurpose,
  isProjectCommand,
  isCandidateCommand,
  isCandidateCommandResult,
  isCorePlaybackResponse,
  isAgentCommand,
  isAgentEvent,
  shellIpcChannels,
} from '../shared/shell-contracts.js';
import { chooseExportPath, chooseProjectDirectory } from './desktop-dialogs.js';
import { isServiceFleetSnapshot } from '../shared/service-status.js';
import type { ServiceSupervisor } from './service-supervisor/index.js';

export const registerShellIpc = (
  window: BrowserWindow,
  supervisor: ServiceSupervisor,
): (() => void) => {
  ipcMain.handle(shellIpcChannels.snapshot, () => supervisor.getSnapshot());
  ipcMain.handle(shellIpcChannels.restart, async (_event, service: unknown) => {
    if (!isServiceKind(service))
      return {
        ok: false,
        code: 'INVALID_SERVICE',
        userMessage: 'Unknown service.',
      };
    try {
      await supervisor.restart(service);
      return { ok: true };
    } catch {
      return {
        ok: false,
        code: 'SERVICE_RESTART_FAILED',
        userMessage: 'The service could not be restarted.',
      };
    }
  });
  ipcMain.handle(
    shellIpcChannels.directory,
    async (_event, purpose: unknown) => {
      if (!isProjectDirectoryPurpose(purpose))
        return {
          ok: false,
          code: 'INVALID_DIRECTORY_PURPOSE',
          userMessage: 'Invalid directory request.',
        };
      try {
        return await chooseProjectDirectory(window, purpose);
      } catch {
        return {
          ok: false,
          code: 'DIRECTORY_DIALOG_FAILED',
          userMessage: 'The directory picker could not be opened.',
        };
      }
    },
  );
  ipcMain.handle(shellIpcChannels.project, async (_event, command: unknown) => {
    if (!isProjectCommand(command)) {
      return {
        ok: false,
        code: 'INVALID_PROJECT_COMMAND',
        userMessage: 'Invalid project command.',
      };
    }
    try {
      return { ok: true, event: await supervisor.dispatchProject(command) };
    } catch {
      return {
        ok: false,
        code: 'CORE_UNAVAILABLE',
        userMessage: 'Music Core is unavailable. Try again.',
      };
    }
  });
  ipcMain.handle(
    shellIpcChannels.candidate,
    async (_event, command: unknown) => {
      if (!isCandidateCommand(command)) {
        return {
          ok: false,
          code: 'INVALID_CANDIDATE_COMMAND',
          userMessage: 'Invalid Candidate command.',
        };
      }
      try {
        const result = {
          ok: true as const,
          events: await supervisor.dispatchCandidate(command),
        };
        return isCandidateCommandResult(result)
          ? result
          : {
              ok: false,
              code: 'CORE_INVALID_RESPONSE',
              userMessage: 'Music Core returned an invalid Candidate result.',
            };
      } catch {
        return {
          ok: false,
          code: 'CORE_UNAVAILABLE',
          userMessage: 'Music Core is unavailable. Try again.',
        };
      }
    },
  );
  ipcMain.handle(shellIpcChannels.playback, async () => {
    try {
      const result = await supervisor.readCurrentPlayback();
      return isCorePlaybackResponse(result) ? result : null;
    } catch {
      return null;
    }
  });
  ipcMain.handle(
    shellIpcChannels.exportPath,
    async (_event, request: unknown) => {
      if (!isExportPathRequest(request))
        return {
          ok: false,
          code: 'INVALID_EXPORT_REQUEST',
          userMessage: 'Invalid export request.',
        };
      try {
        return await chooseExportPath(window, request);
      } catch {
        return {
          ok: false,
          code: 'EXPORT_DIALOG_FAILED',
          userMessage: 'The export picker could not be opened.',
        };
      }
    },
  );
  ipcMain.handle(shellIpcChannels.agent, async (_event, command: unknown) => {
    if (!isAgentCommand(command)) {
      return {
        ok: false,
        code: 'INVALID_AGENT_COMMAND',
        userMessage: 'Invalid Agent command.',
      };
    }
    try {
      const result = await supervisor.dispatchAgent(command);
      return { ok: true, result };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Agent service is unavailable.';
      const code =
        error instanceof Error &&
        'code' in error &&
        typeof (error as { code: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'AGENT_UNAVAILABLE';
      return {
        ok: false,
        code,
        userMessage: message,
      };
    }
  });
  const unsubscribeSnapshot = supervisor.subscribe((snapshot) => {
    if (
      isServiceFleetSnapshot(snapshot) &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed()
    )
      window.webContents.send(shellIpcChannels.subscribe, snapshot);
  });
  const unsubscribeAgent = supervisor.onAgentEvent((event) => {
    if (
      isAgentEvent(event) &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed()
    )
      window.webContents.send(shellIpcChannels.agentEvent, event);
  });
  return () => {
    unsubscribeSnapshot();
    unsubscribeAgent();
    Object.values(shellIpcChannels).forEach((channel) => {
      ipcMain.removeHandler(channel);
    });
  };
};
export { shellIpcChannels as channels };
