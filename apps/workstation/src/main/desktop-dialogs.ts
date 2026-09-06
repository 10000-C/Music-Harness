import { dialog, type BrowserWindow } from 'electron';
import type {
  DirectoryDialogResult,
  ExportPathRequest,
  FileDialogResult,
  ProjectDirectoryPurpose,
} from '../shared/shell-contracts.js';
export const chooseProjectDirectory = async (
  window: BrowserWindow,
  purpose: ProjectDirectoryPurpose,
): Promise<DirectoryDialogResult> => {
  void purpose;
  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return { ok: true, cancelled: true };
  const path = result.filePaths[0];
  return typeof path === 'string'
    ? { ok: true, path }
    : {
        ok: false,
        code: 'DIALOG_NO_PATH',
        userMessage: 'No directory was selected.',
      };
};
export const chooseExportPath = async (
  window: BrowserWindow,
  request: ExportPathRequest,
): Promise<FileDialogResult> => {
  const result = await dialog.showSaveDialog(window, {
    defaultPath: request.suggestedName,
    filters: [
      { name: request.format.toUpperCase(), extensions: [request.format] },
    ],
  });
  if (result.canceled) return { ok: true, cancelled: true };
  return typeof result.filePath === 'string'
    ? { ok: true, path: result.filePath }
    : {
        ok: false,
        code: 'DIALOG_NO_PATH',
        userMessage: 'No export path was selected.',
      };
};
