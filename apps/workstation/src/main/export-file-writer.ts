import { randomUUID } from 'node:crypto';
import { access, open, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExportFileWriteCommand } from '../shared/export-bridge.js';
import { hasExpectedExportExtension } from '../shared/export-bridge.js';

export interface ExportFileWriter {
  write(command: ExportFileWriteCommand): Promise<{
    readonly path: string;
    readonly bytesWritten: number;
  }>;
}

const targetExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Writes user-selected export files without exposing filesystem access to the
 * Renderer. A temporary sibling plus backup/restore keeps an existing export
 * intact when the replacement fails halfway through.
 */
export class AtomicExportFileWriter implements ExportFileWriter {
  public async write(
    command: ExportFileWriteCommand,
  ): Promise<{ readonly path: string; readonly bytesWritten: number }> {
    const targetPath = resolve(command.path);
    if (!hasExpectedExportExtension(targetPath, command.format)) {
      throw new Error(
        'Export path extension does not match the requested format.',
      );
    }

    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    const backupPath = `${targetPath}.${randomUUID()}.bak`;
    let movedExisting = false;

    try {
      const temporaryFile = await open(temporaryPath, 'wx');
      try {
        await temporaryFile.writeFile(command.bytes);
        await temporaryFile.sync();
      } finally {
        await temporaryFile.close();
      }
      if (await targetExists(targetPath)) {
        await rename(targetPath, backupPath);
        movedExisting = true;
      }
      try {
        await rename(temporaryPath, targetPath);
      } catch (error) {
        if (movedExisting) {
          await rename(backupPath, targetPath).catch(() => undefined);
          movedExisting = false;
        }
        throw error;
      }
      if (movedExisting) {
        await rm(backupPath, { force: true });
      }
      return { path: targetPath, bytesWritten: command.bytes.byteLength };
    } finally {
      await rm(temporaryPath, { force: true });
      if (movedExisting) {
        await rm(backupPath, { force: true });
      }
    }
  }
}
