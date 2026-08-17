import type { CandidateErrorCode } from '@agent-music/contracts';

import { CompositionValidationError } from '../composition/index.js';
import { ProjectError } from '../project/project-error.js';

export class CandidateError extends Error {
  public constructor(
    readonly code: CandidateErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'CandidateError';
  }
}

export const normalizeCandidateError = (
  error: unknown,
  fallbackMessage = 'Candidate transaction failed',
): CandidateError => {
  if (error instanceof CandidateError) {
    return error;
  }
  if (
    error instanceof ProjectError &&
    error.code === 'CURRENT_WORKTREE_DIRTY'
  ) {
    return new CandidateError(
      'CURRENT_NOT_CLEAN',
      'Current must be clean before Candidate operations continue',
    );
  }
  if (error instanceof CompositionValidationError) {
    return new CandidateError(
      'VALIDATION_FAILED',
      'Composition validation failed',
      {
        validation: error.report,
      },
    );
  }
  return new CandidateError('CANDIDATE_TRANSACTION_FAILED', fallbackMessage);
};
