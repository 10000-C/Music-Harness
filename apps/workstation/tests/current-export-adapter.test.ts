import { describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '@agent-music/contracts';
import {
  createCurrentExportAdapter,
  type CurrentWavRenderer,
} from '../src/renderer/export/current-export-adapter.js';
import type {
  ExportFileWriteCommand,
  ExportFileWriteResult,
  ExportPreparationResult,
} from '../src/shared/export-bridge.js';

const projectId = '00000000-0000-4000-8000-000000000501' as ProjectId;

const prepared: ExportPreparationResult = {
  ok: true,
  result: {
    projectId,
    currentRevision: 'current-42',
    canonicalAbc: 'X:1\nT:Export\nM:4/4\nK:C\n[V:track.drums]C |',
    midiFileBytes: new Uint8Array([0x4d, 0x54, 0x68, 0x64]),
  },
};

const createWavRenderer = (): CurrentWavRenderer => ({
  render: vi.fn(async () => ({
    sampleRate: 8,
    length: 2,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([0, 0.5]),
  })),
});

const createAdapter = (
  options: {
    readonly preparation?: ExportPreparationResult;
    readonly write?: (
      command: ExportFileWriteCommand,
    ) => Promise<ExportFileWriteResult | undefined>;
    readonly wavRenderer?: CurrentWavRenderer;
  } = {},
) => {
  const writes: ExportFileWriteCommand[] = [];
  const adapter = createCurrentExportAdapter({
    projectId,
    preparation: {
      prepareCurrentExport: async () => options.preparation ?? prepared,
    },
    files: {
      writeCurrentExport: async (command) => {
        writes.push(command);
        return (
          (await options.write?.(command)) ?? {
            ok: true as const,
            path: command.path,
            bytesWritten: command.bytes.byteLength,
          }
        );
      },
    },
    wavRenderer: options.wavRenderer ?? createWavRenderer(),
  });
  return { adapter, writes };
};

describe('Current export adapter', () => {
  it('prepares a fresh Current snapshot and writes MIDI bytes with revision identity', async () => {
    const { adapter, writes } = createAdapter();
    await expect(
      adapter.exportCurrent('midi', 'D:/exports/song.mid'),
    ).resolves.toEqual({
      ok: true,
      path: 'D:/exports/song.mid',
      bytesWritten: 4,
      format: 'midi',
      currentRevision: 'current-42',
    });
    expect(writes[0]).toMatchObject({
      format: 'midi',
      currentRevision: 'current-42',
      projectId,
    });
    expect(writes[0]?.bytes).toEqual(new Uint8Array([0x4d, 0x54, 0x68, 0x64]));
  });

  it('renders WAV from the same prepared Canonical ABC and keeps the source isolated', async () => {
    const wavRenderer = createWavRenderer();
    const { adapter, writes } = createAdapter({ wavRenderer });
    await expect(
      adapter.exportCurrent('wav', 'D:/exports/song.wav'),
    ).resolves.toMatchObject({
      ok: true,
      format: 'wav',
      currentRevision: 'current-42',
    });
    expect(wavRenderer.render).toHaveBeenCalledWith(
      prepared.result.canonicalAbc,
      undefined,
    );
    expect(writes[0]?.bytes.slice(0, 4)).toEqual(
      new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    );
  });

  it('fails closed for another project, cancellation, malformed preparation, and concurrent exports', async () => {
    const mismatch: ExportPreparationResult = {
      ok: true,
      result: {
        ...prepared.result,
        projectId: '00000000-0000-4000-8000-000000000599' as ProjectId,
      },
    };
    const { adapter } = createAdapter({ preparation: mismatch });
    await expect(
      adapter.exportCurrent('midi', 'D:/exports/song.mid'),
    ).resolves.toEqual({
      ok: false,
      code: 'PROJECT_MISMATCH',
      userMessage: 'Export data belongs to another project.',
    });

    const cancelled = createAdapter().adapter;
    const controller = new AbortController();
    controller.abort();
    await expect(
      cancelled.exportCurrent('wav', 'D:/exports/song.wav', controller.signal),
    ).resolves.toMatchObject({ ok: false, code: 'EXPORT_CANCELLED' });

    const malformed = createAdapter({
      preparation: { ok: true, result: { projectId } } as never,
    }).adapter;
    await expect(
      malformed.exportCurrent('midi', 'D:/exports/song.mid'),
    ).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_EXPORT_PREPARATION',
    });

    let release!: () => void;
    const first = createAdapter({
      write: async () =>
        new Promise((resolve) => {
          release = () => {
            resolve(undefined);
          };
        }),
    });
    const pending = first.adapter.exportCurrent('midi', 'D:/exports/song.mid');
    await expect(
      first.adapter.exportCurrent('midi', 'D:/exports/other.mid'),
    ).resolves.toMatchObject({ ok: false, code: 'EXPORT_IN_PROGRESS' });
    release();
    await pending;
  });
});
