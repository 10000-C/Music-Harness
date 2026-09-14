import ABCJS from 'abcjs';
import type { PreparedCurrentExport, ProjectId } from '@agent-music/contracts';
import {
  isExportFileWriteResult,
  isExportPreparationResult,
  type DesktopExportFormat,
  type ExportFileWriteCommand,
  type ExportFileWriteResult,
  type ExportPreparationResult,
} from '../../shared/export-bridge.js';
import { encodeAudioBufferToWav, type AudioBufferLike } from './wav-encoder.js';

export interface CurrentExportPreparationBridge {
  prepareCurrentExport(): Promise<ExportPreparationResult>;
}

export interface CurrentExportFileBridge {
  writeCurrentExport(
    command: ExportFileWriteCommand,
  ): Promise<ExportFileWriteResult>;
}

export interface CurrentWavRenderer {
  render(canonicalAbc: string, signal?: AbortSignal): Promise<AudioBufferLike>;
}

export type CurrentExportOutcome =
  | Readonly<{
      ok: true;
      path: string;
      bytesWritten: number;
      format: DesktopExportFormat;
      currentRevision: string;
    }>
  | Readonly<{ ok: false; code: string; userMessage: string }>;

export interface CurrentExportAdapter {
  exportCurrent(
    format: DesktopExportFormat,
    path: string,
    signal?: AbortSignal,
  ): Promise<CurrentExportOutcome>;
}

const unavailable = (
  code: string,
  userMessage: string,
): CurrentExportOutcome => ({ ok: false, code, userMessage });

const asWriteOutcome = (
  result: ExportFileWriteResult,
  format: DesktopExportFormat,
  currentRevision: string,
): CurrentExportOutcome =>
  result.ok
    ? {
        ok: true,
        path: result.path,
        bytesWritten: result.bytesWritten,
        format,
        currentRevision,
      }
    : unavailable(result.code, result.userMessage);

const isPreparedForProject = (
  prepared: PreparedCurrentExport,
  projectId: ProjectId,
): boolean => prepared.projectId === projectId;

export const createCurrentExportAdapter = ({
  projectId,
  preparation,
  files,
  wavRenderer,
}: {
  readonly projectId: ProjectId;
  readonly preparation: CurrentExportPreparationBridge;
  readonly files: CurrentExportFileBridge;
  readonly wavRenderer: CurrentWavRenderer;
}): CurrentExportAdapter => {
  let inFlight: Promise<CurrentExportOutcome> | null = null;

  const exportCurrent = (
    format: DesktopExportFormat,
    path: string,
    signal?: AbortSignal,
  ): Promise<CurrentExportOutcome> => {
    if (inFlight !== null) {
      return Promise.resolve(
        unavailable(
          'EXPORT_IN_PROGRESS',
          'Another Current export is already in progress.',
        ),
      );
    }
    const operation = runExport(format, path, signal);
    inFlight = operation;
    return operation.finally(() => {
      if (inFlight === operation) inFlight = null;
    });
  };

  const runExport = async (
    format: DesktopExportFormat,
    path: string,
    signal?: AbortSignal,
  ): Promise<CurrentExportOutcome> => {
    if (signal?.aborted) {
      return unavailable('EXPORT_CANCELLED', 'Export was cancelled.');
    }
    let preparedResult: ExportPreparationResult;
    try {
      preparedResult = await preparation.prepareCurrentExport();
    } catch {
      return unavailable(
        'EXPORT_PREPARATION_FAILED',
        'Current export preparation failed.',
      );
    }
    if (!isExportPreparationResult(preparedResult)) {
      return unavailable(
        'INVALID_EXPORT_PREPARATION',
        'Current export preparation returned invalid data.',
      );
    }
    if (!preparedResult.ok) {
      return unavailable(preparedResult.code, preparedResult.userMessage);
    }
    const prepared = preparedResult.result;
    if (!isPreparedForProject(prepared, projectId)) {
      return unavailable(
        'PROJECT_MISMATCH',
        'Export data belongs to another project.',
      );
    }
    if (signal?.aborted) {
      return unavailable('EXPORT_CANCELLED', 'Export was cancelled.');
    }

    let bytes: Uint8Array;
    try {
      if (format === 'midi') {
        bytes = new Uint8Array(prepared.midiFileBytes);
      } else {
        const audioBuffer = await wavRenderer.render(
          prepared.canonicalAbc,
          signal,
        );
        if (signal?.aborted) {
          return unavailable('EXPORT_CANCELLED', 'Export was cancelled.');
        }
        bytes = encodeAudioBufferToWav(audioBuffer);
      }
    } catch (error: unknown) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return unavailable('EXPORT_CANCELLED', 'Export was cancelled.');
      }
      return unavailable(
        'WAV_RENDER_FAILED',
        format === 'wav'
          ? 'WAV rendering failed. The destination was left unchanged.'
          : 'MIDI export data could not be prepared.',
      );
    }

    const command: ExportFileWriteCommand = {
      type: 'export.writeFile',
      requestId: `export-${crypto.randomUUID()}`,
      projectId,
      currentRevision: prepared.currentRevision,
      format,
      path,
      bytes,
    };
    let result: ExportFileWriteResult;
    try {
      result = await files.writeCurrentExport(command);
    } catch {
      return unavailable(
        'EXPORT_WRITE_FAILED',
        'The export file could not be written.',
      );
    }
    if (!isExportFileWriteResult(result)) {
      return unavailable(
        'INVALID_EXPORT_WRITE_RESULT',
        'The desktop export writer returned invalid data.',
      );
    }
    if (!result.ok) return unavailable(result.code, result.userMessage);
    return asWriteOutcome(result, format, prepared.currentRevision);
  };

  return { exportCurrent };
};

export const createAbcjsWavRenderer = (
  options: {
    readonly soundFontUrl?: string;
  } = {},
): CurrentWavRenderer => ({
  async render(canonicalAbc, signal) {
    if (signal?.aborted)
      throw new DOMException('Export cancelled', 'AbortError');
    const tune = ABCJS.parseOnly(canonicalAbc).at(0);
    if (tune === undefined) throw new Error('Canonical ABC contains no tune.');
    const synth = new ABCJS.synth.CreateSynth();
    await synth.init({
      visualObj: tune,
      ...(options.soundFontUrl === undefined
        ? {}
        : { options: { soundFontUrl: options.soundFontUrl } }),
    });
    if (signal?.aborted)
      throw new DOMException('Export cancelled', 'AbortError');
    await synth.prime();
    const audioBuffer = synth.getAudioBuffer();
    if (audioBuffer === undefined) {
      throw new Error('abcjs did not produce an audio buffer.');
    }
    return audioBuffer;
  },
});
