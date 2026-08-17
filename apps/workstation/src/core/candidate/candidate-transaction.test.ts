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
import { CandidateTransaction } from './candidate-transaction.js';

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
  const workspace: CandidateWorkspace = {
    candidateId,
    branchName: `candidate/${candidateId}`,
    worktreePath: `/project/.agent-music/worktrees/${candidateId}`,
    baseRevision: 'C0',
  };
  const project = {
    getProjectPath: () => '/project',
    readCleanCurrent: vi.fn(async () => {
      if (currentState.dirty) {
        throw new ProjectError(
          'CURRENT_WORKTREE_DIRTY',
          'lower-level dirty Current detail',
        );
      }
      return {
        currentRevision: currentState.revision,
        manifest: {
          formatVersion: PROJECT_FORMAT_VERSION,
          projectId,
          timebase: { ppq: PROJECT_PPQ },
          tracks: TRACK_IDS,
        },
        compositionSource: initialSource,
      };
    }),
    runSerializedWrite: async <T>(operation: () => Promise<T>) => operation(),
  } satisfies ProjectAuthorityAccess;
  const repository = {
    create: vi.fn(async () => workspace),
    readAuthority: vi.fn(async () => ({
      projectManifestSource: '{}',
      compositionSource: initialSource,
    })),
    writeComposition: vi.fn(async () => undefined),
    inspectChanges: vi.fn(async () => ({
      compositionChanged: false,
      projectJsonChangedFromBase: false,
      unexpectedPaths: [],
    })),
    createCheckpoint: vi.fn(async () => 'P1'),
    resetTo: vi.fn(async () => undefined),
    commitCompositionToCurrent: vi.fn(async () => 'C1'),
    remove: vi.fn(async () => undefined),
    listCandidateResourceIds: vi.fn(async () => []),
  } satisfies CandidateRepository;
  const cleanup = {
    authorizeAndAttempt: vi.fn(async () => {
      if (options?.cleanupFails === true) {
        throw new Error('cleanup failed');
      }
    }),
    reconcile: vi.fn(async () => ({
      cleanedCandidateIds: [],
      pendingCandidateIds: [],
      orphanCandidateIds: [],
    })),
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
      'updateGlobalMeter',
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
      'updateGlobalMeter',
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

  it('requires derived updateGlobalMeter permission before calling A2', async () => {
    const { transaction, composition, repository } = createHarness();
    const task = await transaction.startTask({
      projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });
    const update = vi.spyOn(composition, 'updateGlobalMeter');

    await expect(
      transaction.updateGlobalMeter({
        envelope: envelopeFor(task),
        numerator: 3,
        denominator: 4,
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
    const update = vi.spyOn(composition, 'updateGlobalMeter').mockReturnValue({
      compilation: nextCompilation,
    });

    await expect(
      transaction.updateGlobalMeter({
        envelope: envelopeFor(task),
        numerator: 3,
        denominator: 4,
      }),
    ).resolves.toBe(nextCompilation);
    expect(update).toHaveBeenCalledWith(compilation, wholeProjectScope, {
      numerator: 3,
      denominator: 4,
    });
    expect(repository.writeComposition).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId }),
      nextCompilation.canonicalAbc,
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
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
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
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());

    await expect(
      transaction.cancelTask({ projectId, candidateId, taskId }),
    ).resolves.toBeUndefined();
    expect(repository.resetTo).toHaveBeenCalled();
    gate.resolve(result);
    await expect(mutation).rejects.toMatchObject({ code: 'TASK_NOT_ACTIVE' });
    expect(repository.writeComposition).not.toHaveBeenCalled();
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
    const writeGate = deferred<void>();
    repository.writeComposition.mockImplementationOnce(() => writeGate.promise);
    const mutation = transaction.applyScopedMusicChange({
      envelope: envelopeFor(task),
      replacements: [{ trackId: 'track.drums', abc: 'z4' }],
    });
    await vi.waitFor(() =>
      expect(repository.writeComposition).toHaveBeenCalledOnce(),
    );

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
    const writeGate = deferred<void>();
    repository.writeComposition.mockImplementationOnce(() => writeGate.promise);
    const mutation = transaction.applyScopedMusicChange({
      envelope: envelopeFor(task),
      replacements: [{ trackId: 'track.drums', abc: 'z4' }],
    });
    await vi.waitFor(() =>
      expect(repository.writeComposition).toHaveBeenCalledOnce(),
    );

    const rejection = transaction.rejectCandidate({ projectId, candidateId });
    await Promise.resolve();
    expect(cleanup.authorizeAndAttempt).not.toHaveBeenCalled();

    writeGate.resolve(undefined);
    await expect(mutation).rejects.toMatchObject({ code: 'TASK_NOT_ACTIVE' });
    await expect(rejection).resolves.toBeUndefined();
    expect(cleanup.authorizeAndAttempt).toHaveBeenCalledOnce();
  });

  it('maps A2 validation failures to stable Candidate validation details', async () => {
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
    vi.spyOn(composition, 'validateFinalMeterConsistency').mockReturnValue({
      valid: false,
      issues: [
        {
          code: 'METER_BARLINE_MISMATCH',
          message: 'Final bars do not match meter',
        },
      ],
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
