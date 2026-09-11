import {
  PROJECT_FORMAT_VERSION,
  PROJECT_PPQ,
  TRACK_IDS,
  type CandidateId,
  type ProjectId,
  type ScopeExtensionRequestId,
  type TaskExecutionEnvelope,
  type TaskId,
  type TaskScope,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CompositionPipeline,
  CompositionValidationError,
} from '../composition/index.js';
import type { ProjectAuthorityAccess } from '../project/project-authority-access.js';
import { ProjectError } from '../project/project-error.js';
import type { CandidateCleanupManagerPort } from './candidate-cleanup.js';
import type {
  CandidateRepository,
  CandidateWorkspace,
} from './candidate-repository.js';
import {
  CandidateTransaction,
  type CandidateControlPort,
} from './candidate-transaction.js';

const projectId = '00000000-0000-4000-8000-000000000050' as ProjectId;
const candidateId = '00000000-0000-4000-8000-000000000051' as CandidateId;
const taskId = '00000000-0000-4000-8000-000000000052' as TaskId;
const scopeRequestId =
  '00000000-0000-4000-8000-000000000053' as ScopeExtensionRequestId;
const initialSource = new CompositionPipeline().createInitialComposition();
const wholeProjectScope: TaskScope = {
  type: 'wholeProject',
  trackIds: TRACK_IDS,
};

const createHarness = (options?: { readonly cleanupFails?: boolean }) => {
  const currentState = { revision: 'C0', dirty: false };
  const serializedWrites = vi.fn();
  const workspace: CandidateWorkspace = {
    candidateId,
    branchName: `candidate/${candidateId}`,
    worktreePath: `/project/.agent-music/worktrees/${candidateId}`,
    baseRevision: 'C0',
  };
  const project = {
    getProjectPath: () => '/project',
    readCleanCurrent: vi.fn(() => {
      if (currentState.dirty) {
        return Promise.reject(
          new ProjectError(
            'CURRENT_WORKTREE_DIRTY',
            'lower-level dirty Current detail',
          ),
        );
      }
      return Promise.resolve({
        currentRevision: currentState.revision,
        manifest: {
          formatVersion: PROJECT_FORMAT_VERSION,
          projectId,
          timebase: { ppq: PROJECT_PPQ },
          tracks: TRACK_IDS,
        },
        compositionSource: initialSource,
      });
    }),
    runSerializedWrite: <T>(operation: () => Promise<T>) => {
      serializedWrites();
      return operation();
    },
  } satisfies ProjectAuthorityAccess;
  const repository = {
    create: vi.fn(() => Promise.resolve(workspace)),
    readAuthority: vi.fn(() =>
      Promise.resolve({
        projectManifestSource: '{}',
        compositionSource: initialSource,
      }),
    ),
    writeComposition: vi.fn(() => Promise.resolve()),
    inspectChanges: vi.fn(() =>
      Promise.resolve({
        compositionChanged: false,
        projectJsonChangedFromBase: false,
        unexpectedPaths: [] as string[],
      }),
    ),
    createCheckpoint: vi.fn(() => Promise.resolve('P1')),
    resetTo: vi.fn(() => Promise.resolve()),
    commitCompositionToCurrent: vi.fn(
      (
        ...args: Parameters<CandidateRepository['commitCompositionToCurrent']>
      ) => {
        void args;
        currentState.revision = 'C1';
        return Promise.resolve('C1');
      },
    ),
    remove: vi.fn(() => Promise.resolve()),
    listCandidateResourceIds: vi.fn(() => Promise.resolve([] as CandidateId[])),
  } satisfies CandidateRepository;
  const cleanup = {
    authorizeAndAttempt: vi.fn(() => {
      if (options?.cleanupFails === true) {
        return Promise.reject(new Error('cleanup failed'));
      }
      return Promise.resolve();
    }),
    reconcile: vi.fn(() =>
      Promise.resolve({
        cleanedCandidateIds: [] as CandidateId[],
        pendingCandidateIds: [] as CandidateId[],
        orphanCandidateIds: [] as CandidateId[],
      }),
    ),
  } satisfies CandidateCleanupManagerPort;
  const ids = [candidateId, taskId, scopeRequestId];
  const composition = new CompositionPipeline();
  const transaction = new CandidateTransaction({
    project,
    composition,
    repository,
    cleanup,
    createId: () => ids.shift() ?? '00000000-0000-4000-8000-000000000099',
    now: () => '2026-08-13T00:00:00.000Z',
  });

  return {
    transaction,
    project,
    repository,
    cleanup,
    workspace,
    currentState,
    composition,
    serializedWrites,
  };
};

