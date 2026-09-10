export {
  canonicalizeExternalAbc,
  compileCanonicalAbc,
  createInitialCanonicalAbc,
} from './canonical-abc.js';
export { CompositionValidationError } from './composition-validation-error.js';
export { CompositionPipeline } from './composition-service.js';
export { compileComposition } from './composition-pipeline.js';
export { createStandardMidiDocument } from './midi-document.js';
export { updateMusicalProperties } from './musical-properties.js';
export { createTimelineViewModel } from './timeline-view-model.js';
export {
  SCOPE_MAPPING_PARSER_VERSION,
  createScopeMappingCache,
  getScopedComposition,
  isScopeMappingCacheValid,
  queryScopeMapping,
} from './scope-mapping.js';
export { replaceScopedMusic } from './scoped-replacement.js';

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
export type { CompositionCompilation } from './composition-pipeline.js';
export type { CanonicalizationResult } from './composition-service.js';
export type {
  MusicalPropertiesUpdate,
  MusicalPropertiesUpdateResult,
} from './musical-properties.js';
export type { GlobalMeterValue } from './meter-policy.js';
export type {
  ProtectedScopeEvent,
  ScopeMappingCache,
  ScopeMappingEntry,
  ScopeMappingQuery,
  ScopeMappingTrackQuery,
  ScopedComposition,
  ScopedCompositionContext,
  ScopedTrackComposition,
} from './scope-mapping.js';
export type {
  ScopedReplacementResult,
  TrackReplacement,
} from './scoped-replacement.js';
