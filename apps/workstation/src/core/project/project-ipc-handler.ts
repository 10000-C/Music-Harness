import type {
  OpenedProject,
  ProjectCommand,
  ProjectEvent,
} from '@agent-music/contracts';

import { ProjectError } from './project-error.js';

export interface ProjectFoundationPort {
  createProject(projectPath: string): Promise<OpenedProject>;
  openProject(projectPath: string): Promise<OpenedProject>;
  recoverCurrent(): Promise<OpenedProject>;
  saveProjectAs(targetPath: string): Promise<OpenedProject>;
  closeProject(): Promise<void>;
}

export class ProjectIpcHandler {
  private sequence = 0;

  constructor(private readonly foundation: ProjectFoundationPort) {}

  async handle(command: ProjectCommand): Promise<ProjectEvent> {
    const sequence = ++this.sequence;

    try {
      switch (command.type) {
        case 'project.create':
          return this.opened(
            command.requestId,
            sequence,
            await this.foundation.createProject(command.projectPath),
          );
        case 'project.open':
          return this.opened(
            command.requestId,
            sequence,
            await this.foundation.openProject(command.projectPath),
          );
        case 'project.recoverCurrent':
          return this.opened(
            command.requestId,
            sequence,
            await this.foundation.recoverCurrent(),
          );
        case 'project.saveAs':
          return this.opened(
            command.requestId,
            sequence,
            await this.foundation.saveProjectAs(command.targetPath),
          );
        case 'project.close':
          await this.foundation.closeProject();
          return {
            type: 'project.closed',
            requestId: command.requestId,
            sequence,
          };
      }
    } catch (error: unknown) {
      const normalized =
        error instanceof ProjectError
          ? error
          : new ProjectError(
              'PROJECT_INTERNAL_ERROR',
              'Unexpected project failure',
            );

      return {
        type: 'project.failed',
        requestId: command.requestId,
        sequence,
        code: normalized.code,
        message: normalized.message,
      };
    }
  }

  private opened(
    requestId: string,
    sequence: number,
    project: OpenedProject,
  ): ProjectEvent {
    return { type: 'project.opened', requestId, sequence, project };
  }
}
