import type { ProjectCommand, ProjectEvent } from '@agent-music/contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasRequestId = (value: Record<string, unknown>): boolean =>
  typeof value.requestId === 'string' && value.requestId.trim().length > 0;

/** The only project payload accepted across the desktop process boundary. */
export const isProjectCommand = (value: unknown): value is ProjectCommand => {
  if (!isRecord(value) || !hasRequestId(value)) return false;
  switch (value.type) {
    case 'project.create':
    case 'project.open':
      return (
        typeof value.projectPath === 'string' && value.projectPath.length > 0
      );
    case 'project.saveAs':
      return (
        typeof value.targetPath === 'string' && value.targetPath.length > 0
      );
    case 'project.recoverCurrent':
    case 'project.close':
      return Object.keys(value).every((key) =>
        ['type', 'requestId'].includes(key),
      );
    default:
      return false;
  }
};

export const isProjectEvent = (value: unknown): value is ProjectEvent => {
  if (
    !isRecord(value) ||
    !hasRequestId(value) ||
    typeof value.sequence !== 'number'
  )
    return false;
  if (value.type === 'project.closed') return true;
  if (value.type === 'project.failed')
    return typeof value.code === 'string' && typeof value.message === 'string';
  if (value.type !== 'project.opened' || !isRecord(value.project)) return false;
  return (
    typeof value.project.projectId === 'string' &&
    typeof value.project.projectPath === 'string' &&
    typeof value.project.currentRevision === 'string' &&
    (value.project.state === 'ready' ||
      value.project.state === 'recoveryRequired')
  );
};

export type CoreProjectRequest = Readonly<{
  type: 'projectCommand';
  protocolVersion: 1;
  command: ProjectCommand;
}>;

export type CoreProjectResponse = Readonly<{
  type: 'projectEvent';
  protocolVersion: 1;
  event: ProjectEvent;
}>;

export const isCoreProjectResponse = (
  value: unknown,
): value is CoreProjectResponse =>
  isRecord(value) &&
  value.type === 'projectEvent' &&
  value.protocolVersion === 1 &&
  isProjectEvent(value.event);
