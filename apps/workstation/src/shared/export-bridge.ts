import {
  isExportCommand,
  type ExportCommand,
  type ExportEvent,
  type PreparedCurrentExport,
  type ProjectId,
} from '@agent-music/contracts';

export type DesktopExportFormat = 'midi' | 'wav';

export type ExportPreparationResult =
  | Readonly<{ ok: true; result: PreparedCurrentExport }>
  | Readonly<{ ok: false; code: string; userMessage: string }>;

export type CoreExportRequest = Readonly<{
  type: 'exportCommand';
  protocolVersion: 1;
  command: ExportCommand;
}>;

export type CoreExportResponse = Readonly<{
  type: 'exportEvent';
  protocolVersion: 1;
  event: ExportEvent;
}>;

export type ExportFileWriteCommand = Readonly<{
  type: 'export.writeFile';
  requestId: string;
  projectId: ProjectId;
  currentRevision: string;
  format: DesktopExportFormat;
  path: string;
  bytes: Uint8Array;
}>;

export type ExportFileWriteResult =
  | Readonly<{ ok: true; path: string; bytesWritten: number }>
  | Readonly<{ ok: false; code: string; userMessage: string }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const isProjectId = (value: unknown): value is ProjectId =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isByteArray = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array;

const isSequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isExportEvent = (value: unknown): value is ExportEvent => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.requestId) ||
    !isSequence(value.sequence)
  )
    return false;
  if (value.type === 'export.prepared') {
    return isPreparedCurrentExport(value.result);
  }
  return (
    value.type === 'export.failed' &&
    isNonEmptyString(value.code) &&
    isNonEmptyString(value.message)
  );
};

export const isCoreExportRequest = (
  value: unknown,
): value is CoreExportRequest =>
  isRecord(value) &&
  value.type === 'exportCommand' &&
  value.protocolVersion === 1 &&
  Object.keys(value).length === 3 &&
  isExportCommand(value.command);

export const isCoreExportResponse = (
  value: unknown,
): value is CoreExportResponse =>
  isRecord(value) &&
  value.type === 'exportEvent' &&
  value.protocolVersion === 1 &&
  Object.keys(value).length === 3 &&
  isExportEvent(value.event);

export const isPreparedCurrentExport = (
  value: unknown,
): value is PreparedCurrentExport =>
  isRecord(value) &&
  isProjectId(value.projectId) &&
  isNonEmptyString(value.currentRevision) &&
  isNonEmptyString(value.canonicalAbc) &&
  isByteArray(value.midiFileBytes) &&
  value.midiFileBytes.byteLength > 0;

export const isExportPreparationResult = (
  value: unknown,
): value is ExportPreparationResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return isPreparedCurrentExport(value.result);
  return isNonEmptyString(value.code) && isNonEmptyString(value.userMessage);
};

export const isExportFileWriteCommand = (
  value: unknown,
): value is ExportFileWriteCommand =>
  isRecord(value) &&
  value.type === 'export.writeFile' &&
  isNonEmptyString(value.requestId) &&
  isProjectId(value.projectId) &&
  isNonEmptyString(value.currentRevision) &&
  (value.format === 'midi' || value.format === 'wav') &&
  isNonEmptyString(value.path) &&
  isByteArray(value.bytes) &&
  value.bytes.byteLength > 0;

export const isExportFileWriteResult = (
  value: unknown,
): value is ExportFileWriteResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) {
    return (
      isNonEmptyString(value.path) &&
      typeof value.bytesWritten === 'number' &&
      Number.isSafeInteger(value.bytesWritten) &&
      value.bytesWritten > 0
    );
  }
  return isNonEmptyString(value.code) && isNonEmptyString(value.userMessage);
};

export const expectedExportExtension = (
  format: DesktopExportFormat,
): readonly string[] => (format === 'midi' ? ['.mid', '.midi'] : ['.wav']);

export const hasExpectedExportExtension = (
  path: string,
  format: DesktopExportFormat,
): boolean => {
  const normalized = path.trim().toLowerCase();
  return expectedExportExtension(format).some((extension) =>
    normalized.endsWith(extension),
  );
};
