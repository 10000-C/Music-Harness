import {
  TRACK_IDS,
  isTick,
  isTickRange,
  type Tick,
  type TickRange,
  type TrackId,
} from '../b-contracts/index.js';

export type PreviewTarget = 'current' | 'candidate';
export type WorkstationTab = 'agent' | 'activity';
export const MIN_TIMELINE_ZOOM = 1;
export const MAX_TIMELINE_ZOOM = 8;

/**
 * Renderer-only state. None of these fields may be persisted into Current or
 * Candidate, or treated as Music Core facts.
 */
export interface WorkstationUiState {
  readonly playbackTick: Tick;
  readonly previewTarget: PreviewTarget;
  readonly selectedTrackIds: readonly TrackId[];
  readonly timeRange: TickRange | null;
  readonly loopRange: TickRange | null;
  readonly timelineZoom: number;
  readonly timelineStartTick: Tick;
  readonly tab: WorkstationTab;
}

export type WorkstationUiAction =
  | { readonly type: 'ui/playbackTickChanged'; readonly tick: Tick }
  | {
      readonly type: 'ui/previewTargetChanged';
      readonly target: PreviewTarget;
    }
  | {
      readonly type: 'ui/trackSelectionChanged';
      readonly trackIds: readonly TrackId[];
    }
  | {
      readonly type: 'ui/timeRangeChanged';
      readonly range: TickRange | null;
    }
  | {
      readonly type: 'ui/loopRangeChanged';
      readonly range: TickRange | null;
    }
  | { readonly type: 'ui/timelineZoomChanged'; readonly zoom: number }
  | {
      readonly type: 'ui/timelineStartTickChanged';
      readonly tick: Tick;
    }
  | { readonly type: 'ui/tabChanged'; readonly tab: WorkstationTab };

export const createInitialWorkstationUiState = (): WorkstationUiState => ({
  playbackTick: 0 as Tick,
  previewTarget: 'current',
  selectedTrackIds: [...TRACK_IDS],
  timeRange: null,
  loopRange: null,
  timelineZoom: MIN_TIMELINE_ZOOM,
  timelineStartTick: 0 as Tick,
  tab: 'agent',
});

const canonicalTrackSelection = (
  selectedTrackIds: readonly TrackId[],
): readonly TrackId[] => {
  const selected = new Set<TrackId>(selectedTrackIds);
  return TRACK_IDS.filter((trackId) => selected.has(trackId));
};

const sameTrackSelection = (
  left: readonly TrackId[],
  right: readonly TrackId[],
): boolean =>
  left.length === right.length &&
  left.every((trackId, index) => trackId === right[index]);

const sameTickRange = (
  left: TickRange | null,
  right: TickRange | null,
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.startTick === right.startTick &&
    left.endTick === right.endTick);

export const reduceWorkstationUiState = (
  state: WorkstationUiState,
  action: WorkstationUiAction,
): WorkstationUiState => {
  switch (action.type) {
    case 'ui/playbackTickChanged':
      return isTick(action.tick) && action.tick !== state.playbackTick
        ? { ...state, playbackTick: action.tick }
        : state;
    case 'ui/previewTargetChanged':
      return action.target === state.previewTarget
        ? state
        : { ...state, previewTarget: action.target };
    case 'ui/trackSelectionChanged': {
      const selectedTrackIds = canonicalTrackSelection(action.trackIds);
      if (sameTrackSelection(selectedTrackIds, state.selectedTrackIds)) {
        return state;
      }
      return {
        ...state,
        selectedTrackIds,
      };
    }
    case 'ui/timeRangeChanged': {
      const rangeIsValid = action.range === null || isTickRange(action.range);
      return rangeIsValid && !sameTickRange(action.range, state.timeRange)
        ? { ...state, timeRange: action.range }
        : state;
    }
    case 'ui/loopRangeChanged': {
      const rangeIsValid = action.range === null || isTickRange(action.range);
      return rangeIsValid && !sameTickRange(action.range, state.loopRange)
        ? { ...state, loopRange: action.range }
        : state;
    }
    case 'ui/timelineZoomChanged':
      return Number.isFinite(action.zoom) &&
        action.zoom >= MIN_TIMELINE_ZOOM &&
        action.zoom <= MAX_TIMELINE_ZOOM &&
        action.zoom !== state.timelineZoom
        ? { ...state, timelineZoom: action.zoom }
        : state;
    case 'ui/timelineStartTickChanged':
      return isTick(action.tick) && action.tick !== state.timelineStartTick
        ? { ...state, timelineStartTick: action.tick }
        : state;
    case 'ui/tabChanged':
      return action.tab === state.tab ? state : { ...state, tab: action.tab };
  }
};
