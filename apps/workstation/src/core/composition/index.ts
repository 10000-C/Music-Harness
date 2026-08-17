export {
  canonicalizeExternalAbc,
  compileCanonicalAbc,
  createInitialCanonicalAbc,
} from './canonical-abc.js';
export { CompositionValidationError } from './composition-validation-error.js';

export type {
  AbcSpan,
  CanonicalAbcCompilation,
  CompositionValidationIssue,
  CompositionValidationIssueCode,
  DomainMusicEvent,
  DomainNoteEvent,
  DomainRestEvent,
  DomainTrack,
  ValidationReport,
} from './composition-types.js';
