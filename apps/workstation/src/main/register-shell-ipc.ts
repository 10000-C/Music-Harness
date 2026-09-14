import { ipcMain, type BrowserWindow } from 'electron';
import { isServiceKind } from '../shared/service-lifecycle.js';
import { isProjectId } from '../shared/candidate-bridge.js';
import { isPlaybackSnapshotSource } from '../shared/playback-bridge.js';
import {
  isExportPathRequest,
  isProjectDirectoryPurpose,
  isProjectCommand,
  isCandidateCommand,
  isCandidateCommandResult,
  isCandidateEventNotification,
  isCandidateStateResult,
  isPlaybackSnapshotResult,
  isCorePlaybackResponse,
  isAgentCommand,
  isAgentEvent,
  shellIpcChannels,
} from '../shared/shell-contracts.js';
import {
  isExportFileWriteCommand,
  isExportFileWriteResult,
  isPreparedCurrentExport,
} from '../shared/export-bridge.js';
import { isOperationControlCommand } from '../shared/operation-bridge.js';
import { chooseExportPath, chooseProjectDirectory } from './desktop-dialogs.js';
import { AtomicExportFileWriter } from './export-file-writer.js';
import { readAgentSettings, writeAgentSettings } from './settings-manager.js';
import { isServiceFleetSnapshot } from '../shared/service-status.js';
import type { ServiceSupervisor } from './service-supervisor/index.js';
import {
  createProjectSwitchCoordinator,
  type ProjectSwitchAgentPort,
  type ProjectSwitchCorePort,
} from './project-switch-coordinator.js';
import type { ProjectEvent, ProjectId } from '@agent-music/contracts';