const envelopeFor = (
  task: Awaited<ReturnType<CandidateTransaction['startTask']>>,
  overrides: Partial<TaskExecutionEnvelope> = {},
): TaskExecutionEnvelope => ({
  taskId: task.taskId,
  projectId: task.projectId,
  candidateId: task.candidateId,
  baseRevision: task.baseRevision,
  expectedScopeRevision: task.scopeRevision,
  ...overrides,
});

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('CandidateTransaction lifecycle', () => {
  it('creates the first formal Task on a Candidate frozen to clean Current', async () => {
    const { transaction, repository } = createHarness();

    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });

    expect(repository.create).toHaveBeenCalledWith(
      '/project',
      candidateId,
      'C0',
    );
    expect(task).toMatchObject({
      taskId,
      projectId,
      candidateId,
      baseRevision: 'C0',
      scopeRevision: 0,
      state: 'editing',
      candidateState: 'active',
    });
    expect(task.allowedOperations).toEqual([
      'replaceScopedMusic',
      'updateMusicalProperties',
      'resizeComposition',
    ]);
    expect(task).not.toHaveProperty('userIntent');
    expect(task).not.toHaveProperty('modelConfigurationId');
    expect(task).not.toHaveProperty('repairAttempt');
    expect(task).not.toHaveProperty('worktreePath');
    expect(task).not.toHaveProperty('latestCheckpoint');
  });

  it('cancels a first Task back to C0 and ends the empty Candidate', async () => {
    const { transaction, repository, cleanup, workspace } = createHarness();
    await transaction.startTask({ projectId, scope: wholeProjectScope });

    await expect(
      transaction.cancelTask({ projectId, candidateId, taskId }),
    ).resolves.toBeUndefined();
    expect(repository.resetTo).toHaveBeenCalledWith(workspace, 'C0');
    expect(cleanup.authorizeAndAttempt).toHaveBeenCalledWith(
      '/project',
      workspace,
    );
    await expect(transaction.getTaskContext(taskId)).rejects.toMatchObject({
      code: 'TASK_NOT_ACTIVE',
    });
  });

  it('cancels the authoritative Active Task when the Agent process is lost', async () => {
    const { transaction, repository, workspace } = createHarness();
    await transaction.startTask({ projectId, scope: wholeProjectScope });

    await expect(
      (
        transaction as unknown as {
          cancelActiveTaskForAgentLoss(project: ProjectId): Promise<unknown>;
        }
      ).cancelActiveTaskForAgentLoss(projectId),
    ).resolves.toBeUndefined();

    expect(repository.resetTo).toHaveBeenCalledWith(workspace, 'C0');
    await expect(transaction.getTaskContext(taskId)).rejects.toMatchObject({
      code: 'TASK_NOT_ACTIVE',
    });
  });

  it('strong Reject destroys authorization even when physical cleanup fails', async () => {
    const { transaction, cleanup } = createHarness({ cleanupFails: true });
    await transaction.startTask({ projectId, scope: wholeProjectScope });

    await expect(
      transaction.rejectCandidate({ projectId, candidateId }),
    ).resolves.toBeUndefined();
    expect(cleanup.authorizeAndAttempt).toHaveBeenCalledOnce();
    await expect(transaction.getTaskContext(taskId)).rejects.toMatchObject({
      code: 'TASK_NOT_ACTIVE',
    });
  });
});

