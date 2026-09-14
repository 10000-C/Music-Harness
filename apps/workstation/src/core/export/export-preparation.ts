import type { PreparedCurrentExport } from '@agent-music/contracts';

import { CompositionPipeline } from '../composition/index.js';
import type { ProjectAuthorityAccess } from '../project/project-authority-access.js';

export class ExportPreparation {
  public constructor(
    private readonly project: ProjectAuthorityAccess,
    private readonly composition = new CompositionPipeline(),
  ) {}

  public async prepareCurrentExport(): Promise<PreparedCurrentExport> {
    const snapshot = await this.project.runSerializedWrite(() =>
      this.project.readCleanCurrent(),
    );
    const compilation = this.composition.compileFinalCanonical(
      snapshot.compositionSource,
    );

    return {
      projectId: snapshot.manifest.projectId,
      currentRevision: snapshot.currentRevision,
      canonicalAbc: snapshot.compositionSource,
      midiFileBytes: new Uint8Array(
        compilation.playback.midiDocument.fileBytes,
      ),
    };
  }
}
