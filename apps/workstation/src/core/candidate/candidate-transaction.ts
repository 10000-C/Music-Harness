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
  ScopedComposition,
  TrackReplacement,
} from '../composition/index.js';
import type { ProjectAuthorityAccess } from '../project/project-authority-access.js';
import { CandidateError, normalizeCandidateError } from './candidate-error.js';
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
  updateGlobalMeter(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly numerator: number;
    readonly denominator: number;
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

export interface CandidateTransactionDependencies {
  readonly project: ProjectAuthorityAccess;
  readonly composition: Pick<
    CompositionPipeline,
    | 'compileCanonical'
    | 'getScopedComposition'
    | 'replaceScopedMusic'
    | 'updateGlobalMeter'
    | 'validateFinalMeterConsistency'
  >;
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
  pendingScopeExtension?: PendingScopeExtension;
  readonly createdAt: string;
}

interface CandidateRecord {
  readonly candidateId: CandidateId;
  readonly projectId: ProjectId;
  readonly baseRevision: string;
  readonly workspace: CandidateWorkspace;
  state: CandidateState;
  latestCheckpoint?: string;
  activeTask?: ActiveTask;
}

const hasAllTracks = (scope: TaskScope): boolean =>
  scope.type === 'wholeProject' &&
  scope.trackIds.length === TRACK_IDS.length &&
  TRACK_IDS.every((trackId) => scope.trackIds.includes(trackId));

export class CandidateTransaction {
  private candidate: CandidateRecord | undefined;

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

  public async getTaskContext(taskId: TaskId): Promise<TaskContextView> {
    const candidate = this.candidate;
    const task = candidate?.activeTask;
    if (
      candidate === undefined ||
      task === undefined ||
      task.taskId !== taskId
    ) {
      throw new CandidateError('TASK_NOT_ACTIVE', 'Task is not active');
    }
    return this.toTaskContextView(candidate, task);
  }

  public async requestScopeExtension(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly requestedScope: TaskScope;
  }): Promise<PendingScopeExtensionView> {
    const { candidate, task } = await this.guardTaskEnvelope(input.envelope);
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

  public async approveScopeExtension(input: {
    readonly taskId: TaskId;
    readonly requestId: ScopeExtensionRequestId;
  }): Promise<TaskContextView> {
    const { candidate, task } = this.resolveActiveTask(input.taskId);
    const pending = task.pendingScopeExtension;
    if (pending === undefined || pending.requestId !== input.requestId) {
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
    return this.toTaskContextView(candidate, task);
  }

  public async rejectScopeExtension(input: {
    readonly taskId: TaskId;
    readonly requestId: ScopeExtensionRequestId;
  }): Promise<TaskContextView> {
    const { candidate, task } = this.resolveActiveTask(input.taskId);
    const pending = task.pendingScopeExtension;
    if (pending === undefined || pending.requestId !== input.requestId) {
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
    return this.toTaskContextView(candidate, task);
  }

  public async cancelTask(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
    readonly taskId: TaskId;
  }): Promise<CandidateView | undefined> {
    const candidate = this.requireCandidate(input.projectId, input.candidateId);
    const task = candidate.activeTask;
    if (task === undefined || task.taskId !== input.taskId) {
      throw new CandidateError('TASK_NOT_ACTIVE', 'Task is not active');
    }

    candidate.activeTask = undefined;
    try {
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

  public async rejectCandidate(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
  }): Promise<void> {
    const candidate = this.requireCandidate(input.projectId, input.candidateId);
    this.candidate = undefined;
    await this.attemptCleanup(candidate);
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
      createdAt: this.dependencies.now(),
    };
  }

  private requireCandidate(
    projectId: ProjectId,
    candidateId: CandidateId,
  ): CandidateRecord {
    const candidate = this.candidate;
    if (candidate === undefined || candidate.candidateId !== candidateId) {
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
    if (
      candidate === undefined ||
      task === undefined ||
      task.taskId !== taskId
    ) {
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
    if (
      candidate === undefined ||
      task === undefined ||
      task.taskId !== envelope.taskId
    ) {
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
    if (hasAllTracks(scope)) {
      operations.push('updateGlobalMeter');
    }
    return operations;
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
