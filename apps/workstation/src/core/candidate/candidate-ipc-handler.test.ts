import {
  TRACK_IDS,
  type CandidateCommand,
  type CandidateId,
  type CandidateRecoveryReport,
  type CandidateView,
  type CurrentCommittedResult,
  type ProjectId,
  type ScopeExtensionRequestId,
  type TaskContextView,
  type TaskId,
} from '@agent-music/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CandidateError } from './candidate-error.js';
import {
  CandidateIpcHandler,
  type CandidateControlHandlerPort,
} from './candidate-ipc-handler.js';

const projectId = '00000000-0000-4000-8000-000000000091' as ProjectId;
const candidateId = '00000000-0000-4000-8000-000000000092' as CandidateId;
const taskId = '00000000-0000-4000-8000-000000000093' as TaskId;
const scopeRequestId =
  '00000000-0000-4000-8000-000000000094' as ScopeExtensionRequestId;
const orphanId = '00000000-0000-4000-8000-000000000095' as CandidateId;

const task: TaskContextView = {
  taskId,
  projectId,
  candidateId,
  baseRevision: 'C0',
  scope: { type: 'wholeProject', trackIds: TRACK_IDS },
  scopeRevision: 0,
  state: 'editing',
  candidateState: 'active',
  allowedOperations: ['replaceScopedMusic', 'updateGlobalMeter'],
  trackIds: TRACK_IDS,
  createdAt: '2026-08-13T00:00:00.000Z',
};
const expandedTask: TaskContextView = {
  ...task,
  scopeRevision: 1,
};
const readyCandidate: CandidateView = {
  candidateId,
  projectId,
  baseRevision: 'C0',
  state: 'ready',
};
const committed: CurrentCommittedResult = {
  projectId,
  candidateId,
  currentRevision: 'C1',
};
const recovery: CandidateRecoveryReport = {
  cleanedCandidateIds: [],
  pendingCandidateIds: [],
  orphanCandidateIds: [orphanId],
};

let fake: {
  [K in keyof CandidateControlHandlerPort]: ReturnType<typeof vi.fn>;
};
let handler: CandidateIpcHandler;

beforeEach(() => {
  fake = {
    startTask: vi.fn(() => Promise.resolve(task)),
    cancelTask: vi.fn(() => Promise.resolve(readyCandidate)),
    cancelActiveTaskForAgentLoss: vi.fn(() => Promise.resolve(readyCandidate)),
    approveScopeExtension: vi.fn(() => Promise.resolve(expandedTask)),
    rejectScopeExtension: vi.fn(() => Promise.resolve(task)),
    acceptCandidate: vi.fn(() => Promise.resolve(committed)),
    rejectCandidate: vi.fn(() => Promise.resolve()),
    reconcileProjectResources: vi.fn(() => Promise.resolve(recovery)),
  };
  handler = new CandidateIpcHandler(fake as CandidateControlHandlerPort);
});