describe('CandidateTransaction authorization', () => {
  it.each([
    [
      'wrong taskId',
      { taskId: '00000000-0000-4000-8000-000000000061' as TaskId },
      'TASK_NOT_ACTIVE',
    ],
    [
      'wrong projectId',
      { projectId: '00000000-0000-4000-8000-000000000062' as ProjectId },
      'TASK_PROJECT_MISMATCH',
    ],
    [
      'wrong candidateId',
      {
        candidateId: '00000000-0000-4000-8000-000000000063' as CandidateId,
      },
      'TASK_CANDIDATE_MISMATCH',
    ],
    [
      'wrong baseRevision',
      { baseRevision: 'other-base' },
      'TASK_BASE_REVISION_MISMATCH',
    ],
    [
      'old scope revision',
      { expectedScopeRevision: 1 },
      'STALE_SCOPE_REVISION',
    ],
  ])(
    'rejects %s before creating a Scope Extension',
    async (_label, overrides, code) => {
      const { transaction } = createHarness();
      const task = await transaction.startTask({
        projectId,
        scope: {
          type: 'wholeProject',
          trackIds: ['track.drums'],
        },
      });

      await expect(
        transaction.requestScopeExtension({
          envelope: envelopeFor(task, overrides),
          requestedScope: {
            type: 'wholeProject',
            trackIds: ['track.drums', 'track.bass'],
          },
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it('derives operations from the current Scope instead of storing a second permission state', async () => {
    const subset = createHarness();
    const subsetTask = await subset.transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    expect(subsetTask.allowedOperations).toEqual(['replaceScopedMusic']);

    const timed = createHarness();
    const timedTask = await timed.transaction.startTask({
      projectId,
      scope: {
        type: 'timeRange',
        trackIds: TRACK_IDS,
        startTick: 0 as never,
        endTick: 960 as never,
      },
    });
    expect(timedTask.allowedOperations).toEqual(['replaceScopedMusic']);

    const whole = createHarness();
    const wholeTask = await whole.transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    expect(wholeTask.allowedOperations).toEqual([
      'replaceScopedMusic',
      'updateMusicalProperties',
      'resizeComposition',
    ]);
  });

  it('blocks on dirty Current without staling the Candidate', async () => {
    const { transaction, currentState } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const request = {
      envelope: envelopeFor(task),
      requestedScope: {
        type: 'wholeProject' as const,
        trackIds: ['track.drums', 'track.bass'] as const,
      },
    };

    currentState.dirty = true;
    await expect(
      transaction.requestScopeExtension(request),
    ).rejects.toMatchObject({
      code: 'CURRENT_NOT_CLEAN',
    });
    currentState.dirty = false;
    await expect(
      transaction.requestScopeExtension(request),
    ).resolves.toMatchObject({
      fromScopeRevision: 0,
    });
  });

  it('stales the Candidate only when Current moves away from baseRevision', async () => {
    const { transaction, currentState } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const request = {
      envelope: envelopeFor(task),
      requestedScope: {
        type: 'wholeProject' as const,
        trackIds: ['track.drums', 'track.bass'] as const,
      },
    };

    currentState.revision = 'C1';
    await expect(
      transaction.requestScopeExtension(request),
    ).rejects.toMatchObject({
      code: 'CANDIDATE_BASELINE_CHANGED',
    });
    await expect(
      transaction.requestScopeExtension(request),
    ).rejects.toMatchObject({
      code: 'CANDIDATE_STALE',
    });
    await expect(
      transaction.rejectCandidate({ projectId, candidateId }),
    ).resolves.toBeUndefined();
  });

  it('only applies an expanding Scope after the matching pending request is approved', async () => {
    const { transaction } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: {
        type: 'timeRange',
        trackIds: ['track.drums', 'track.bass'],
        startTick: 100 as never,
        endTick: 200 as never,
      },
    });
    const envelope = envelopeFor(task);
    const requestedScope: TaskScope = {
      type: 'timeRange',
      trackIds: ['track.drums', 'track.bass', 'track.guitar'],
      startTick: 50 as never,
      endTick: 250 as never,
    };

    await expect(
      transaction.requestScopeExtension({ envelope, requestedScope }),
    ).resolves.toMatchObject({
      requestId: scopeRequestId,
      fromScopeRevision: 0,
      requestedScope,
      createdAt: '2026-08-13T00:00:00.000Z',
    });
    await expect(
      transaction.requestScopeExtension({ envelope, requestedScope }),
    ).rejects.toMatchObject({ code: 'TASK_SCOPE_EXTENSION_PENDING' });
    await expect(
      transaction.approveScopeExtension({
        taskId,
        requestId:
          '00000000-0000-4000-8000-000000000064' as ScopeExtensionRequestId,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SCOPE_EXTENSION_REQUEST' });

    const approved = await transaction.approveScopeExtension({
      taskId,
      requestId: scopeRequestId,
    });
    expect(approved.scope).toEqual(requestedScope);
    expect(approved.scopeRevision).toBe(1);
    await expect(
      transaction.requestScopeExtension({ envelope, requestedScope }),
    ).rejects.toMatchObject({ code: 'STALE_SCOPE_REVISION' });
    await expect(
      transaction.approveScopeExtension({ taskId, requestId: scopeRequestId }),
    ).rejects.toMatchObject({ code: 'STALE_SCOPE_EXTENSION_REQUEST' });
  });

  it.each([
    [
      'Task cancel',
      async (
        transaction: CandidateTransaction,
        task: Awaited<ReturnType<CandidateTransaction['startTask']>>,
      ) =>
        transaction.cancelTask({
          projectId: task.projectId,
          candidateId: task.candidateId,
          taskId: task.taskId,
        }),
    ],
    [
      'Agent loss',
      async (
        transaction: CandidateTransaction,
        task: Awaited<ReturnType<CandidateTransaction['startTask']>>,
      ) => transaction.cancelActiveTaskForAgentLoss(task.projectId),
    ],
  ])(
    'clears pending Scope Extension with %s by ending the Task',
    async (_name, endTask) => {
      const { transaction } = createHarness();
      const task = await transaction.startTask({
        projectId,
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
      });
      await transaction.requestScopeExtension({
        envelope: envelopeFor(task),
        requestedScope: {
          type: 'wholeProject',
          trackIds: ['track.drums', 'track.bass'],
        },
      });
      expect(
        (await transaction.getTaskContext(task.taskId)).pendingScopeExtension,
      ).toBeDefined();

      await endTask(transaction, task);
      await expect(
        transaction.getTaskContext(task.taskId),
      ).rejects.toMatchObject({
        code: 'TASK_NOT_ACTIVE',
      });
    },
  );

  it('exposes pending Scope Extension in Task context and lets the Agent retract it without changing scopeRevision', async () => {
    const { transaction } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const envelope = envelopeFor(task);
    const requestedScope: TaskScope = {
      type: 'wholeProject',
      trackIds: ['track.drums', 'track.bass'],
    };
    const pending = await transaction.requestScopeExtension({
      envelope,
      requestedScope,
    });

    await expect(
      transaction.getTaskContext(task.taskId),
    ).resolves.toMatchObject({
      scopeRevision: 0,
      pendingScopeExtension: {
        requestId: pending.requestId,
        requestedScope,
        fromScopeRevision: 0,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    });

    const retracted = await transaction.rejectScopeExtension({
      taskId: task.taskId,
      requestId: pending.requestId,
    });
    expect(retracted.scopeRevision).toBe(0);
    expect(retracted.scope).toEqual(task.scope);
    expect(retracted.pendingScopeExtension).toBeUndefined();
    await expect(
      transaction.getTaskContext(task.taskId),
    ).resolves.toMatchObject({
      scopeRevision: 0,
    });
    expect(
      (await transaction.getTaskContext(task.taskId)).pendingScopeExtension,
    ).toBeUndefined();
  });

  it('returns pending request metadata when a write is blocked by Scope Extension', async () => {
    const { transaction } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const envelope = envelopeFor(task);
    const pending = await transaction.requestScopeExtension({
      envelope,
      requestedScope: {
        type: 'wholeProject',
        trackIds: ['track.drums', 'track.bass'],
      },
    });

    await expect(
      transaction.applyScopedMusicChange({
        envelope,
        replacements: [{ trackId: 'track.drums', abc: 'z4 |' }],
      }),
    ).rejects.toMatchObject({
      code: 'TASK_SCOPE_EXTENSION_PENDING',
      details: {
        requestId: pending.requestId,
        requestedScope: pending.requestedScope,
        fromScopeRevision: 0,
        createdAt: pending.createdAt,
      },
    });
  });

  it('accepts timeRange to wholeProject only when the track set is a superset', async () => {
    const { transaction } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: {
        type: 'timeRange',
        trackIds: ['track.drums', 'track.bass'],
        startTick: 100 as never,
        endTick: 200 as never,
      },
    });

    await expect(
      transaction.requestScopeExtension({
        envelope: envelopeFor(task),
        requestedScope: {
          type: 'wholeProject',
          trackIds: ['track.drums', 'track.bass', 'track.guitar'],
        },
      }),
    ).resolves.toMatchObject({ fromScopeRevision: 0 });
  });

  it('rejects Scope shrink or movement and rejection leaves revision unchanged', async () => {
    const shrinking = createHarness();
    const shrinkingTask = await shrinking.transaction.startTask({
      projectId,
      scope: {
        type: 'timeRange',
        trackIds: ['track.drums', 'track.bass'],
        startTick: 100 as never,
        endTick: 200 as never,
      },
    });
    await expect(
      shrinking.transaction.requestScopeExtension({
        envelope: envelopeFor(shrinkingTask),
        requestedScope: {
          type: 'timeRange',
          trackIds: ['track.drums'],
          startTick: 100 as never,
          endTick: 200 as never,
        },
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_EXTENSION_NOT_SUPERSET' });
    await expect(
      shrinking.transaction.requestScopeExtension({
        envelope: envelopeFor(shrinkingTask),
        requestedScope: {
          type: 'timeRange',
          trackIds: ['track.drums', 'track.bass'],
          startTick: 300 as never,
          endTick: 400 as never,
        },
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_EXTENSION_NOT_SUPERSET' });

    const rejecting = createHarness();
    const rejectingTask = await rejecting.transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    await rejecting.transaction.requestScopeExtension({
      envelope: envelopeFor(rejectingTask),
      requestedScope: {
        type: 'wholeProject',
        trackIds: ['track.drums', 'track.bass'],
      },
    });
    const rejected = await rejecting.transaction.rejectScopeExtension({
      taskId,
      requestId: scopeRequestId,
    });
    expect(rejected.scopeRevision).toBe(0);
    expect(rejected.scope).toEqual(rejectingTask.scope);
  });
});

describe('CandidateTransaction A2-backed operations', () => {
  it('allows operation targetScope only when it is contained by Task Scope', async () => {
    const { transaction } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: {
        type: 'timeRange',
        trackIds: ['track.drums'],
        startTick: 0 as never,
        endTick: 3840 as never,
      },
    });
    const envelope = envelopeFor(task);
    await expect(
      transaction.getScopedComposition(envelope, {
        type: 'timeRange',
        trackIds: ['track.drums'],
        startTick: 0 as never,
        endTick: 7680 as never,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_ALLOWED' });
  });

  it('returns A2 scoped composition unchanged after reading Candidate authority', async () => {
    const { transaction, repository, composition } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const expectedCompilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    const expectedScoped = new CompositionPipeline().getScopedComposition(
      expectedCompilation,
      wholeProjectScope,
    );
    const compile = vi
      .spyOn(composition, 'compileCanonical')
      .mockReturnValue(expectedCompilation);
    const getScoped = vi
      .spyOn(composition, 'getScopedComposition')
      .mockReturnValue(expectedScoped);

    await expect(
      transaction.getScopedComposition(envelopeFor(task)),
    ).resolves.toBe(expectedScoped);
    expect(repository.readAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId }),
    );
    expect(compile).toHaveBeenCalledWith(initialSource);
    expect(getScoped).toHaveBeenCalledWith(
      expectedCompilation,
      wholeProjectScope,
    );
  });

  it('keeps scoped reads available while a Scope Extension is pending', async () => {
    const { transaction, composition } = createHarness();
    const scope: TaskScope = {
      type: 'wholeProject',
      trackIds: ['track.drums'],
    };
    const task = await transaction.startTask({ projectId, scope });
    const envelope = envelopeFor(task);
    await transaction.requestScopeExtension({
      envelope,
      requestedScope: {
        type: 'wholeProject',
        trackIds: ['track.drums', 'track.bass'],
      },
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    const expected = new CompositionPipeline().getScopedComposition(
      compilation,
      scope,
    );
    vi.spyOn(composition, 'compileCanonical').mockReturnValue(compilation);
    vi.spyOn(composition, 'getScopedComposition').mockReturnValue(expected);

    await expect(transaction.getScopedComposition(envelope)).resolves.toBe(
      expected,
    );
  });

  it('writes exactly the canonical ABC returned by A2 scoped replacement', async () => {
    const { transaction, repository, composition } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    const nextCompilation = {
      ...compilation,
      canonicalAbc: `${compilation.canonicalAbc}\n% A2 result\n`,
    };
    const compile = vi
      .spyOn(composition, 'compileCanonical')
      .mockReturnValue(compilation);
    const replace = vi
      .spyOn(composition, 'replaceScopedMusic')
      .mockReturnValue({
        changedTrackIds: ['track.drums'],
        compilation: nextCompilation,
      });

    await expect(
      transaction.applyScopedMusicChange({
        envelope: envelopeFor(task),
        replacements: [{ trackId: 'track.drums', abc: 'z4' }],
      }),
    ).resolves.toBe(nextCompilation);
    expect(compile).toHaveBeenCalledWith(initialSource);
    expect(replace).toHaveBeenCalledWith(compilation, wholeProjectScope, [
      { trackId: 'track.drums', abc: 'z4' },
    ]);
    expect(repository.writeComposition).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId }),
      nextCompilation.canonicalAbc,
    );
  });

  it('requires derived updateMusicalProperties permission before calling A2', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const update = vi.spyOn(composition, 'updateMusicalProperties');

    await expect(
      transaction.updateMusicalProperties({
        envelope: envelopeFor(task),
        meter: { numerator: 3, denominator: 4 },
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_ALLOWED' });
    expect(update).not.toHaveBeenCalled();
    expect(repository.writeComposition).not.toHaveBeenCalled();
  });

  it('writes the canonical A2 meter result for wholeProject over all tracks', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    const nextCompilation = {
      ...compilation,
      canonicalAbc: `${compilation.canonicalAbc}\n% meter result\n`,
    };
    vi.spyOn(composition, 'compileCanonical').mockReturnValue(compilation);
    const update = vi
      .spyOn(composition, 'updateMusicalProperties')
      .mockReturnValue({
        compilation: nextCompilation,
      });

    await expect(
      transaction.updateMusicalProperties({
        envelope: envelopeFor(task),
        meter: { numerator: 3, denominator: 4 },
      }),
    ).resolves.toBe(nextCompilation);
    expect(update).toHaveBeenCalledWith(compilation, wholeProjectScope, {
      meter: { numerator: 3, denominator: 4 },
    });
    expect(repository.writeComposition).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId }),
      nextCompilation.canonicalAbc,
    );
  });

  it('delegates resizeComposition only for wholeProject over all tracks', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    const resized = {
      compilation,
      previousMeasureCount: 1,
      targetMeasureCount: 64,
    };
    vi.spyOn(composition, 'compileCanonical').mockReturnValue(compilation);
    const resize = vi
      .spyOn(composition, 'resizeComposition')
      .mockReturnValue(resized);

    await transaction.resizeComposition({
      envelope: envelopeFor(task),
      targetMeasureCount: 64,
    });

    expect(resize).toHaveBeenCalledWith(compilation, wholeProjectScope, 64);
    expect(repository.writeComposition).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId }),
      compilation.canonicalAbc,
    );
  });

  it('blocks Candidate writes while a Scope Extension is pending', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const envelope = envelopeFor(task);
    await transaction.requestScopeExtension({
      envelope,
      requestedScope: {
        type: 'wholeProject',
        trackIds: ['track.drums', 'track.bass'],
      },
    });
    const replace = vi.spyOn(composition, 'replaceScopedMusic');

    await expect(
      transaction.applyScopedMusicChange({
        envelope,
        replacements: [{ trackId: 'track.drums', abc: 'z4' }],
      }),
    ).rejects.toMatchObject({ code: 'TASK_SCOPE_EXTENSION_PENDING' });
    expect(replace).not.toHaveBeenCalled();
    expect(repository.writeComposition).not.toHaveBeenCalled();
  });

  it('returns TASK_BUSY immediately instead of queuing a second ordinary mutation', async () => {
    const { transaction, composition } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    const result = {
      changedTrackIds: ['track.drums'] as const,
      compilation,
    };
    const gate = deferred<typeof result>();
    const replace = vi
      .spyOn(composition, 'replaceScopedMusic')
      .mockReturnValue(gate.promise as never);
    const input = {
      envelope: envelopeFor(task),
      replacements: [{ trackId: 'track.drums' as const, abc: 'z4' }],
    };

    const first = transaction.applyScopedMusicChange(input);
    await vi.waitFor(() => {
      expect(replace).toHaveBeenCalledOnce();
    });
    await expect(
      transaction.applyScopedMusicChange(input),
    ).rejects.toMatchObject({ code: 'TASK_BUSY' });
    expect(replace).toHaveBeenCalledOnce();

    gate.resolve(result);
    await expect(first).resolves.toBe(compilation);
  });

  it('lets Cancel invalidate an A2 computation before it can write', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    const result = {
      changedTrackIds: ['track.drums'] as const,
      compilation,
    };
    const gate = deferred<typeof result>();
    const replace = vi
      .spyOn(composition, 'replaceScopedMusic')
      .mockReturnValue(gate.promise as never);
    const mutation = transaction.applyScopedMusicChange({
      envelope: envelopeFor(task),
      replacements: [{ trackId: 'track.drums', abc: 'z4' }],
    });
    await vi.waitFor(() => {
      expect(replace).toHaveBeenCalledOnce();
    });

    await expect(
      transaction.cancelTask({ projectId, candidateId, taskId }),
    ).resolves.toBeUndefined();
    expect(repository.resetTo).toHaveBeenCalled();
    gate.resolve(result);
    await expect(mutation).rejects.toMatchObject({ code: 'TASK_NOT_ACTIVE' });
    expect(repository.writeComposition).not.toHaveBeenCalled();
  });

  it('rejects Scope Extension requests while an ordinary mutation is in flight', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    vi.spyOn(composition, 'replaceScopedMusic').mockReturnValue({
      changedTrackIds: ['track.drums'],
      compilation,
    });
    const writeGate = deferred<undefined>();
    repository.writeComposition.mockImplementationOnce(() => writeGate.promise);
    const envelope = envelopeFor(task);
    const mutation = transaction.applyScopedMusicChange({
      envelope,
      replacements: [{ trackId: 'track.drums', abc: 'z4' }],
    });
    await vi.waitFor(() => {
      expect(repository.writeComposition).toHaveBeenCalledOnce();
    });

    await expect(
      transaction.requestScopeExtension({
        envelope,
        requestedScope: {
          type: 'wholeProject',
          trackIds: ['track.drums', 'track.bass'],
        },
      }),
    ).rejects.toMatchObject({ code: 'TASK_BUSY' });

    writeGate.resolve(undefined);
    await expect(mutation).resolves.toBe(compilation);
  });

  it('waits for an entered repository write before Cancel resets final state', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    vi.spyOn(composition, 'replaceScopedMusic').mockReturnValue({
      changedTrackIds: ['track.drums'],
      compilation,
    });
    const writeGate = deferred<undefined>();
    repository.writeComposition.mockImplementationOnce(() => writeGate.promise);
    const mutation = transaction.applyScopedMusicChange({
      envelope: envelopeFor(task),
      replacements: [{ trackId: 'track.drums', abc: 'z4' }],
    });
    await vi.waitFor(() => {
      expect(repository.writeComposition).toHaveBeenCalledOnce();
    });

    const cancellation = transaction.cancelTask({
      projectId,
      candidateId,
      taskId,
    });
    await Promise.resolve();
    expect(repository.resetTo).not.toHaveBeenCalled();

    writeGate.resolve(undefined);
    await expect(mutation).rejects.toMatchObject({ code: 'TASK_NOT_ACTIVE' });
    await expect(cancellation).resolves.toBeUndefined();
    expect(repository.resetTo).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId }),
      'C0',
    );
  });

  it('waits for an entered repository write before strong Reject cleans resources', async () => {
    const { transaction, composition, repository, cleanup } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const compilation = new CompositionPipeline().compileCanonical(
      initialSource,
    );
    vi.spyOn(composition, 'replaceScopedMusic').mockReturnValue({
      changedTrackIds: ['track.drums'],
      compilation,
    });
    const writeGate = deferred<undefined>();
    repository.writeComposition.mockImplementationOnce(() => writeGate.promise);
    const mutation = transaction.applyScopedMusicChange({
      envelope: envelopeFor(task),
      replacements: [{ trackId: 'track.drums', abc: 'z4' }],
    });
    await vi.waitFor(() => {
      expect(repository.writeComposition).toHaveBeenCalledOnce();
    });

    const rejection = transaction.rejectCandidate({ projectId, candidateId });
    await Promise.resolve();
    expect(cleanup.authorizeAndAttempt).not.toHaveBeenCalled();

    writeGate.resolve(undefined);
    await expect(mutation).rejects.toMatchObject({ code: 'TASK_NOT_ACTIVE' });
    await expect(rejection).resolves.toBeUndefined();
    expect(cleanup.authorizeAndAttempt).toHaveBeenCalledOnce();
  });

  it('labels current Candidate canonical preflight failures separately from replacement failures', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    vi.spyOn(composition, 'compileCanonical').mockImplementation(() => {
      throw new CompositionValidationError({
        code: 'ABC_NOT_CANONICAL',
        message: 'Current Candidate source is not canonical',
      });
    });
    const replaceScopedMusic = vi.spyOn(composition, 'replaceScopedMusic');

    await expect(
      transaction.applyScopedMusicChange({
        envelope: envelopeFor(task),
        replacements: [{ trackId: 'track.drums', abc: 'C D E F |' }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        phase: 'currentComposition',
        validation: {
          valid: false,
          issues: [
            {
              code: 'ABC_NOT_CANONICAL',
              message: 'Current Candidate source is not canonical',
            },
          ],
        },
      },
    });
    expect(replaceScopedMusic).not.toHaveBeenCalled();
    expect(repository.writeComposition).not.toHaveBeenCalled();
  });

  it('maps replacement validation failures to stable Candidate validation details', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    vi.spyOn(composition, 'replaceScopedMusic').mockImplementation(() => {
      throw new CompositionValidationError({
        code: 'SCOPE_REPLACEMENT_INVALID',
        message: 'Invalid replacement fixture',
      });
    });

    await expect(
      transaction.applyScopedMusicChange({
        envelope: envelopeFor(task),
        replacements: [{ trackId: 'track.drums', abc: 'invalid' }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        phase: 'replacement',
        validation: {
          valid: false,
          issues: [
            {
              code: 'SCOPE_REPLACEMENT_INVALID',
              message: 'Invalid replacement fixture',
            },
          ],
        },
      },
    });
    expect(repository.writeComposition).not.toHaveBeenCalled();
  });
});

