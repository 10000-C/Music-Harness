import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_ERROR_CODES,
  isTaskExecutionEnvelope,
  type TaskExecutionEnvelope,
} from './candidate.js';

describe('TaskExecutionEnvelope', () => {
  it('requires the complete task/candidate/base/scope revision tuple', () => {
    const envelope: TaskExecutionEnvelope = {
      taskId: '00000000-0000-4000-8000-000000000001' as never,
      projectId: '00000000-0000-4000-8000-000000000002' as never,
      candidateId: '00000000-0000-4000-8000-000000000003' as never,
      baseRevision: '0123456789abcdef',
      expectedScopeRevision: 3,
    };

    expect(isTaskExecutionEnvelope(envelope)).toBe(true);
    expect(
      isTaskExecutionEnvelope({
        ...envelope,
        expectedScopeRevision: -1,
      }),
    ).toBe(false);
    const { candidateId: _candidateId, ...missingCandidate } = envelope;
    expect(isTaskExecutionEnvelope(missingCandidate)).toBe(false);
  });
});

describe('CandidateErrorCode', () => {
  it('pins the stable P0 error-code vocabulary', () => {
    expect(CANDIDATE_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'TASK_BUSY',
        'TASK_NOT_ACTIVE',
        'TASK_PROJECT_MISMATCH',
        'TASK_CANDIDATE_MISMATCH',
        'TASK_BASE_REVISION_MISMATCH',
        'TASK_SCOPE_EXTENSION_PENDING',
        'STALE_SCOPE_REVISION',
        'STALE_SCOPE_EXTENSION_REQUEST',
        'SCOPE_EXTENSION_NOT_SUPERSET',
        'OPERATION_NOT_ALLOWED',
        'CANDIDATE_NOT_FOUND',
        'CANDIDATE_NOT_READY',
        'CANDIDATE_STALE',
        'CURRENT_NOT_CLEAN',
        'CANDIDATE_BASELINE_CHANGED',
        'UNEXPECTED_CANDIDATE_CHANGE',
        'VALIDATION_FAILED',
        'CANDIDATE_TRANSACTION_FAILED',
        'ORPHAN_CANDIDATE_RESOURCE',
      ]),
    );
  });
});
