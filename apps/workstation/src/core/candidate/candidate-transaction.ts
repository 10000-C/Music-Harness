import {
  TRACK_IDS,
  type CandidateId,
  type CandidateOperation,
  type CandidateRecoveryReport,
  type CandidateState,
  type CandidateView,
  type CurrentCommittedResult,
  type FinishTaskResult,
  type PendingScopeExtensionView,
  type ProjectId,
  type ScopeExtensionRequestId,
  type TaskContextView,
  type TaskExecutionEnvelope,
  type TaskId,
  type TaskScope,
  type TaskState,
} from '@agent-music/contracts';

import type {
  CompositionCompilation,
  CompositionPipeline,
  MusicalPropertiesUpdate,
  ScopedComposition,
  TrackReplacement,
} from '../composition/index.js';
import type { ProjectAuthorityAccess } from '../project/project-authority-access.js';
import {
  CandidateError,
  normalizeCandidateError,
  tagCandidateValidationPhase,
} from './candidate-error.js';
import type { CandidateCleanupManagerPort } from './candidate-cleanup.js';
import type {
  CandidateRepository,
  CandidateWorkspace,
} from './candidate-repository.js';

export interface CandidateAgentPort {
  getTaskContext(taskId: TaskId): Promise<TaskContextView>;
  getScopedComposition(
    envelope: TaskExecutionEnvelope,
  ): Promise<ScopedComposition>;
  requestScopeExtension(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly requestedScope: TaskScope;
  }): Promise<PendingScopeExtensionView>;
  applyScopedMusicChange(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly replacements: readonly TrackReplacement[];
  }): Promise<CompositionCompilation>;
  updateMusicalProperties(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly meter?: MusicalPropertiesUpdate['meter'];
    readonly tempo?: MusicalPropertiesUpdate['tempo'];
  }): Promise<CompositionCompilation>;
  finishTask(envelope: TaskExecutionEnvelope): Promise<FinishTaskResult>;
}

export interface CandidateControlPort {
  startTask(input: {
    readonly projectId: ProjectId;
    readonly scope: TaskScope;
  }): Promise<TaskContextView>;
  cancelTask(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
    readonly taskId: TaskId;
  }): Promise<CandidateView | undefined>;
  cancelActiveTaskForAgentLoss(
    projectId: ProjectId,
  ): Promise<CandidateView | undefined>;
  approveScopeExtension(input: {
    readonly taskId: TaskId;
    readonly requestId: ScopeExtensionRequestId;
  }): Promise<TaskContextView>;
  rejectScopeExtension(input: {
    readonly taskId: TaskId;
    readonly requestId: ScopeExtensionRequestId;
  }): Promise<TaskContextView>;
  acceptCandidate(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
  }): Promise<CurrentCommittedResult>;
  rejectCandidate(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
  }): Promise<void>;
  reconcileProjectResources(): Promise<CandidateRecoveryReport>;
}

type Awaitable<T> = T | Promise<T>;

interface CandidateCompositionPort {
  compileCanonical(
    ...args: Parameters<CompositionPipeline['compileCanonical']>
  ): Awaitable<ReturnType<CompositionPipeline['compileCanonical']>>;
  getScopedComposition(
    ...args: Parameters<CompositionPipeline['getScopedComposition']>
  ): Awaitable<ReturnType<CompositionPipeline['getScopedComposition']>>;
  replaceScopedMusic(
    ...args: Parameters<CompositionPipeline['replaceScopedMusic']>
  ): Awaitable<ReturnType<CompositionPipeline['replaceScopedMusic']>>;
  updateMusicalProperties(
    ...args: Parameters<CompositionPipeline['updateMusicalProperties']>
  ): Awaitable<ReturnType<CompositionPipeline['updateMusicalProperties']>>;
  validateFinalMeterConsistency(
    ...args: Parameters<CompositionPipeline['validateFinalMeterConsistency']>
  ): Awaitable<
    ReturnType<CompositionPipeline['validateFinalMeterConsistency']>
  >;
}

