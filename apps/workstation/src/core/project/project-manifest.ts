import {
  PROJECT_FORMAT_VERSION,
  PROJECT_PPQ,
  TRACK_IDS,
  isProjectManifest,
  type ProjectId,
  type ProjectManifest,
} from '@agent-music/contracts';

import { ProjectError } from './project-error.js';

export const createProjectManifest = (
  projectId: ProjectId,
): ProjectManifest => ({
  formatVersion: PROJECT_FORMAT_VERSION,
  projectId,
  timebase: { ppq: PROJECT_PPQ },
  tracks: TRACK_IDS,
});

export const parseProjectManifest = (source: string): ProjectManifest => {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ProjectError('PROJECT_INVALID', 'project.json is not valid JSON');
  }

  if (!isProjectManifest(value)) {
    throw new ProjectError(
      'PROJECT_INVALID',
      'project.json has an invalid format',
    );
  }

  return value;
};

export const serializeProjectManifest = (manifest: ProjectManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`;
