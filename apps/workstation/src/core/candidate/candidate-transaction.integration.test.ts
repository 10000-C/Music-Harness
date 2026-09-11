import {
  TRACK_IDS,
  type CandidateId,
  type TaskId,
  type TaskScope,
  type Tick,
} from '@agent-music/contracts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CompositionPipeline } from '../composition/index.js';
import { ProjectFoundation } from '../project/project-foundation.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from '../project/test-support.js';
import { CandidateCleanupManager } from './candidate-cleanup.js';
import { CandidateGitRepository } from './candidate-repository.js';
import { CandidateTransaction } from './candidate-transaction.js';

const execFileAsync = promisify(execFile);
const candidateId = '00000000-0000-4000-8000-000000000071' as CandidateId;
const task1Id = '00000000-0000-4000-8000-000000000072' as TaskId;
const task2Id = '00000000-0000-4000-8000-000000000073' as TaskId;
const wholeProjectScope: TaskScope = {
  type: 'wholeProject',
  trackIds: TRACK_IDS,
};

const git = async (
  repositoryPath: string,
  ...args: string[]
): Promise<string> =>
  (
    await execFileAsync('git', ['-C', repositoryPath, ...args], {
      encoding: 'utf8',
      windowsHide: true,
    })
  ).stdout.trim();

let parent: string;
let projectPath: string;
let foundation: ProjectFoundation;

beforeEach(async () => {
  parent = await createTemporaryDirectory('a3-transaction-');
  projectPath = join(parent, '音乐 candidate project');
  foundation = new ProjectFoundation();
});

afterEach(async () => {
  await foundation.closeProject();
  await removeTemporaryDirectory(parent);
});

