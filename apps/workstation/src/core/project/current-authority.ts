import type { ProjectManifest } from '@agent-music/contracts';

import { GitAdapter } from './git-adapter.js';
import { parseProjectManifest } from './project-manifest.js';
import { ProjectError } from './project-error.js';

export interface CurrentAuthoritySnapshot {
  readonly currentRevision: string;
  readonly manifest: ProjectManifest;
  readonly compositionSource: string;
}

export class CurrentAuthorityReader {
  constructor(private readonly git: GitAdapter) {}

  async readCleanCurrent(
    projectPath: string,
  ): Promise<CurrentAuthoritySnapshot> {
    if ((await this.git.statusPorcelain(projectPath)) !== '') {
      throw new ProjectError(
        'CURRENT_WORKTREE_DIRTY',
        'Current worktree contains uncommitted changes',
      );
    }

    const [currentRevision, manifestSource, compositionSource] =
      await Promise.all([
        this.git.mainRevision(projectPath),
        this.git.readMainFile(projectPath, 'project.json'),
        this.git.readMainFile(projectPath, 'composition.abc'),
      ]);

    return {
      currentRevision,
      manifest: parseProjectManifest(manifestSource),
      compositionSource,
    };
  }

  async restoreCurrent(projectPath: string): Promise<void> {
    await this.git.restoreAuthorityFiles(projectPath);
  }
}
