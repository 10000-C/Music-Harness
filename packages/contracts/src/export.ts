import type { ProjectId } from './domain.js';
import type { ProjectErrorCode } from './project.js';

export interface PreparedCurrentExport {
  readonly projectId: ProjectId;
  readonly currentRevision: string;
  readonly canonicalAbc: string;
  readonly midiFileBytes: Uint8Array;
}

export interface PrepareCurrentExportCommand {
  readonly type: 'export.prepareCurrent';
  readonly requestId: string;
}

export type ExportCommand = PrepareCurrentExportCommand;

export type ExportErrorCode =
  ProjectErrorCode | 'VALIDATION_FAILED' | 'EXPORT_PREPARATION_FAILED';

export type ExportEvent =
  | {
      readonly type: 'export.prepared';
      readonly requestId: string;
      readonly sequence: number;
      readonly result: PreparedCurrentExport;
    }
  | {
      readonly type: 'export.failed';
      readonly requestId: string;
      readonly sequence: number;
      readonly code: ExportErrorCode;
      readonly message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isExportCommand = (value: unknown): value is ExportCommand =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  value.type === 'export.prepareCurrent' &&
  typeof value.requestId === 'string';