export interface CandidateTransactionDependencies {
  readonly project: ProjectAuthorityAccess;
  readonly composition: CandidateCompositionPort;
  readonly repository: CandidateRepository;
  readonly cleanup: CandidateCleanupManagerPort;
  readonly createId: () => string;
  readonly now: () => string;
}

interface PendingScopeExtension {
  readonly requestId: ScopeExtensionRequestId;
  readonly fromScopeRevision: number;
  readonly requestedScope: TaskScope;
}

interface ActiveTask {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly candidateId: CandidateId;
  scope: TaskScope;
  scopeRevision: number;
  readonly taskBaseCheckpoint: string;
  state: TaskState;
  pendingScopeExtension: PendingScopeExtension | undefined;
  readonly createdAt: string;
}

interface CandidateRecord {
  readonly candidateId: CandidateId;
  readonly projectId: ProjectId;
  readonly baseRevision: string;
  readonly workspace: CandidateWorkspace;
  state: CandidateState;
  latestCheckpoint?: string;
  activeTask: ActiveTask | undefined;
  acceptLease: AcceptLease | undefined;
}

interface AcceptLease {
  readonly abortController: AbortController;
  committed: boolean;
  readonly settlement: Promise<void>;
  readonly settle: () => void;
}

interface MutationLease {
  readonly taskId: TaskId;
  writeEntered: boolean;
  readonly settlement: Promise<void>;
  readonly settle: () => void;
}

const hasAllTracks = (scope: TaskScope): boolean =>
  scope.type === 'wholeProject' &&
  scope.trackIds.length === TRACK_IDS.length &&
  TRACK_IDS.every((trackId) => scope.trackIds.includes(trackId));

