import { TRACK_IDS, type ProjectId } from './domain.js';

export const PROJECT_FORMAT_VERSION = 1 as const;
export const PROJECT_PPQ = 960 as const;

export interface ProjectManifest {
  readonly formatVersion: typeof PROJECT_FORMAT_VERSION;
  readonly projectId: ProjectId;
  readonly timebase: {
    readonly ppq: typeof PROJECT_PPQ;
  };
  readonly tracks: typeof TRACK_IDS;
}

export type ProjectOpenState = 'ready' | 'recoveryRequired';

export interface OpenedProject {
  readonly projectId: ProjectId;
  readonly projectPath: string;
  readonly currentRevision: string;
  readonly state: ProjectOpenState;
  readonly manifest: ProjectManifest;
}

export type ProjectErrorCode =
  | 'PROJECT_ALREADY_OPEN'
  | 'PROJECT_NOT_OPEN'
  | 'PROJECT_DIRECTORY_NOT_EMPTY'
  | 'PROJECT_INVALID'
  | 'PROJECT_WRITE_LOCKED'
  | 'PROJECT_WRITE_LOCK_LOST'
  | 'CURRENT_WORKTREE_DIRTY'
  | 'GIT_OPERATION_FAILED'
  | 'PROJECT_INTERNAL_ERROR';

interface ProjectCommandBase {
  readonly requestId: string;
}

export type ProjectCommand =
  | (ProjectCommandBase & {
      readonly type: 'project.create';
      readonly projectPath: string;
    })
  | (ProjectCommandBase & {
      readonly type: 'project.open';
      readonly projectPath: string;
    })
  | (ProjectCommandBase & { readonly type: 'project.recoverCurrent' })
  | (ProjectCommandBase & {
      readonly type: 'project.saveAs';
      readonly targetPath: string;
    })
  | (ProjectCommandBase & { readonly type: 'project.close' });

export type ProjectEvent =
  | {
      readonly type: 'project.opened';
      readonly requestId: string;
      readonly sequence: number;
      readonly project: OpenedProject;
    }
  | {
      readonly type: 'project.closed';
      readonly requestId: string;
      readonly sequence: number;
    }
  | {
      readonly type: 'project.failed';
      readonly requestId: string;
      readonly sequence: number;
      readonly code: ProjectErrorCode;
      readonly message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isProjectManifest = (value: unknown): value is ProjectManifest => {
  if (!isRecord(value) || Object.keys(value).length !== 4) {
    return false;
  }

  const tracks = value.tracks;
  if (
    value.formatVersion !== PROJECT_FORMAT_VERSION ||
    typeof value.projectId !== 'string' ||
    value.projectId.length === 0 ||
    !isRecord(value.timebase) ||
    Object.keys(value.timebase).length !== 1 ||
    value.timebase.ppq !== PROJECT_PPQ ||
    !Array.isArray(tracks) ||
    tracks.length !== TRACK_IDS.length
  ) {
    return false;
  }

  return TRACK_IDS.every((trackId, index) => tracks[index] === trackId);
};
