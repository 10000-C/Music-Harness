import type {
  CandidateCommand,
  CandidateEvent,
  CandidateRecoveryReport,
  CandidateView,
  TaskContextView,
} from '@agent-music/contracts';

import { candidateErrorPayload } from './candidate-error.js';
import type { CandidateControlPort } from './candidate-transaction.js';

export type CandidateControlHandlerPort = CandidateControlPort;

export interface CandidateReconciliationOutcome {
  readonly report: CandidateRecoveryReport;
  readonly events: readonly CandidateEvent[];
}

export class CandidateIpcHandler {
  private sequence = 0;

  public constructor(private readonly control: CandidateControlHandlerPort) {}

  public async handle(
    command: CandidateCommand,
  ): Promise<readonly CandidateEvent[]> {
    try {
      switch (command.type) {
        case 'candidate.startTask': {
          const task = await this.control.startTask({
            projectId: command.projectId,
            scope: command.scope,
          });
          return [
            this.taskChanged(command.requestId, task),
            this.candidateChanged(
              command.requestId,
              this.candidateFromTask(task),
            ),
          ];
        }
        case 'candidate.cancelTask': {
          const candidate = await this.control.cancelTask({
            projectId: command.projectId,
            candidateId: command.candidateId,
            taskId: command.taskId,
          });
          return [
            this.taskChanged(command.requestId, undefined),
            this.candidateChanged(command.requestId, candidate),
          ];
        }
        case 'candidate.cancelActiveTaskForAgentLoss': {
          const candidate = await this.control.cancelActiveTaskForAgentLoss(
            command.projectId,
          );
          return [
            this.taskChanged(command.requestId, undefined),
            this.candidateChanged(command.requestId, candidate),
          ];
        }
        case 'candidate.approveScopeExtension': {
          const task = await this.control.approveScopeExtension({
            taskId: command.taskId,
            requestId: command.requestIdToApprove,
          });
          return [this.taskChanged(command.requestId, task)];
        }
        case 'candidate.rejectScopeExtension': {
          const task = await this.control.rejectScopeExtension({
            taskId: command.taskId,
            requestId: command.requestIdToReject,
          });
          return [this.taskChanged(command.requestId, task)];
        }
        case 'candidate.accept': {
          const result = await this.control.acceptCandidate({
            projectId: command.projectId,
            candidateId: command.candidateId,
          });
          return [
            {
              type: 'candidate.currentCommitted',
              requestId: command.requestId,
              sequence: this.nextSequence(),
              result,
            },
          ];
        }
        case 'candidate.reject': {
          await this.control.rejectCandidate({
            projectId: command.projectId,
            candidateId: command.candidateId,
          });
          return [
            {
              type: 'candidate.invalidated',
              requestId: command.requestId,
              sequence: this.nextSequence(),
              candidateId: command.candidateId,
            },
            this.candidateChanged(command.requestId, undefined),
          ];
        }
      }
    } catch (error: unknown) {
      return [this.failed(command.requestId, error)];
    }
  }

  public async reconcileProjectResources(
    requestId: string,
  ): Promise<CandidateReconciliationOutcome> {
    const report = await this.control.reconcileProjectResources();
    const events = report.orphanCandidateIds.map<CandidateEvent>(
      (candidateId) => ({
        type: 'candidate.failed',
        requestId,
        sequence: this.nextSequence(),
        code: 'ORPHAN_CANDIDATE_RESOURCE',
        message: 'Unmarked Candidate resource requires manual inspection',
        details: { candidateId },
      }),
    );
    return { report, events };
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private taskChanged(
    requestId: string,
    task: TaskContextView | undefined,
  ): CandidateEvent {
    return {
      type: 'task.changed',
      requestId,
      sequence: this.nextSequence(),
      task,
    };
  }

  private candidateChanged(
    requestId: string,
    candidate: CandidateView | undefined,
  ): CandidateEvent {
    return {
      type: 'candidate.changed',
      requestId,
      sequence: this.nextSequence(),
      candidate,
    };
  }

  private candidateFromTask(task: TaskContextView): CandidateView {
    return {
      candidateId: task.candidateId,
      projectId: task.projectId,
      baseRevision: task.baseRevision,
      state: task.candidateState,
    };
  }

  private failed(requestId: string, error: unknown): CandidateEvent {
    const payload = candidateErrorPayload(
      error,
      'Unexpected candidate failure',
    );
    return {
      type: 'candidate.failed',
      requestId,
      sequence: this.nextSequence(),
      ...payload,
    };
  }
}