export class CandidateTransaction
  implements CandidateAgentPort, CandidateControlPort
{
  private candidate: CandidateRecord | undefined;
  private mutationLease: MutationLease | undefined;

  public constructor(
    private readonly dependencies: CandidateTransactionDependencies,
  ) {}

  public async startTask(input: {
    readonly projectId: ProjectId;
    readonly scope: TaskScope;
  }): Promise<TaskContextView> {
    try {
      const existing = this.candidate;
      if (existing !== undefined) {
        if (existing.projectId !== input.projectId) {
          throw new CandidateError(
            'TASK_PROJECT_MISMATCH',
            'Project does not match the active Candidate',
          );
        }
        if (existing.state === 'stale') {
          throw new CandidateError(
            'CANDIDATE_STALE',
            'Candidate baseline is stale',
          );
        }
        if (existing.state !== 'ready' || existing.activeTask !== undefined) {
          throw new CandidateError(
            'CANDIDATE_NOT_READY',
            'Candidate is not ready for a new Task',
          );
        }
        await this.assertCandidateBaseline(existing);
        const task = this.createTask(
          existing,
          input.scope,
          existing.latestCheckpoint ?? existing.baseRevision,
        );
        existing.activeTask = task;
        existing.state = 'active';
        return this.toTaskContextView(existing, task);
      }

      const current = await this.dependencies.project.readCleanCurrent();
      if (current.manifest.projectId !== input.projectId) {
        throw new CandidateError(
          'TASK_PROJECT_MISMATCH',
          'Project does not match the active Current',
        );
      }
      const candidateId = this.dependencies.createId() as CandidateId;
      const workspace = await this.dependencies.repository.create(
        this.dependencies.project.getProjectPath(),
        candidateId,
        current.currentRevision,
      );
      const candidate: CandidateRecord = {
        candidateId,
        projectId: input.projectId,
        baseRevision: current.currentRevision,
        workspace,
        state: 'active',
        activeTask: undefined,
        acceptLease: undefined,
      };
      const task = this.createTask(
        candidate,
        input.scope,
        current.currentRevision,
      );
      candidate.activeTask = task;
      this.candidate = candidate;
      return this.toTaskContextView(candidate, task);
    } catch (error) {
      throw normalizeCandidateError(error, 'Unable to start Candidate Task');
    }
  }

  public getTaskContext(taskId: TaskId): Promise<TaskContextView> {
    try {
      const candidate = this.candidate;
      const task = candidate?.activeTask;
      if (candidate === undefined || task?.taskId !== taskId) {
        throw new CandidateError('TASK_NOT_ACTIVE', 'Task is not active');
      }
      return Promise.resolve(this.toTaskContextView(candidate, task));
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  public async getScopedComposition(
    envelope: TaskExecutionEnvelope,
  ): Promise<ScopedComposition> {
    try {
      const { candidate, task } = await this.guardTaskEnvelope(envelope);
      const authority = await this.dependencies.repository.readAuthority(
        candidate.workspace,
      );
      const compilation = await this.dependencies.composition.compileCanonical(
        authority.compositionSource,
      );
      const scoped = await this.dependencies.composition.getScopedComposition(
        compilation,
        task.scope,
      );
      this.assertTaskStillAuthorized(candidate, task, envelope);
      return scoped;
    } catch (error) {
      throw normalizeCandidateError(
        error,
        'Unable to read Candidate composition',
      );
    }
  }

  public async requestScopeExtension(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly requestedScope: TaskScope;
  }): Promise<PendingScopeExtensionView> {
    this.assertTaskMutationIdle(input.envelope.taskId);
    const { task } = await this.guardTaskEnvelope(input.envelope);
    this.assertTaskMutationIdle(input.envelope.taskId);
    if (task.pendingScopeExtension !== undefined) {
      throw new CandidateError(
        'TASK_SCOPE_EXTENSION_PENDING',
        'A Scope Extension request is already pending',
      );
    }
    if (!this.isScopeSuperset(task.scope, input.requestedScope)) {
      throw new CandidateError(
        'SCOPE_EXTENSION_NOT_SUPERSET',
        'Requested Scope must contain the current Scope',
      );
    }

    const pending: PendingScopeExtension = {
      requestId: this.dependencies.createId() as ScopeExtensionRequestId,
      fromScopeRevision: task.scopeRevision,
      requestedScope: input.requestedScope,
    };
    task.pendingScopeExtension = pending;
    return this.toPendingScopeExtensionView(task, pending);
  }

  public approveScopeExtension(input: {
    readonly taskId: TaskId;
    readonly requestId: ScopeExtensionRequestId;
  }): Promise<TaskContextView> {
    try {
      const { candidate, task } = this.resolveActiveTask(input.taskId);
      const pending = task.pendingScopeExtension;
      if (pending?.requestId !== input.requestId) {
        throw new CandidateError(
          'STALE_SCOPE_EXTENSION_REQUEST',
          'Scope Extension request is no longer current',
        );
      }
      if (
        pending.fromScopeRevision !== task.scopeRevision ||
        !this.isScopeSuperset(task.scope, pending.requestedScope)
      ) {
        throw new CandidateError(
          'STALE_SCOPE_EXTENSION_REQUEST',
          'Scope Extension request was based on stale authorization state',
        );
      }

      task.scope = pending.requestedScope;
      task.scopeRevision += 1;
      task.pendingScopeExtension = undefined;
      return Promise.resolve(this.toTaskContextView(candidate, task));
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  public rejectScopeExtension(input: {
    readonly taskId: TaskId;
    readonly requestId: ScopeExtensionRequestId;
  }): Promise<TaskContextView> {
    try {
      const { candidate, task } = this.resolveActiveTask(input.taskId);
      const pending = task.pendingScopeExtension;
      if (pending?.requestId !== input.requestId) {
        throw new CandidateError(
          'STALE_SCOPE_EXTENSION_REQUEST',
          'Scope Extension request is no longer current',
        );
      }
      if (pending.fromScopeRevision !== task.scopeRevision) {
        throw new CandidateError(
          'STALE_SCOPE_EXTENSION_REQUEST',
          'Scope Extension request was based on a stale Scope revision',
        );
      }

      task.pendingScopeExtension = undefined;
      return Promise.resolve(this.toTaskContextView(candidate, task));
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  public async applyScopedMusicChange(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly replacements: readonly TrackReplacement[];
  }): Promise<CompositionCompilation> {
    return this.runOrdinaryMutation(input.envelope.taskId, async (lease) => {
      const { candidate, task } = await this.guardTaskEnvelope(input.envelope);
      this.assertMutationAllowed(task, 'replaceScopedMusic');
      const authority = await this.dependencies.repository.readAuthority(
        candidate.workspace,
      );
      this.assertTaskStillAuthorized(candidate, task, input.envelope);
      let compilation: CompositionCompilation;
      try {
        compilation = await this.dependencies.composition.compileCanonical(
          authority.compositionSource,
        );
      } catch (error) {
        throw tagCandidateValidationPhase(error, 'currentComposition');
      }
      let result: Awaited<
        ReturnType<CandidateCompositionPort['replaceScopedMusic']>
      >;
      try {
        result = await this.dependencies.composition.replaceScopedMusic(
          compilation,
          task.scope,
          input.replacements,
        );
      } catch (error) {
        throw tagCandidateValidationPhase(error, 'replacement');
      }

      await this.guardTaskEnvelope(input.envelope);
      this.assertMutationAllowed(task, 'replaceScopedMusic');
      this.assertTaskStillAuthorized(candidate, task, input.envelope);
      lease.writeEntered = true;
      await this.dependencies.repository.writeComposition(
        candidate.workspace,
        result.compilation.canonicalAbc,
      );
      this.assertTaskStillAuthorized(candidate, task, input.envelope);
      return result.compilation;
    });
  }

  public async updateMusicalProperties(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly meter?: MusicalPropertiesUpdate['meter'];
    readonly tempo?: MusicalPropertiesUpdate['tempo'];
  }): Promise<CompositionCompilation> {
    return this.runOrdinaryMutation(input.envelope.taskId, async (lease) => {
      const { candidate, task } = await this.guardTaskEnvelope(input.envelope);
      this.assertMutationAllowed(task, 'updateMusicalProperties');
      const authority = await this.dependencies.repository.readAuthority(
        candidate.workspace,
      );
      this.assertTaskStillAuthorized(candidate, task, input.envelope);
      const compilation = await this.dependencies.composition.compileCanonical(
        authority.compositionSource,
      );
      const result =
        await this.dependencies.composition.updateMusicalProperties(
          compilation,
          task.scope,
          {
            ...(input.meter === undefined ? {} : { meter: input.meter }),
            ...(input.tempo === undefined ? {} : { tempo: input.tempo }),
          },
        );

      await this.guardTaskEnvelope(input.envelope);
      this.assertMutationAllowed(task, 'updateMusicalProperties');
      this.assertTaskStillAuthorized(candidate, task, input.envelope);
      lease.writeEntered = true;
      await this.dependencies.repository.writeComposition(
        candidate.workspace,
        result.compilation.canonicalAbc,
      );
      this.assertTaskStillAuthorized(candidate, task, input.envelope);
      return result.compilation;
    });
  }

  public async finishTask(
    envelope: TaskExecutionEnvelope,
  ): Promise<FinishTaskResult> {
    return this.runOrdinaryMutation(envelope.taskId, async (lease) => {
      let candidate: CandidateRecord | undefined;
      let task: ActiveTask | undefined;
      try {
        ({ candidate, task } = await this.guardTaskEnvelope(envelope));
        if (task.pendingScopeExtension !== undefined) {
          throw new CandidateError(
            'TASK_SCOPE_EXTENSION_PENDING',
            'Task cannot finish while a Scope Extension is pending',
          );
        }
        task.state = 'validating';

        const changes = await this.dependencies.repository.inspectChanges(
          candidate.workspace,
        );
        this.assertTaskStillAuthorized(candidate, task, envelope, 'validating');
        if (
          changes.projectJsonChangedFromBase ||
          changes.unexpectedPaths.length > 0
        ) {
          throw new CandidateError(
            'UNEXPECTED_CANDIDATE_CHANGE',
            'Candidate contains unauthorized authority or filesystem changes',
            {
              projectJsonChangedFromBase: changes.projectJsonChangedFromBase,
              unexpectedPaths: changes.unexpectedPaths,
            },
          );
        }

        const authority = await this.dependencies.repository.readAuthority(
          candidate.workspace,
        );
        this.assertTaskStillAuthorized(candidate, task, envelope, 'validating');
        await this.dependencies.composition.compileCanonical(
          authority.compositionSource,
        );
        const validation =
          await this.dependencies.composition.validateFinalMeterConsistency(
            authority.compositionSource,
          );

        await this.assertCandidateBaseline(candidate);
        this.assertTaskStillAuthorized(candidate, task, envelope, 'validating');
        if (!validation.valid) {
          task.state = 'editing';
          return {
            candidate: this.toCandidateView(candidate),
            validation,
          };
        }

        lease.writeEntered = true;
        const checkpoint = await this.dependencies.repository.createCheckpoint(
          candidate.workspace,
          `Finish Task ${task.taskId}`,
        );
        this.assertTaskStillAuthorized(candidate, task, envelope, 'validating');
        candidate.latestCheckpoint = checkpoint;
        candidate.activeTask = undefined;
        candidate.state = 'ready';
        return {
          candidate: this.toCandidateView(candidate),
          validation,
        };
      } catch (error) {
        if (
          task?.state === 'validating' &&
          candidate?.activeTask === task &&
          this.candidate === candidate &&
          candidate.state === 'active'
        ) {
          task.state = 'editing';
        }
        throw error;
      }
    });
  }

  public async cancelTask(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
    readonly taskId: TaskId;
  }): Promise<CandidateView | undefined> {
    const candidate = this.requireCandidate(input.projectId, input.candidateId);
    const task = candidate.activeTask;
    if (task?.taskId !== input.taskId) {
      throw new CandidateError('TASK_NOT_ACTIVE', 'Task is not active');
    }

    const lease = this.mutationLeaseFor(task.taskId);
    candidate.activeTask = undefined;
    try {
      if (lease?.writeEntered === true) {
        await lease.settlement;
      }
      await this.dependencies.repository.resetTo(
        candidate.workspace,
        task.taskBaseCheckpoint,
      );
      if (candidate.latestCheckpoint !== undefined) {
        candidate.state = 'ready';
        return this.toCandidateView(candidate);
      }

      this.candidate = undefined;
      await this.attemptCleanup(candidate);
      return undefined;
    } catch (error) {
      throw normalizeCandidateError(error, 'Unable to cancel Candidate Task');
    }
  }

  public async cancelActiveTaskForAgentLoss(
    projectId: ProjectId,
  ): Promise<CandidateView | undefined> {
    const candidate = this.candidate;
    if (candidate === undefined) {
      return undefined;
    }
    if (candidate.projectId !== projectId) {
      throw new CandidateError(
        'TASK_PROJECT_MISMATCH',
        'Project does not match the active Candidate',
      );
    }
    const task = candidate.activeTask;
    if (task === undefined) {
      return this.toCandidateView(candidate);
    }
    return this.cancelTask({
      projectId,
      candidateId: candidate.candidateId,
      taskId: task.taskId,
    });
  }

  public async acceptCandidate(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
  }): Promise<CurrentCommittedResult> {
    const candidate = this.requireCandidate(input.projectId, input.candidateId);
    if (candidate.state === 'stale') {
      throw new CandidateError(
        'CANDIDATE_STALE',
        'Candidate baseline is stale',
      );
    }
    if (candidate.state !== 'ready' || candidate.activeTask !== undefined) {
      throw new CandidateError(
        'CANDIDATE_NOT_READY',
        'Only a Task-free Ready Candidate can be accepted',
      );
    }

    let acceptLease: AcceptLease | undefined;
    try {
      await this.validateReadyCandidate(candidate);
      this.assertReadyCandidateStillAuthorized(candidate);

      candidate.state = 'accepting';
      acceptLease = this.beginAccept(candidate);
      const currentRevision =
        await this.dependencies.project.runSerializedWrite(async () => {
          await this.assertCandidateBaseline(candidate);
          this.assertAcceptingCandidateStillAuthorized(candidate);
          return this.dependencies.repository.commitCompositionToCurrent(
            this.dependencies.project.getProjectPath(),
            candidate.workspace,
            `Accept Candidate ${candidate.candidateId}`,
            acceptLease?.abortController.signal,
          );
        });

      // Business linearization point: main commit has succeeded.
      acceptLease.committed = true;
      this.candidate = undefined;
      await this.attemptCleanup(candidate);
      return {
        projectId: candidate.projectId,
        candidateId: candidate.candidateId,
        currentRevision,
      };
    } catch (error) {
      if (this.candidate === candidate && candidate.state === 'accepting') {
        candidate.state = 'ready';
      }
      throw normalizeCandidateError(error, 'Unable to accept Candidate');
    } finally {
      if (acceptLease !== undefined) {
        if (candidate.acceptLease === acceptLease) {
          candidate.acceptLease = undefined;
        }
        acceptLease.settle();
      }
    }
  }

  public async rejectCandidate(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
  }): Promise<void> {
    const candidate = this.requireCandidate(input.projectId, input.candidateId);
    const acceptLease =
      candidate.state === 'accepting' ? candidate.acceptLease : undefined;
    const mutationLease = candidate.activeTask
      ? this.mutationLeaseFor(candidate.activeTask.taskId)
      : undefined;

    // Reject linearizes by invalidating Candidate authorization immediately.
    this.candidate = undefined;

    if (acceptLease !== undefined) {
      acceptLease.abortController.abort();
      await acceptLease.settlement;
      if (acceptLease.committed) {
        throw new CandidateError(
          'CANDIDATE_NOT_FOUND',
          'Candidate was already accepted',
        );
      }
    } else if (mutationLease?.writeEntered === true) {
      await mutationLease.settlement;
    }

    await this.attemptCleanup(candidate);
  }

  public async reconcileProjectResources(): Promise<CandidateRecoveryReport> {
    try {
      return await this.dependencies.cleanup.reconcile(
        this.dependencies.project.getProjectPath(),
      );
    } catch (error) {
      throw normalizeCandidateError(
        error,
        'Unable to reconcile Candidate resources',
      );
    }
  }

  private createTask(
    candidate: CandidateRecord,
    scope: TaskScope,
    taskBaseCheckpoint: string,
  ): ActiveTask {
    return {
      taskId: this.dependencies.createId() as TaskId,
      projectId: candidate.projectId,
      candidateId: candidate.candidateId,
      scope,
      scopeRevision: 0,
      taskBaseCheckpoint,
      state: 'editing',
      pendingScopeExtension: undefined,
      createdAt: this.dependencies.now(),
    };
  }

  private requireCandidate(
    projectId: ProjectId,
    candidateId: CandidateId,
  ): CandidateRecord {
    const candidate = this.candidate;
    if (candidate?.candidateId !== candidateId) {
      throw new CandidateError(
        'CANDIDATE_NOT_FOUND',
        'Candidate was not found',
      );
    }
    if (candidate.projectId !== projectId) {
      throw new CandidateError(
        'TASK_PROJECT_MISMATCH',
        'Project does not match the Candidate',
      );
    }
    return candidate;
  }

  private resolveActiveTask(taskId: TaskId): {
    readonly candidate: CandidateRecord;
    readonly task: ActiveTask;
  } {
    const candidate = this.candidate;
    if (candidate?.state === 'stale') {
      throw new CandidateError(
        'CANDIDATE_STALE',
        'Candidate baseline is stale',
      );
    }
    const task = candidate?.activeTask;
    if (candidate === undefined || task?.taskId !== taskId) {
      throw new CandidateError('TASK_NOT_ACTIVE', 'Task is not active');
    }
    return { candidate, task };
  }

  private async guardTaskEnvelope(envelope: TaskExecutionEnvelope): Promise<{
    readonly candidate: CandidateRecord;
    readonly task: ActiveTask;
  }> {
    const candidate = this.candidate;
    if (candidate?.state === 'stale') {
      throw new CandidateError(
        'CANDIDATE_STALE',
        'Candidate baseline is stale',
      );
    }
    const task = candidate?.activeTask;
    if (candidate === undefined || task?.taskId !== envelope.taskId) {
      throw new CandidateError('TASK_NOT_ACTIVE', 'Task is not active');
    }
    if (task.projectId !== envelope.projectId) {
      throw new CandidateError(
        'TASK_PROJECT_MISMATCH',
        'Execution envelope project does not match the active Task',
      );
    }
    if (task.candidateId !== envelope.candidateId) {
      throw new CandidateError(
        'TASK_CANDIDATE_MISMATCH',
        'Execution envelope Candidate does not match the active Task',
      );
    }
    if (candidate.baseRevision !== envelope.baseRevision) {
      throw new CandidateError(
        'TASK_BASE_REVISION_MISMATCH',
        'Execution envelope base revision does not match the Candidate',
      );
    }

    try {
      await this.assertCandidateBaseline(candidate);
    } catch (error) {
      throw normalizeCandidateError(
        error,
        'Unable to verify Candidate baseline',
      );
    }

    if (task.scopeRevision !== envelope.expectedScopeRevision) {
      throw new CandidateError(
        'STALE_SCOPE_REVISION',
        'Execution envelope Scope revision is stale',
      );
    }
    if (candidate.state !== 'active' || task.state !== 'editing') {
      throw new CandidateError('TASK_NOT_ACTIVE', 'Task is not editable');
    }
    this.assertTaskStillAuthorized(candidate, task, envelope);
    return { candidate, task };
  }

  private async assertCandidateBaseline(
    candidate: CandidateRecord,
  ): Promise<void> {
    const current = await this.dependencies.project.readCleanCurrent();
    if (current.currentRevision !== candidate.baseRevision) {
      candidate.state = 'stale';
      candidate.activeTask = undefined;
      throw new CandidateError(
        'CANDIDATE_BASELINE_CHANGED',
        'Current revision no longer matches Candidate baseline',
      );
    }
  }

  private async validateReadyCandidate(
    candidate: CandidateRecord,
  ): Promise<void> {
    await this.assertCandidateBaseline(candidate);
    const changes = await this.dependencies.repository.inspectChanges(
      candidate.workspace,
    );
    if (
      changes.projectJsonChangedFromBase ||
      changes.unexpectedPaths.length > 0
    ) {
      throw new CandidateError(
        'UNEXPECTED_CANDIDATE_CHANGE',
        'Candidate contains unauthorized authority or filesystem changes',
        {
          projectJsonChangedFromBase: changes.projectJsonChangedFromBase,
          unexpectedPaths: changes.unexpectedPaths,
        },
      );
    }

    const authority = await this.dependencies.repository.readAuthority(
      candidate.workspace,
    );
    await this.dependencies.composition.compileCanonical(
      authority.compositionSource,
    );
    const validation =
      await this.dependencies.composition.validateFinalMeterConsistency(
        authority.compositionSource,
      );
    if (!validation.valid) {
      throw new CandidateError(
        'VALIDATION_FAILED',
        'Candidate final validation failed',
        { validation },
      );
    }
  }

  private assertReadyCandidateStillAuthorized(
    candidate: CandidateRecord,
  ): void {
    if (
      this.candidate !== candidate ||
      candidate.state !== 'ready' ||
      candidate.activeTask !== undefined
    ) {
      throw new CandidateError(
        'CANDIDATE_NOT_READY',
        'Candidate changed while final Accept validation was running',
      );
    }
  }

  private assertAcceptingCandidateStillAuthorized(
    candidate: CandidateRecord,
  ): void {
    if (this.candidate !== candidate || candidate.state !== 'accepting') {
      throw new CandidateError(
        'CANDIDATE_NOT_READY',
        'Candidate authorization ended before Current commit',
      );
    }
  }

  private toTaskContextView(
    candidate: CandidateRecord,
    task: ActiveTask,
  ): TaskContextView {
    return {
      taskId: task.taskId,
      projectId: task.projectId,
      candidateId: task.candidateId,
      baseRevision: candidate.baseRevision,
      scope: task.scope,
      scopeRevision: task.scopeRevision,
      state: task.state,
      candidateState: candidate.state,
      allowedOperations: this.deriveAllowedOperations(task.scope),
      trackIds: TRACK_IDS,
      createdAt: task.createdAt,
    };
  }

  private toCandidateView(candidate: CandidateRecord): CandidateView {
    return {
      candidateId: candidate.candidateId,
      projectId: candidate.projectId,
      baseRevision: candidate.baseRevision,
      state: candidate.state,
    };
  }

  private deriveAllowedOperations(
    scope: TaskScope,
  ): readonly CandidateOperation[] {
    const operations: CandidateOperation[] = ['replaceScopedMusic'];
    if (scope.type === 'wholeProject' && hasAllTracks(scope)) {
      operations.push('updateMusicalProperties');
    }
    return operations;
  }

  private assertMutationAllowed(
    task: ActiveTask,
    operation: CandidateOperation,
  ): void {
    if (task.pendingScopeExtension !== undefined) {
      throw new CandidateError(
        'TASK_SCOPE_EXTENSION_PENDING',
        'Candidate writes are blocked while a Scope Extension is pending',
      );
    }
    if (!this.deriveAllowedOperations(task.scope).includes(operation)) {
      throw new CandidateError(
        'OPERATION_NOT_ALLOWED',
        'Operation is not allowed by the current Task Scope',
      );
    }
  }

  private assertTaskStillAuthorized(
    candidate: CandidateRecord,
    task: ActiveTask,
    envelope: TaskExecutionEnvelope,
    expectedState: TaskState = 'editing',
  ): void {
    if (
      this.candidate !== candidate ||
      candidate.activeTask !== task ||
      candidate.state !== 'active' ||
      task.state !== expectedState
    ) {
      throw new CandidateError('TASK_NOT_ACTIVE', 'Task authorization ended');
    }
    if (task.scopeRevision !== envelope.expectedScopeRevision) {
      throw new CandidateError(
        'STALE_SCOPE_REVISION',
        'Execution envelope Scope revision is stale',
      );
    }
  }

  private beginMutation(taskId: TaskId): MutationLease {
    if (this.mutationLease !== undefined) {
      throw new CandidateError(
        'TASK_BUSY',
        'Another Candidate mutation is already active',
      );
    }
    let settle = (): void => undefined;
    const settlement = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const lease: MutationLease = {
      taskId,
      writeEntered: false,
      settlement,
      settle,
    };
    this.mutationLease = lease;
    return lease;
  }

  private beginAccept(candidate: CandidateRecord): AcceptLease {
    let settle = (): void => undefined;
    const settlement = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const lease: AcceptLease = {
      abortController: new AbortController(),
      committed: false,
      settlement,
      settle,
    };
    candidate.acceptLease = lease;
    return lease;
  }

  private mutationLeaseFor(taskId: TaskId): MutationLease | undefined {
    return this.mutationLease?.taskId === taskId
      ? this.mutationLease
      : undefined;
  }

  private assertTaskMutationIdle(taskId: TaskId): void {
    if (this.mutationLeaseFor(taskId) !== undefined) {
      throw new CandidateError(
        'TASK_BUSY',
        'Another Candidate mutation is already active',
      );
    }
  }

  private async runOrdinaryMutation<T>(
    taskId: TaskId,
    operation: (lease: MutationLease) => Promise<T>,
  ): Promise<T> {
    const lease = this.beginMutation(taskId);
    try {
      return await operation(lease);
    } catch (error) {
      throw normalizeCandidateError(error, 'Candidate mutation failed');
    } finally {
      if (this.mutationLease === lease) {
        this.mutationLease = undefined;
      }
      lease.settle();
    }
  }

  private isScopeSuperset(current: TaskScope, requested: TaskScope): boolean {
    if (
      !current.trackIds.every((trackId) => requested.trackIds.includes(trackId))
    ) {
      return false;
    }
    if (current.type === 'wholeProject') {
      return requested.type === 'wholeProject';
    }
    if (requested.type === 'wholeProject') {
      return true;
    }
    return (
      requested.startTick <= current.startTick &&
      requested.endTick >= current.endTick
    );
  }

  private toPendingScopeExtensionView(
    task: ActiveTask,
    pending: PendingScopeExtension,
  ): PendingScopeExtensionView {
    return {
      taskId: task.taskId,
      requestId: pending.requestId,
      fromScopeRevision: pending.fromScopeRevision,
      requestedScope: pending.requestedScope,
    };
  }

  private async attemptCleanup(candidate: CandidateRecord): Promise<void> {
    try {
      await this.dependencies.cleanup.authorizeAndAttempt(
        this.dependencies.project.getProjectPath(),
        candidate.workspace,
      );
    } catch {
      // Candidate business termination is already complete; cleanup remains best-effort.
    }
  }
}