describe('CandidateTransaction finishTask', () => {
  it('validates, creates one checkpoint, destroys Task authorization, and reuses Ready Candidate', async () => {
    const { transaction, composition, repository, workspace } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    const finalValidation = vi.spyOn(
      composition,
      'validateFinalMeterConsistency',
    );

    const result = await transaction.finishTask(envelopeFor(task));

    expect(finalValidation).toHaveBeenCalledWith(initialSource);
    expect(repository.inspectChanges).toHaveBeenCalledWith(workspace);
    expect(repository.createCheckpoint).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      candidate: {
        candidateId,
        projectId,
        baseRevision: 'C0',
        state: 'ready',
      },
      validation: { valid: true, issues: [] },
    });
    expect(result).not.toHaveProperty('checkpoint');
    expect(result).not.toHaveProperty('latestCheckpoint');
    await expect(transaction.getTaskContext(task.taskId)).rejects.toMatchObject(
      {
        code: 'TASK_NOT_ACTIVE',
      },
    );

    const secondTask = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    expect(repository.create).toHaveBeenCalledOnce();
    await transaction.cancelTask({
      projectId,
      candidateId,
      taskId: secondTask.taskId,
    });
    expect(repository.resetTo).toHaveBeenLastCalledWith(workspace, 'P1');
  });

  it('keeps Candidate edits and returns Task to editing when final validation fails', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    vi.spyOn(composition, 'compileFinalCanonical').mockImplementation(() => {
      throw new CompositionValidationError({
        code: 'METER_BARLINE_MISMATCH',
        message: 'Final bars do not match meter',
      });
    });

    await expect(
      transaction.finishTask(envelopeFor(task)),
    ).resolves.toMatchObject({
      candidate: { state: 'active' },
      validation: {
        valid: false,
        issues: [{ code: 'METER_BARLINE_MISMATCH' }],
      },
    });
    expect(repository.createCheckpoint).not.toHaveBeenCalled();
    await expect(
      transaction.getTaskContext(task.taskId),
    ).resolves.toMatchObject({
      state: 'editing',
      candidateState: 'active',
    });
  });

  it.each([
    [
      'project.json changed from base',
      {
        compositionChanged: false,
        projectJsonChangedFromBase: true,
        unexpectedPaths: [] as string[],
      },
    ],
    [
      'unexpected Candidate path exists',
      {
        compositionChanged: false,
        projectJsonChangedFromBase: false,
        unexpectedPaths: ['rogue.txt'],
      },
    ],
  ])(
    'rejects finish when %s and leaves Task editable',
    async (_label, changes) => {
      const { transaction, repository } = createHarness();
      repository.inspectChanges.mockResolvedValueOnce(changes);
      const task = await transaction.startTask({
        projectId,
        scope: wholeProjectScope,
      });

      await expect(
        transaction.finishTask(envelopeFor(task)),
      ).rejects.toMatchObject({
        code: 'UNEXPECTED_CANDIDATE_CHANGE',
      });
      expect(repository.createCheckpoint).not.toHaveBeenCalled();
      await expect(
        transaction.getTaskContext(task.taskId),
      ).resolves.toMatchObject({
        state: 'editing',
        candidateState: 'active',
      });
    },
  );

  it('stales Candidate and destroys Active Task when base revision drifts', async () => {
    const { transaction, currentState, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    currentState.revision = 'C1';

    await expect(
      transaction.finishTask(envelopeFor(task)),
    ).rejects.toMatchObject({
      code: 'CANDIDATE_BASELINE_CHANGED',
    });
    expect(repository.createCheckpoint).not.toHaveBeenCalled();
    await expect(
      transaction.finishTask(envelopeFor(task)),
    ).rejects.toMatchObject({
      code: 'CANDIDATE_STALE',
    });
    await expect(
      transaction.startTask({ projectId, scope: wholeProjectScope }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_STALE' });
    await expect(
      transaction.rejectCandidate({ projectId, candidateId }),
    ).resolves.toBeUndefined();
  });

  it('blocks finish while a Scope Extension is pending', async () => {
    const { transaction, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const envelope = envelopeFor(task);
    await transaction.requestScopeExtension({
      envelope,
      requestedScope: {
        type: 'wholeProject',
        trackIds: ['track.drums', 'track.bass'],
      },
    });

    await expect(transaction.finishTask(envelope)).rejects.toMatchObject({
      code: 'TASK_SCOPE_EXTENSION_PENDING',
    });
    expect(repository.createCheckpoint).not.toHaveBeenCalled();
  });
});

describe('CandidateTransaction acceptCandidate', () => {
  it('accepts only a Ready Candidate and rejects Active or stale state', async () => {
    const active = createHarness();
    await active.transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    await expect(
      active.transaction.acceptCandidate({ projectId, candidateId }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_READY' });
    expect(active.repository.commitCompositionToCurrent).not.toHaveBeenCalled();

    const stale = createHarness();
    const staleTask = await stale.transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    stale.currentState.revision = 'C1';
    await expect(
      stale.transaction.requestScopeExtension({
        envelope: envelopeFor(staleTask),
        requestedScope: wholeProjectScope,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_BASELINE_CHANGED' });
    await expect(
      stale.transaction.acceptCandidate({ projectId, candidateId }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_STALE' });
    expect(stale.repository.commitCompositionToCurrent).not.toHaveBeenCalled();
  });

  it('validates Ready Candidate, serializes Current commit, then removes business state', async () => {
    const {
      transaction,
      project,
      repository,
      cleanup,
      serializedWrites,
      currentState,
      workspace,
    } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    await transaction.finishTask(envelopeFor(task));
    repository.inspectChanges.mockClear();
    project.readCleanCurrent.mockClear();

    await expect(
      transaction.acceptCandidate({ projectId, candidateId }),
    ).resolves.toEqual({
      projectId,
      candidateId,
      currentRevision: 'C1',
    });
    expect(repository.inspectChanges).toHaveBeenCalled();
    expect(serializedWrites).toHaveBeenCalledOnce();
    expect(project.readCleanCurrent).toHaveBeenCalled();
    expect(repository.commitCompositionToCurrent).toHaveBeenCalledWith(
      '/project',
      workspace,
      expect.stringContaining(candidateId),
      expect.anything(),
    );
    expect(cleanup.authorizeAndAttempt).toHaveBeenCalledWith(
      '/project',
      workspace,
    );
    expect(currentState.revision).toBe('C1');

    const nextTask = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    expect(nextTask.candidateId).not.toBe(candidateId);
    expect(nextTask.baseRevision).toBe('C1');
    expect(repository.create).toHaveBeenCalledTimes(2);
  });

  it('uses the A2 final compile seam before entering serialized Accept', async () => {
    const { transaction, composition, repository, serializedWrites } =
      createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    await transaction.finishTask(envelopeFor(task));
    const finalCompile = vi
      .spyOn(composition, 'compileFinalCanonical')
      .mockImplementation(() => {
        throw new CompositionValidationError({
          code: 'METER_BARLINE_MISMATCH',
          message: 'Final bars do not match meter',
        });
      });

    await expect(
      transaction.acceptCandidate({ projectId, candidateId }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        validation: {
          issues: [{ code: 'METER_BARLINE_MISMATCH' }],
        },
      },
    });
    expect(finalCompile).toHaveBeenCalledWith(initialSource);
    expect(serializedWrites).not.toHaveBeenCalled();
    expect(repository.commitCompositionToCurrent).not.toHaveBeenCalled();
  });

  it('lets Reject preempt an Accept that has not committed main yet', async () => {
    const { transaction, repository, cleanup, currentState } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    await transaction.finishTask(envelopeFor(task));
    const commitGate = deferred<undefined>();
    repository.commitCompositionToCurrent.mockImplementationOnce(
      (_projectPath, _workspace, _message, ...rest: unknown[]) =>
        new Promise<string>((resolve, reject) => {
          let aborted = false;
          const signal = rest[0] as AbortSignal | undefined;
          signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('accept aborted fixture'));
            },
            { once: true },
          );
          void commitGate.promise.then(() => {
            if (!aborted) {
              currentState.revision = 'C1';
              resolve('C1');
            }
          });
        }),
    );

    const acceptance = transaction.acceptCandidate({ projectId, candidateId });
    await vi.waitFor(() => {
      expect(repository.commitCompositionToCurrent).toHaveBeenCalledOnce();
    });
    const rejection = transaction.rejectCandidate({ projectId, candidateId });
    commitGate.resolve(undefined);

    await expect(rejection).resolves.toBeUndefined();
    await expect(acceptance).rejects.toMatchObject({
      code: 'CANDIDATE_TRANSACTION_FAILED',
    });
    expect(currentState.revision).toBe('C0');
    expect(cleanup.authorizeAndAttempt).toHaveBeenCalledOnce();
  });

  it('keeps Accept authoritative when main commits before Reject can preempt it', async () => {
    const { transaction, repository, currentState } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    await transaction.finishTask(envelopeFor(task));
    const commitGate = deferred<undefined>();
    repository.commitCompositionToCurrent.mockImplementationOnce(
      (_projectPath, _workspace, _message, ...rest: unknown[]) =>
        new Promise<string>((resolve) => {
          const commit = (): void => {
            currentState.revision = 'C1';
            resolve('C1');
          };
          const signal = rest[0] as AbortSignal | undefined;
          signal?.addEventListener('abort', commit, { once: true });
          void commitGate.promise.then(commit);
        }),
    );

    const acceptance = transaction.acceptCandidate({ projectId, candidateId });
    await vi.waitFor(() => {
      expect(repository.commitCompositionToCurrent).toHaveBeenCalledOnce();
    });
    const rejection = transaction.rejectCandidate({ projectId, candidateId });
    commitGate.resolve(undefined);

    await expect(acceptance).resolves.toMatchObject({ currentRevision: 'C1' });
    await expect(rejection).rejects.toMatchObject({
      code: 'CANDIDATE_NOT_FOUND',
    });
    expect(currentState.revision).toBe('C1');
  });

  it('restores Ready state when Current commit fails before linearization', async () => {
    const { transaction, repository, cleanup, currentState } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    await transaction.finishTask(envelopeFor(task));
    repository.commitCompositionToCurrent.mockRejectedValueOnce(
      new Error('pre-commit failure fixture'),
    );

    await expect(
      transaction.acceptCandidate({ projectId, candidateId }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_TRANSACTION_FAILED' });
    expect(currentState.revision).toBe('C0');
    expect(cleanup.authorizeAndAttempt).not.toHaveBeenCalled();

    const retryTask = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    expect(retryTask.candidateId).toBe(candidateId);
    await transaction.cancelTask({
      projectId,
      candidateId,
      taskId: retryTask.taskId,
    });
  });

  it('does not enter serialized Current write when final Ready validation fails', async () => {
    const { transaction, repository, serializedWrites } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    await transaction.finishTask(envelopeFor(task));
    repository.inspectChanges.mockResolvedValueOnce({
      compositionChanged: false,
      projectJsonChangedFromBase: true,
      unexpectedPaths: [],
    });

    await expect(
      transaction.acceptCandidate({ projectId, candidateId }),
    ).rejects.toMatchObject({ code: 'UNEXPECTED_CANDIDATE_CHANGE' });
    expect(serializedWrites).not.toHaveBeenCalled();
    expect(repository.commitCompositionToCurrent).not.toHaveBeenCalled();
  });

  it('keeps Accept successful after commit even when physical cleanup remains pending', async () => {
    const { transaction, repository, cleanup } = createHarness({
      cleanupFails: true,
    });
    const task = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    await transaction.finishTask(envelopeFor(task));

    await expect(
      transaction.acceptCandidate({ projectId, candidateId }),
    ).resolves.toMatchObject({ currentRevision: 'C1' });
    expect(cleanup.authorizeAndAttempt).toHaveBeenCalledOnce();

    const nextTask = await transaction.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    expect(nextTask.candidateId).not.toBe(candidateId);
    expect(repository.create).toHaveBeenCalledTimes(2);
  });
});

describe('CandidateTransaction project-open reconciliation', () => {
  it('normalizes cleanup failures to the stable A3 error boundary', async () => {
    const { transaction, cleanup } = createHarness();
    cleanup.reconcile.mockRejectedValueOnce(
      new Error('filesystem failure fixture'),
    );

    await expect(transaction.reconcileProjectResources()).rejects.toMatchObject(
      {
        code: 'CANDIDATE_TRANSACTION_FAILED',
        message: 'Unable to reconcile Candidate resources',
      },
    );
  });

  it('returns cleanup status IDs without recovering Candidate/Task business state', async () => {
    const { transaction, cleanup, repository } = createHarness();
    cleanup.reconcile.mockResolvedValueOnce({
      cleanedCandidateIds: [
        '00000000-0000-4000-8000-000000000096' as CandidateId,
      ],
      pendingCandidateIds: [
        '00000000-0000-4000-8000-000000000097' as CandidateId,
      ],
      orphanCandidateIds: [
        '00000000-0000-4000-8000-000000000098' as CandidateId,
      ],
    });
    const control: CandidateControlPort = transaction;

    await expect(control.reconcileProjectResources()).resolves.toEqual({
      cleanedCandidateIds: [
        '00000000-0000-4000-8000-000000000096' as CandidateId,
      ],
      pendingCandidateIds: [
        '00000000-0000-4000-8000-000000000097' as CandidateId,
      ],
      orphanCandidateIds: [
        '00000000-0000-4000-8000-000000000098' as CandidateId,
      ],
    });
    expect(cleanup.reconcile).toHaveBeenCalledWith('/project');
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.readAuthority).not.toHaveBeenCalled();

    const taskAfterReconcile = await control.startTask({
      projectId,
      scope: wholeProjectScope,
    });
    expect(taskAfterReconcile.candidateId).toBe(candidateId);
    expect(repository.create).toHaveBeenCalledOnce();
  });
});