describe('CandidateIpcHandler', () => {
  it('maps Renderer commands to monotonic product events without internal Git state', async () => {
    const commands: CandidateCommand[] = [
      {
        type: 'candidate.startTask',
        requestId: 'request-1',
        projectId,
        scope: { type: 'wholeProject', trackIds: TRACK_IDS },
      },
      {
        type: 'candidate.approveScopeExtension',
        requestId: 'request-2',
        taskId,
        requestIdToApprove: scopeRequestId,
      },
      {
        type: 'candidate.rejectScopeExtension',
        requestId: 'request-3',
        taskId,
        requestIdToReject: scopeRequestId,
      },
      {
        type: 'candidate.accept',
        requestId: 'request-4',
        projectId,
        candidateId,
      },
      {
        type: 'candidate.reject',
        requestId: 'request-5',
        projectId,
        candidateId,
      },
    ];

    const events = [];
    for (const command of commands) {
      events.push(...(await handler.handle(command)));
    }

    expect(fake.startTask).toHaveBeenCalledWith({
      projectId,
      scope: { type: 'wholeProject', trackIds: TRACK_IDS },
    });
    expect(fake.approveScopeExtension).toHaveBeenCalledWith({
      taskId,
      requestId: scopeRequestId,
    });
    expect(fake.rejectScopeExtension).toHaveBeenCalledWith({
      taskId,
      requestId: scopeRequestId,
    });
    expect(fake.acceptCandidate).toHaveBeenCalledWith({
      projectId,
      candidateId,
    });
    expect(fake.rejectCandidate).toHaveBeenCalledWith({
      projectId,
      candidateId,
    });
    expect(events.map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(events).toEqual([
      {
        type: 'task.changed',
        requestId: 'request-1',
        sequence: 1,
        task,
      },
      {
        type: 'candidate.changed',
        requestId: 'request-1',
        sequence: 2,
        candidate: {
          candidateId,
          projectId,
          baseRevision: 'C0',
          state: 'active',
        },
      },
      {
        type: 'task.changed',
        requestId: 'request-2',
        sequence: 3,
        task: expandedTask,
      },
      {
        type: 'task.changed',
        requestId: 'request-3',
        sequence: 4,
        task,
      },
      {
        type: 'candidate.currentCommitted',
        requestId: 'request-4',
        sequence: 5,
        result: committed,
      },
      {
        type: 'candidate.invalidated',
        requestId: 'request-5',
        sequence: 6,
        candidateId,
      },
      {
        type: 'candidate.changed',
        requestId: 'request-5',
        sequence: 7,
        candidate: undefined,
      },
    ]);

    const serialized = JSON.stringify(events);
    for (const forbidden of [
      'branchName',
      'worktreePath',
      'latestCheckpoint',
      'candidate-cleanup',
      'git -C',
      'stderr',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('maps cancel to Task invalidation plus the remaining Candidate product state', async () => {
    const events = await handler.handle({
      type: 'candidate.cancelTask',
      requestId: 'request-cancel',
      projectId,
      candidateId,
      taskId,
    });

    expect(fake.cancelTask).toHaveBeenCalledWith({
      projectId,
      candidateId,
      taskId,
    });
    expect(events).toEqual([
      {
        type: 'task.changed',
        requestId: 'request-cancel',
        sequence: 1,
        task: undefined,
      },
      {
        type: 'candidate.changed',
        requestId: 'request-cancel',
        sequence: 2,
        candidate: readyCandidate,
      },
    ]);
  });

  it('routes Agent process loss to authoritative Active Task cancellation', async () => {
    const events = await handler.handle({
      type: 'candidate.cancelActiveTaskForAgentLoss',
      requestId: 'agent-exit-1',
      projectId,
    });

    expect(fake.cancelActiveTaskForAgentLoss).toHaveBeenCalledWith(projectId);
    expect(events).toEqual([
      {
        type: 'task.changed',
        requestId: 'agent-exit-1',
        sequence: 1,
        task: undefined,
      },
      {
        type: 'candidate.changed',
        requestId: 'agent-exit-1',
        sequence: 2,
        candidate: readyCandidate,
      },
    ]);
  });

  it('preserves stable Candidate errors while stripping internal error details', async () => {
    fake.startTask.mockRejectedValueOnce(
      new CandidateError('VALIDATION_FAILED', 'Composition validation failed', {
        validation: {
          valid: false,
          issues: [{ code: 'TEST', message: 'stable validation detail' }],
        },
        worktreePath: '/secret/worktree',
        stderr: 'secret git stderr',
      }),
    );
    fake.startTask.mockRejectedValueOnce(
      new Error('secret implementation failure'),
    );
    const command: CandidateCommand = {
      type: 'candidate.startTask',
      requestId: 'request-error-1',
      projectId,
      scope: { type: 'wholeProject', trackIds: TRACK_IDS },
    };

    await expect(handler.handle(command)).resolves.toEqual([
      {
        type: 'candidate.failed',
        requestId: 'request-error-1',
        sequence: 1,
        code: 'VALIDATION_FAILED',
        message: 'Composition validation failed',
        details: {
          validation: {
            valid: false,
            issues: [{ code: 'TEST', message: 'stable validation detail' }],
          },
        },
      },
    ]);

    await expect(
      handler.handle({ ...command, requestId: 'request-error-2' }),
    ).resolves.toEqual([
      {
        type: 'candidate.failed',
        requestId: 'request-error-2',
        sequence: 2,
        code: 'CANDIDATE_TRANSACTION_FAILED',
        message: 'Unexpected candidate failure',
      },
    ]);
  });

  it('maps orphan reconciliation to diagnostics without converting it into recovered business state', async () => {
    await expect(
      handler.reconcileProjectResources('project-open-1'),
    ).resolves.toEqual({
      report: recovery,
      events: [
        {
          type: 'candidate.failed',
          requestId: 'project-open-1',
          sequence: 1,
          code: 'ORPHAN_CANDIDATE_RESOURCE',
          message: 'Unmarked Candidate resource requires manual inspection',
          details: { candidateId: orphanId },
        },
      ],
    });
    expect(fake.reconcileProjectResources).toHaveBeenCalledOnce();
    expect(fake.startTask).not.toHaveBeenCalled();
  });
});
