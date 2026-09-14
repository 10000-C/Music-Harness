import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectId } from '@agent-music/contracts';
import { AtomicExportFileWriter } from './export-file-writer.js';
import type { ExportFileWriteCommand } from '../shared/export-bridge.js';

const projectId = '00000000-0000-4000-8000-000000000601' as ProjectId;

const command = (
  path: string,
  format: 'midi' | 'wav',
  bytes = new Uint8Array([1, 2, 3]),
): ExportFileWriteCommand => ({
  type: 'export.writeFile',
  requestId: 'export-test',
  projectId,
  currentRevision: 'current-1',
  format,
  path,
  bytes,
});

describe('AtomicExportFileWriter', () => {
  it('writes a new export and atomically replaces an existing one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'music-export-'));
    const path = join(root, 'song.mid');
    const writer = new AtomicExportFileWriter();

    await expect(writer.write(command(path, 'midi'))).resolves.toEqual({
      path,
      bytesWritten: 3,
    });
    await expect(readFile(path)).resolves.toEqual(Buffer.from([1, 2, 3]));

    await writer.write(command(path, 'midi', new Uint8Array([9, 8])));
    await expect(readFile(path)).resolves.toEqual(Buffer.from([9, 8]));
  });

  it('rejects a mismatched extension before touching the filesystem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'music-export-'));
    const path = join(root, 'song.txt');
    const writer = new AtomicExportFileWriter();

    await expect(writer.write(command(path, 'wav'))).rejects.toThrow(
      'extension does not match',
    );
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
