import {
  PROJECT_FORMAT_VERSION,
  PROJECT_PPQ,
  TRACK_IDS,
  type ProjectId,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CompositionPipeline,
  CompositionValidationError,
} from '../composition/index.js';
import type { ProjectAuthorityAccess } from '../project/project-authority-access.js';
import { ProjectError } from '../project/project-error.js';
import { ExportPreparation } from './export-preparation.js';

const projectId = '00000000-0000-4000-8000-0000000000a5' as ProjectId;

const createProject = (source: string) => {
  let insideSerializedOperation = false;
  const project = {
    getProjectPath: () => '/project',
    readCleanCurrent: vi.fn(() =>
      Promise.resolve({
        currentRevision: 'C1',
        manifest: {
          formatVersion: PROJECT_FORMAT_VERSION,
          projectId,
          timebase: { ppq: PROJECT_PPQ },
          tracks: TRACK_IDS,
        },
        compositionSource: source,
      }),
    ),
    runSerializedWrite: async <T>(operation: () => Promise<T>): Promise<T> => {
      insideSerializedOperation = true;
      try {
        return await operation();
      } finally {
        insideSerializedOperation = false;
      }
    },
  } satisfies ProjectAuthorityAccess;
  return {
    project,
    isInsideSerializedOperation: () => insideSerializedOperation,
  };
};

describe('ExportPreparation', () => {
  it('returns one revision-bound Current export and compiles after snapshot capture releases serialization', async () => {
    const composition = new CompositionPipeline();
    const source = composition.createInitialComposition();
    const expectedMidi =
      composition.compileFinalCanonical(source).playback.midiDocument.fileBytes;
    const { project, isInsideSerializedOperation } = createProject(source);
    const compileFinal = vi.spyOn(composition, 'compileFinalCanonical');
    compileFinal.mockImplementation((input) => {
      expect(isInsideSerializedOperation()).toBe(false);
      return new CompositionPipeline().compileFinalCanonical(input);
    });
    const preparation = new ExportPreparation(project, composition);

    await expect(preparation.prepareCurrentExport()).resolves.toEqual({
      projectId,
      currentRevision: 'C1',
      canonicalAbc: source,
      midiFileBytes: expectedMidi,
    });
    expect(project.readCleanCurrent).toHaveBeenCalledOnce();
    expect(compileFinal).toHaveBeenCalledOnce();
    expect(compileFinal).toHaveBeenCalledWith(source);
  });
  it('propagates dirty Current rejection without compiling derived output', async () => {
    const composition = new CompositionPipeline();
    const compileFinal = vi.spyOn(composition, 'compileFinalCanonical');
    const project = {
      getProjectPath: () => '/project',
      readCleanCurrent: vi.fn(() =>
        Promise.reject(
          new ProjectError(
            'CURRENT_WORKTREE_DIRTY',
            'Current worktree contains uncommitted changes',
          ),
        ),
      ),
      runSerializedWrite: <T>(operation: () => Promise<T>) => operation(),
    } satisfies ProjectAuthorityAccess;

    await expect(
      new ExportPreparation(project, composition).prepareCurrentExport(),
    ).rejects.toMatchObject({ code: 'CURRENT_WORKTREE_DIRTY' });
    expect(compileFinal).not.toHaveBeenCalled();
  });

  it('fresh-compiles every export request instead of reusing derived MIDI state', async () => {
    const composition = new CompositionPipeline();
    const source = composition.createInitialComposition();
    const { project } = createProject(source);
    const compileFinal = vi.spyOn(composition, 'compileFinalCanonical');
    const preparation = new ExportPreparation(project, composition);

    await preparation.prepareCurrentExport();
    await preparation.prepareCurrentExport();

    expect(project.readCleanCurrent).toHaveBeenCalledTimes(2);
    expect(compileFinal).toHaveBeenCalledTimes(2);
  });

  it('rejects a Current that is canonical but not final-Meter consistent', async () => {
    const composition = new CompositionPipeline();
    const source = composition.canonicalizeExternalInput(`X:1
T:Invalid final meter
M:3/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map((trackId) => `[V:${trackId}] C D E F | G A B c |`).join('\n')}
`).canonicalAbc;
    const { project } = createProject(source);

    await expect(
      new ExportPreparation(project, composition).prepareCurrentExport(),
    ).rejects.toBeInstanceOf(CompositionValidationError);
  });
});