describe(
  'CandidateTransaction real checkpoint integration',
  { concurrent: false },
  () => {
    it('creates one unique allow-empty checkpoint for every successful Task', async () => {
      const created = await foundation.createProject(projectPath);
      const repository = new CandidateGitRepository();
      const transaction = new CandidateTransaction({
        project: foundation,
        composition: new CompositionPipeline(),
        repository,
        cleanup: new CandidateCleanupManager(repository),
        createId: (() => {
          const ids = [candidateId, task1Id, task2Id];
          return () => ids.shift() ?? '00000000-0000-4000-8000-000000000079';
        })(),
        now: () => '2026-08-13T00:00:00.000Z',
      });
      const worktreePath = join(
        projectPath,
        '.agent-music',
        'worktrees',
        candidateId,
      );

      const firstTask = await transaction.startTask({
        projectId: created.projectId,
        scope: wholeProjectScope,
      });
      await expect(
        transaction.finishTask({
          taskId: firstTask.taskId,
          projectId: firstTask.projectId,
          candidateId: firstTask.candidateId,
          baseRevision: firstTask.baseRevision,
          expectedScopeRevision: firstTask.scopeRevision,
        }),
      ).resolves.toMatchObject({ candidate: { state: 'ready' } });
      const checkpoint1 = await git(worktreePath, 'rev-parse', 'HEAD');
      expect(checkpoint1).not.toBe(created.currentRevision);
      expect(await git(projectPath, 'rev-parse', 'main')).toBe(
        created.currentRevision,
      );

      const secondTask = await transaction.startTask({
        projectId: created.projectId,
        scope: wholeProjectScope,
      });
      expect(secondTask.taskId).toBe(task2Id);
      await expect(
        transaction.finishTask({
          taskId: secondTask.taskId,
          projectId: secondTask.projectId,
          candidateId: secondTask.candidateId,
          baseRevision: secondTask.baseRevision,
          expectedScopeRevision: secondTask.scopeRevision,
        }),
      ).resolves.toMatchObject({ candidate: { state: 'ready' } });
      const checkpoint2 = await git(worktreePath, 'rev-parse', 'HEAD');
      expect(checkpoint2).not.toBe(checkpoint1);
      expect(await git(projectPath, 'rev-parse', 'main')).toBe(
        created.currentRevision,
      );

      await transaction.rejectCandidate({
        projectId: created.projectId,
        candidateId,
      });
    });

    it('resizes a one-bar Candidate to 64 bars, fills a bounded sub-scope, and finishes it', async () => {
      const created = await foundation.createProject(projectPath);
      const repository = new CandidateGitRepository();
      const transaction = new CandidateTransaction({
        project: foundation,
        composition: new CompositionPipeline(),
        repository,
        cleanup: new CandidateCleanupManager(repository),
        createId: (() => {
          const ids = [candidateId, task1Id];
          return () => ids.shift() ?? '00000000-0000-4000-8000-000000000079';
        })(),
        now: () => '2026-08-13T00:00:00.000Z',
      });
      const task = await transaction.startTask({
        projectId: created.projectId,
        scope: wholeProjectScope,
      });
      const envelope = {
        taskId: task.taskId,
        projectId: task.projectId,
        candidateId: task.candidateId,
        baseRevision: task.baseRevision,
        expectedScopeRevision: task.scopeRevision,
      };

      const resized = await transaction.resizeComposition({
        envelope,
        targetMeasureCount: 64,
      });
      expect(resized.totalTicks).toBe(245_760);

      const firstEightBars: TaskScope = {
        type: 'timeRange',
        trackIds: TRACK_IDS,
        startTick: 0 as Tick,
        endTick: 30_720 as Tick,
      };
      const scoped = await transaction.getScopedComposition(
        envelope,
        firstEightBars,
      );
      expect(scoped.startTick).toBe(0);
      expect(scoped.endTick).toBe(30_720);

      const eightBars = 'C D E F | '.repeat(8).trim();
      const changed = await transaction.applyScopedMusicChange({
        envelope,
        targetScope: firstEightBars,
        replacements: TRACK_IDS.map((trackId) => ({
          trackId,
          abc: eightBars,
        })),
      });
      expect(changed.totalTicks).toBe(245_760);
      expect(
        changed.tracks[0]?.events.some((event) => event.type === 'note'),
      ).toBe(true);

      await expect(transaction.finishTask(envelope)).resolves.toMatchObject({
        candidate: { state: 'ready' },
        validation: { valid: true },
      });
      expect(await git(projectPath, 'rev-parse', 'main')).toBe(
        created.currentRevision,
      );
    });

    it('creates a unique Current revision for an empty Accept without changing the tree', async () => {
      const created = await foundation.createProject(projectPath);
      const repository = new CandidateGitRepository();
      const transaction = new CandidateTransaction({
        project: foundation,
        composition: new CompositionPipeline(),
        repository,
        cleanup: new CandidateCleanupManager(repository),
        createId: (() => {
          const ids = [candidateId, task1Id];
          return () => ids.shift() ?? '00000000-0000-4000-8000-000000000079';
        })(),
        now: () => '2026-08-13T00:00:00.000Z',
      });
      const currentTree = await git(
        projectPath,
        'rev-parse',
        `${created.currentRevision}^{tree}`,
      );
      const task = await transaction.startTask({
        projectId: created.projectId,
        scope: wholeProjectScope,
      });
      await transaction.finishTask({
        taskId: task.taskId,
        projectId: task.projectId,
        candidateId: task.candidateId,
        baseRevision: task.baseRevision,
        expectedScopeRevision: task.scopeRevision,
      });

      const accepted = await transaction.acceptCandidate({
        projectId: created.projectId,
        candidateId,
      });

      expect(accepted.currentRevision).not.toBe(created.currentRevision);
      expect(await git(projectPath, 'rev-parse', 'main')).toBe(
        accepted.currentRevision,
      );
      expect(
        await git(
          projectPath,
          'rev-parse',
          `${accepted.currentRevision}^{tree}`,
        ),
      ).toBe(currentTree);
      expect(await git(projectPath, 'status', '--porcelain')).toBe('');
    });
  },
);
