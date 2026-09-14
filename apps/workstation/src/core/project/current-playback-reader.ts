import {
  canonicalizeExternalAbc,
  compileComposition,
} from '../composition/index.js';
import type { ProjectAuthorityAccess } from './project-authority-access.js';

/**
 * B-owned composition seam: compile exactly the clean Current read through A1
 * authority. It neither writes Current nor exposes Candidate state.
 */
export class CurrentPlaybackReader {
  constructor(private readonly authority: ProjectAuthorityAccess) {}

  async read(): Promise<{
    readonly revision: string;
    readonly compilation: ReturnType<typeof compileComposition>['playback'];
    readonly timeline: ReturnType<
      typeof compileComposition
    >['timelineViewModel'];
  }> {
    const current = await this.authority.readCleanCurrent();
    const compiled = compileComposition(
      canonicalizeExternalAbc(current.compositionSource),
    );
    return {
      revision: current.currentRevision,
      compilation: compiled.playback,
      timeline: compiled.timelineViewModel,
    };
  }
}
