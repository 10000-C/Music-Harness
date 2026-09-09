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

export interface CandidateErrorPayload {
  readonly code: CandidateErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

const safeCandidateErrorDetails = (
  error: CandidateError,
): Readonly<Record<string, unknown>> | undefined => {
  if (error.code === 'VALIDATION_FAILED') {
    const validation = error.details?.validation;
    return validation === undefined ? undefined : { validation };
  }
  if (error.code === 'UNEXPECTED_CANDIDATE_CHANGE') {
    const projectJsonChangedFromBase =
      error.details?.projectJsonChangedFromBase;
    const unexpectedPaths = error.details?.unexpectedPaths;
    return {
      ...(typeof projectJsonChangedFromBase === 'boolean'
        ? { projectJsonChangedFromBase }
        : {}),
      ...(Array.isArray(unexpectedPaths) &&
      unexpectedPaths.every((path) => typeof path === 'string')
        ? { unexpectedPaths }
        : {}),
    };
  }
  if (error.code === 'ORPHAN_CANDIDATE_RESOURCE') {
    const candidateId = error.details?.candidateId;
    return typeof candidateId === 'string' ? { candidateId } : undefined;
  }
  return undefined;
};

export const candidateErrorPayload = (
  error: unknown,
  fallbackMessage = 'Candidate transaction failed',
): CandidateErrorPayload => {
  const normalized =
    error instanceof CandidateError
      ? error
      : new CandidateError('CANDIDATE_TRANSACTION_FAILED', fallbackMessage);
  const details = safeCandidateErrorDetails(normalized);
  return {
    code: normalized.code,
    message: normalized.message,
    ...(details === undefined ? {} : { details }),
  };
};
