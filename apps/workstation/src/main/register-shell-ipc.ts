import { ipcMain, type BrowserWindow } from 'electron';
import { isServiceKind } from './b-contracts/service-lifecycle.js';
import {
  isExportPathRequest,
  isProjectDirectoryPurpose,
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
  const unsubscribe = supervisor.subscribe((snapshot) => {
    if (
      isServiceFleetSnapshot(snapshot) &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed()
    )
      window.webContents.send(shellIpcChannels.subscribe, snapshot);
  });
  return () => {
    unsubscribe();
    Object.values(shellIpcChannels).forEach((channel) => {
      ipcMain.removeHandler(channel);
    });
  };
};
export { shellIpcChannels as channels };
