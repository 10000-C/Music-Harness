import type {
  ExportCommand,
  ExportEvent,
  PreparedCurrentExport,
} from '@agent-music/contracts';

import { CompositionValidationError } from '../composition/index.js';
import { ProjectError } from '../project/project-error.js';

export interface ExportPreparationPort {
  prepareCurrentExport(): Promise<PreparedCurrentExport>;
}

export class ExportIpcHandler {
  private sequence = 0;

  public constructor(private readonly preparation: ExportPreparationPort) {}

  public async handle(command: ExportCommand): Promise<ExportEvent> {
    const sequence = ++this.sequence;

    try {
      return {
        type: 'export.prepared',
        requestId: command.requestId,
        sequence,
        result: await this.preparation.prepareCurrentExport(),
      };
    } catch (error) {
      if (error instanceof ProjectError) {
        return {
          type: 'export.failed',
          requestId: command.requestId,
          sequence,
          code: error.code,
          message: error.message,
        };
      }
      if (error instanceof CompositionValidationError) {
        return {
          type: 'export.failed',
          requestId: command.requestId,
          sequence,
          code: 'VALIDATION_FAILED',
          message: 'Current composition is not exportable',
        };
      }
      return {
        type: 'export.failed',
        requestId: command.requestId,
        sequence,
        code: 'EXPORT_PREPARATION_FAILED',
        message: 'Unexpected export preparation failure',
      };
    }
  }
}
