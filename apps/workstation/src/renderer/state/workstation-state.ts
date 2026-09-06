import type {
  CoreBootstrapState,
  CoreEvent,
  Tick,
  TickRange,
} from '../b-contracts/index.js';
import { sequenceCoreEvent } from './core-event-sequencer.js';
import {
  createInitialWorkstationUiState,
  reduceWorkstationUiState,
  type WorkstationUiAction,
  type WorkstationUiState,
} from './workstation-ui-state.js';

export interface WorkstationState {
  readonly authoritative: CoreBootstrapState;
  readonly ui: WorkstationUiState;
}

export type WorkstationAction =
  | { readonly type: 'core/eventReceived'; readonly event: CoreEvent }
  | WorkstationUiAction;

export const createWorkstationState = (
  authoritative: CoreBootstrapState,
  ui: WorkstationUiState = createInitialWorkstationUiState(),
): WorkstationState => ({
  authoritative,
  ui: normalizeUiState(authoritative, ui),
});

const applyCoreEvent = (
  state: CoreBootstrapState,
  event: CoreEvent,
): CoreBootstrapState => {
  const common = { ...state, sequence: event.sequence };

  switch (event.type) {
    case 'bootstrapChanged':
      return { ...event.state, sequence: event.sequence };
    case 'projectChanged':
      return {
        ...common,
        project: event.project,
        current: event.current,
        timeline: event.timeline,
      };
    case 'currentChanged':
      return {
        ...common,
        current: event.current,
        timeline: event.timeline,
      };
    case 'timelineChanged':
      return { ...common, timeline: event.timeline };
    case 'taskChanged':
      return { ...common, task: event.task };
    case 'candidateChanged':
      return { ...common, candidate: event.candidate };
    case 'errorOccurred':
      return { ...common, errors: [...state.errors, event.error] };
  }
};

const normalizeTimeRange = (
  range: TickRange | null,
  totalTicks: Tick,
): TickRange | null => {
  if (range === null || range.startTick >= totalTicks) return null;
  if (range.endTick <= totalTicks) return range;

  return { startTick: range.startTick, endTick: totalTicks };
};

const normalizeUiState = (
  authoritative: CoreBootstrapState,
  ui: WorkstationUiState,
): WorkstationUiState => {
  const totalTicks = authoritative.timeline?.totalTicks ?? (0 as Tick);
  const candidateCanPreview = authoritative.candidate.status === 'ready';
  const playbackTick = Math.min(ui.playbackTick, totalTicks) as Tick;
  const previewTarget =
    ui.previewTarget === 'candidate' && !candidateCanPreview
      ? 'current'
      : ui.previewTarget;
  const timeRange = normalizeTimeRange(ui.timeRange, totalTicks);
  const loopRange = normalizeTimeRange(ui.loopRange, totalTicks);
  const visibleTicks = Math.max(1, Math.ceil(totalTicks / ui.timelineZoom));
  const maximumStartTick = Math.max(0, totalTicks - visibleTicks);
  const timelineStartTick = Math.min(
    ui.timelineStartTick,
    maximumStartTick,
  ) as Tick;

  if (
    playbackTick === ui.playbackTick &&
    previewTarget === ui.previewTarget &&
    timeRange === ui.timeRange &&
    loopRange === ui.loopRange &&
    timelineStartTick === ui.timelineStartTick
  ) {
    return ui;
  }

  return {
    ...ui,
    playbackTick,
    previewTarget,
    timeRange,
    loopRange,
    timelineStartTick,
  };
};

export const reduceWorkstationState = (
  state: WorkstationState,
  action: WorkstationAction,
): WorkstationState => {
  if (action.type !== 'core/eventReceived') {
    const ui = normalizeUiState(
      state.authoritative,
      reduceWorkstationUiState(state.ui, action),
    );
    return ui === state.ui ? state : { ...state, ui };
  }

  if (!sequenceCoreEvent(state.authoritative, action.event).accepted) {
    return state;
  }

  const authoritative = applyCoreEvent(state.authoritative, action.event);
  return {
    authoritative,
    ui: normalizeUiState(authoritative, state.ui),
  };
};
