import type { ProjectErrorCode } from '@agent-music/contracts';

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;

  constructor(code: ProjectErrorCode, message: string) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
  }
}
