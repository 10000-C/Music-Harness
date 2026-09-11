import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TRACK_IDS } from '@agent-music/contracts';

import { CompositionPipeline } from '../composition/index.js';
import { GitAdapter } from '../project/git-adapter.js';
import { ProjectFoundation } from '../project/project-foundation.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from '../project/test-support.js';
import { ExportPreparation } from './export-preparation.js';

let parent: string;
const foundations: ProjectFoundation[] = [];

const makeFoundation = (): ProjectFoundation => {
  const foundation = new ProjectFoundation();
  foundations.push(foundation);
  return foundation;
};

beforeEach(async () => {
  parent = await createTemporaryDirectory('a5-export-');
});

afterEach(async () => {
  for (const foundation of foundations.splice(0)) {
    await foundation.closeProject();
  }
  await removeTemporaryDirectory(parent);
});

describe(
  'ExportPreparation real Current integration',
  { concurrent: false },
  () => {
    it('reopens the same Current with identical ABC/MIDI export input and never writes exports', async () => {
      const foundation = makeFoundation();
      const projectPath = join(parent, 'reopen');
      await foundation.createProject(projectPath);
      const current = await foundation.readCleanCurrent();
      await mkdir(join(projectPath, '.agent-music', 'candidate'), {
        recursive: true,
      });
      await Promise.all([
        writeFile(join(projectPath, 'exports', 'existing.mid'), 'keep'),
        writeFile(
          join(projectPath, '.agent-music', 'cache', 'current.mid'),
          'stale midi cache',
        ),
        writeFile(
          join(projectPath, '.agent-music', 'candidate', 'draft.abc'),
          'candidate must not be exported',
        ),
      ]);
      const beforeEntries = await readdir(join(projectPath, 'exports'));

      const first = await new ExportPreparation(
        foundation,
      ).prepareCurrentExport();
      expect(first.canonicalAbc).toBe(current.compositionSource);
      await foundation.closeProject();
      await foundation.openProject(projectPath);
      const second = await new ExportPreparation(
        foundation,
      ).prepareCurrentExport();

      expect(second.projectId).toBe(first.projectId);
      expect(second.currentRevision).toBe(first.currentRevision);
      expect(second.canonicalAbc).toBe(first.canonicalAbc);
      expect(second.midiFileBytes).toEqual(first.midiFileBytes);
      expect(await readdir(join(projectPath, 'exports'))).toEqual(
        beforeEntries,
      );
    });

    it('queues snapshot capture behind a Current commit and returns one coherent new revision', async () => {
      const foundation = makeFoundation();
      const projectPath = join(parent, 'serialized');
      const opened = await foundation.createProject(projectPath);
      const pipeline = new CompositionPipeline();
      const initial = await foundation.readCleanCurrent();
      const updatedSource = pipeline.updateMusicalProperties(
        pipeline.compileCanonical(initial.compositionSource),
        { type: 'wholeProject', trackIds: TRACK_IDS },
        { tempo: { bpm: 100 } },
      ).compilation.canonicalAbc;
      const git = new GitAdapter();
      let releaseMutation: () => void = () => undefined;
      let markDirtyReady: () => void = () => undefined;
      const mutationGate = new Promise<void>((resolve) => {
        releaseMutation = resolve;
      });
      const dirtyReady = new Promise<void>((resolve) => {
        markDirtyReady = resolve;
      });

      const mutation = foundation.runSerializedWrite(async () => {
        await writeFile(join(projectPath, 'composition.abc'), updatedSource);
        markDirtyReady();
        await mutationGate;
        await git.commitAuthorityFiles(projectPath, 'Accepted Current');
      });
      await dirtyReady;

      const readCurrent = vi.spyOn(foundation, 'readCleanCurrent');
      const exportPromise = new ExportPreparation(
        foundation,
      ).prepareCurrentExport();
      await Promise.resolve();
      expect(readCurrent).not.toHaveBeenCalled();

      releaseMutation();
      await mutation;
      const prepared = await exportPromise;

      expect(prepared.projectId).toBe(opened.projectId);
      expect(prepared.currentRevision).not.toBe(initial.currentRevision);
      expect(prepared.canonicalAbc).toBe(updatedSource);
      expect(prepared.midiFileBytes).toEqual(
        pipeline.compileFinalCanonical(updatedSource).playback.midiDocument
          .fileBytes,
      );
    });
  },
);
