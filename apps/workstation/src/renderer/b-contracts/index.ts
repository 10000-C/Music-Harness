export * from '@agent-music/contracts';

export {
  CORE_BOOTSTRAP_SCHEMA_VERSION,
  TASK_STAGES,
  isCandidateDisplayState,
  isCoreBootstrapState,
  isCurrentDisplayState,
  isProjectDisplayState,
  isRendererTaskScope,
  isStructuredUiError,
  isTaskDisplayState,
} from './state.js';

export type {
  CandidateAvailability,
  CandidateDisplayState,
  CoreBootstrapState,
  CurrentDisplayState,
  CurrentSafety,
  ProjectDisplayState,
  StructuredUiError,
  TaskDisplayState,
  TaskStage,
} from './state.js';

export {
  KEY_TONICS,
  TIMELINE_VIEW_MODEL_SCHEMA_VERSION,
  isKeyEvent,
  isMeterEvent,
  isTempoEvent,
  isTimelineClip,
  isTimelineNoteMarker,
  isTimelineViewModel,
} from './timeline.js';

export type {
  KeyEvent,
  KeyMode,
  KeyTonic,
  MeterDenominator,
  MeterEvent,
  TempoEvent,
  TimelineClip,
  TimelineNoteMarker,
  TimelineTrackViewModel,
  TimelineViewModel,
} from './timeline.js';

export type {
  KeyEvent as RendererKeyEvent,
  TimelineClip as RendererTimelineClip,
  TimelineViewModel as RendererTimelineViewModel,
} from './timeline.js';

export type { ServiceKind } from '../../shared/service-lifecycle.js';

export { isCoreEvent, isRendererCommand } from './protocol.js';

export type {
  CoreEvent,
  CurrentExportFormat,
  PreviewSource,
  RendererCommand,
} from './protocol.js';
