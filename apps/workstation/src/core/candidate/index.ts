export { CandidateError } from './candidate-error.js';
export { CandidateCleanupManager } from './candidate-cleanup.js';
export { CandidateGitRepository } from './candidate-repository.js';
export { CandidateIpcHandler } from './candidate-ipc-handler.js';
export { CandidateTransaction } from './candidate-transaction.js';

export type {
  CandidateControlHandlerPort,
  CandidateReconciliationOutcome,
} from './candidate-ipc-handler.js';
export type {
  CandidateAgentPort,
  CandidateControlPort,
  CandidateTransactionDependencies,
} from './candidate-transaction.js';