const agentExecutionStateRequest = (): string =>
  `agent-state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The only project-switch payload accepted across the desktop boundary. */
const isProjectSwitchRequest = (
  value: unknown,
): value is { readonly projectPath: string } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  typeof (value as { projectPath?: unknown }).projectPath === 'string' &&
  (value as { projectPath: string }).projectPath.length > 0;

export const registerShellIpc = (
  window: BrowserWindow,
  supervisor: ServiceSupervisor,
): (() => void) => {
  const exportFileWriter = new AtomicExportFileWriter();

  /**
   * Main's mirror of the Core-side Active Project path. The supervisor
   * tracks the id from project events; only the source display path needs
   * a second field for switch prompts.
   */
  let activeSourceProjectPath = '';

  const dispatchProjectTracked = async (
    command: Parameters<ServiceSupervisor['dispatchProject']>[0],
  ) => {
    const event = await supervisor.dispatchProject(command);
    if (event.type === 'project.opened') {
      activeSourceProjectPath = event.project.projectPath;
    } else if (event.type === 'project.closed') {
      activeSourceProjectPath = '';
    }
    return event;
  };

  /**
   * Agent seam for the destructive Project switch ordering. The Agent
   * process owns the running execution and Active Task state, so the
   * coordinator asks it instead of tracking a second copy in Main.
   */
  const switchAgentPort: ProjectSwitchAgentPort = {
    async hasRunningExecution(projectId) {
      const result = await supervisor.dispatchAgent({
        type: 'agent.execution.state',
        requestId: agentExecutionStateRequest(),
        projectId,
      });
      return result.type === 'agent.execution.stateReported' && result.running;
    },
    async hasActiveTask(projectId) {
      const result = await supervisor.dispatchAgent({
        type: 'agent.execution.state',
        requestId: agentExecutionStateRequest(),
        projectId,
      });
      return (
        result.type === 'agent.execution.stateReported' && result.activeTask
      );
    },
    async cancelCurrentExecution(projectId) {
      await supervisor.dispatchAgent({
        type: 'agent.execution.cancel',
        requestId: agentExecutionStateRequest(),
        projectId,
      });
    },
    async waitForExecutionSettled(projectId) {
      for (;;) {
        const result = await supervisor.dispatchAgent({
          type: 'agent.execution.state',
          requestId: agentExecutionStateRequest(),
          projectId,
        });
        if (
          result.type !== 'agent.execution.stateReported' ||
          !result.running
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };

  /** The authoritative opened event from the coordinator's last open. */
  let lastSwitchedOpenEvent: ProjectEvent | null = null;

  const switchCorePort: ProjectSwitchCorePort = {
    async closeProject(projectId: ProjectId) {
      void projectId; // Core closes whichever project is active.
      await dispatchProjectTracked({
        type: 'project.close',
        requestId: `switch-close-${Date.now().toString(36)}`,
      });
    },
    async openProject(projectPath) {
      const event = await dispatchProjectTracked({
        type: 'project.open',
        requestId: `switch-open-${Date.now().toString(36)}`,
        projectPath,
      });
      if (event.type !== 'project.opened') {
        throw new Error(
          event.type === 'project.failed'
            ? event.message
            : 'Project open failed',
        );
      }
      lastSwitchedOpenEvent = event;
      return event.project;
    },
  };

  const switchCoordinator = createProjectSwitchCoordinator(
    switchAgentPort,
    switchCorePort,
  );

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
  ipcMain.handle(shellIpcChannels.exportPrepare, async () => {
    const candidate = supervisor as ServiceSupervisor & {
      prepareCurrentExport?: () => Promise<unknown>;
    };
    if (typeof candidate.prepareCurrentExport !== 'function') {
      return {
        ok: false,
        code: 'A5_UNAVAILABLE',
        userMessage: 'Current export preparation is not ready yet.',
      };
    }
    try {
      const result = await candidate.prepareCurrentExport();
      return isPreparedCurrentExport(result)
        ? { ok: true, result }
        : {
            ok: false,
            code: 'CORE_INVALID_RESPONSE',
            userMessage: 'Music Core returned invalid export data.',
          };
    } catch {
      return {
        ok: false,
        code: 'A5_UNAVAILABLE',
        userMessage: 'Current export preparation is unavailable. Try again.',
      };
    }
  });
  ipcMain.handle(
    shellIpcChannels.exportWrite,
    async (_event, command: unknown) => {
      if (!isExportFileWriteCommand(command)) {
        return {
          ok: false,
          code: 'INVALID_EXPORT_COMMAND',
          userMessage: 'Invalid export command.',
        };
      }
      try {
        const result = await exportFileWriter.write(command);
        const response = { ok: true as const, ...result };
        return isExportFileWriteResult(response)
          ? response
          : {
              ok: false,
              code: 'EXPORT_WRITE_FAILED',
              userMessage: 'The export file could not be written.',
            };
      } catch {
        return {
          ok: false,
          code: 'EXPORT_WRITE_FAILED',
          userMessage: 'The export file could not be written.',
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
      return { ok: true, event: await dispatchProjectTracked(command) };
    } catch {
      return {
        ok: false,
        code: 'CORE_UNAVAILABLE',
        userMessage: 'Music Core is unavailable. Try again.',
      };
    }
  });
  ipcMain.handle(
    shellIpcChannels.projectSwitch,
    async (_event, request: unknown) => {
      if (!isProjectSwitchRequest(request)) {
        return {
          ok: false,
          code: 'INVALID_PROJECT_SWITCH',
          userMessage: 'Invalid project switch request.',
        };
      }
      const sourceProjectId = supervisor.getActiveProjectId();
      if (sourceProjectId === null) {
        return {
          ok: false,
          code: 'PROJECT_SWITCH_NO_SOURCE',
          userMessage: 'No project is open to switch away from.',
        };
      }
      try {
        const result = await switchCoordinator.switchProject({
          source: {
            projectId: sourceProjectId,
            projectPath: activeSourceProjectPath,
          },
          target: { projectPath: request.projectPath },
          confirmed: true,
        });
        if (result.status === 'switched') {
          activeSourceProjectPath = result.project.projectPath;
          const event = lastSwitchedOpenEvent;
          lastSwitchedOpenEvent = null;
          if (event !== null && event.type === 'project.opened') {
            return { ok: true, event };
          }
        }
        return {
          ok: false,
          code: 'PROJECT_SWITCH_FAILED',
          userMessage: 'Project switch failed. The open Project was kept.',
        };
      } catch {
        return {
          ok: false,
          code: 'PROJECT_SWITCH_FAILED',
          userMessage: 'Project switch failed. The open Project was kept.',
        };
      }
    },
  );
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
  ipcMain.handle(
    shellIpcChannels.candidateState,
    async (_event, projectId: unknown) => {
      if (!isProjectId(projectId)) {
        return {
          ok: false,
          code: 'INVALID_PROJECT_ID',
          userMessage: 'Invalid project identity.',
        };
      }
      try {
        const result = {
          ok: true as const,
          state: await supervisor.readCandidateState(projectId),
        };
        return isCandidateStateResult(result)
          ? result
          : {
              ok: false,
              code: 'CORE_INVALID_RESPONSE',
              userMessage: 'Music Core returned invalid Candidate state.',
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
  ipcMain.handle(
    shellIpcChannels.operationState,
    async (_event, projectId: unknown) => {
      if (!isProjectId(projectId)) {
        return {
          ok: false as const,
          code: 'INVALID_PROJECT_ID',
          userMessage: 'Invalid project identity.',
        };
      }
      return {
        ok: true as const,
        state: {
          projectId,
          sequence: 0,
          operations: [],
        },
      };
    },
  );
  ipcMain.handle(
    shellIpcChannels.operation,
    async (_event, command: unknown) => {
      if (!isOperationControlCommand(command)) {
        return {
          ok: false as const,
          code: 'INVALID_OPERATION_COMMAND',
          userMessage: 'Invalid operation command.',
        };
      }
      return {
        ok: false as const,
        code: 'OPERATION_NOT_FOUND',
        userMessage: 'The requested operation was not found.',
      };
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
    shellIpcChannels.playbackSnapshot,
    async (_event, projectId: unknown, source: unknown) => {
      if (!isProjectId(projectId) || !isPlaybackSnapshotSource(source)) {
        return {
          ok: false,
          code: 'INVALID_PLAYBACK_SOURCE',
          userMessage: 'Invalid playback source.',
        };
      }
      try {
        const result = {
          ok: true as const,
          snapshot: await supervisor.readPlaybackSnapshot(projectId, source),
        };
        return isPlaybackSnapshotResult(result)
          ? result
          : {
              ok: false,
              code: 'CORE_INVALID_RESPONSE',
              userMessage: 'Music Core returned invalid playback data.',
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
        error instanceof Error
          ? error.message
          : 'Agent service is unavailable.';
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
  ipcMain.handle(shellIpcChannels.settingsRead, async () => {
    return await readAgentSettings();
  });
  ipcMain.handle(
    shellIpcChannels.settingsWrite,
    async (_event, settings: unknown) => {
      return await writeAgentSettings(settings);
    },
  );
  const forwardSnapshot = (snapshot: unknown) => {
    if (
      isServiceFleetSnapshot(snapshot) &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed()
    ) {
      window.webContents.send(shellIpcChannels.subscribe, snapshot);
    }
  };

  const unsubscribeSnapshot = supervisor.subscribe((snapshot) => {
    forwardSnapshot(snapshot);
  });

  const onDidFinishLoad = () => {
    forwardSnapshot(supervisor.getSnapshot());
  };
  window.webContents.on?.('did-finish-load', onDidFinishLoad);
  const unsubscribeAgent = supervisor.onAgentEvent((event) => {
    if (
      isAgentEvent(event) &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed()
    )
      window.webContents.send(shellIpcChannels.agentEvent, event);
  });
  const unsubscribeCandidate = supervisor.onCandidateEvent((notification) => {
    if (
      isCandidateEventNotification(notification) &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed()
    )
      window.webContents.send(shellIpcChannels.candidateEvent, notification);
  });
  return () => {
    window.webContents.off?.('did-finish-load', onDidFinishLoad);
    unsubscribeSnapshot();
    unsubscribeAgent();
    unsubscribeCandidate();
    Object.values(shellIpcChannels).forEach((channel) => {
      ipcMain.removeHandler(channel);
    });
  };
};
export { shellIpcChannels as channels };
