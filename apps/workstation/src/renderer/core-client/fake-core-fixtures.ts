import {
  TRACK_IDS,
  type CandidateId,
  type CoreBootstrapState,
  type ProjectId,
  type StructuredUiError,
  type TaskId,
  type TaskScope,
  type RendererTimelineClip as TimelineClip,
  type RendererTimelineViewModel as TimelineViewModel,
  type TimelineTrackViewModel,
  type TrackId,
} from '../b-contracts/index.js';
import {
  FAKE_KEY_MAP,
  FAKE_METER_MAP,
  FAKE_CURRENT_PLAYBACK_REVISION,
  FAKE_CANDIDATE_CLIPS,
  FAKE_STABLE_CLIPS,
  FAKE_TEMPO_MAP,
  FAKE_TOTAL_TICKS,
  fakeTick,
  type FakeArrangementClip,
} from './fake-composition-fixture.js';

export type FakeCoreFixtureName =
  'blank' | 'stable' | 'running' | 'failed' | 'candidate';

export const FAKE_PROJECT_ID = 'project.midnight-sketch' as ProjectId;
export const FAKE_TASK_ID = 'task.arrangement-001' as TaskId;
export const FAKE_CANDIDATE_ID = 'candidate.arrangement-001' as CandidateId;

const TRACK_LABELS: Readonly<Record<TrackId, string>> = {
  'track.drums': 'Drums',
  'track.bass': 'Bass',
  'track.guitar': 'Guitar',
  'track.keys': 'Keys',
  'track.strings': 'Strings',
  'track.winds': 'Winds',
};

const timelineClip = (source: FakeArrangementClip): TimelineClip => ({
  startTick: source.startTick,
  endTick: source.endTick,
  label: source.label,
  density: source.density,
  noteMarkers: source.notes.map((note) => ({
    startTick: note.startTick,
    endTick: fakeTick(note.startTick + note.durationTick),
    pitch: note.pitch,
    velocity: note.velocity,
  })),
});

const emptyTracks = (): readonly TimelineTrackViewModel[] =>
  TRACK_IDS.map((trackId) => ({
    trackId,
    label: TRACK_LABELS[trackId],
    clips: [],
  }));

const blankTimeline: TimelineViewModel = {
  schemaVersion: 1,
  revision: 'timeline.blank-001',
  totalTicks: fakeTick(FAKE_TOTAL_TICKS),
  ticksPerQuarter: 960,
  tempoMap: FAKE_TEMPO_MAP.slice(0, 1),
  meterMap: FAKE_METER_MAP,
  keyMap: FAKE_KEY_MAP.map(({ tick, tonic }) => ({
    tick,
    tonic,
    mode: 'minor',
  })),
  tracks: emptyTracks(),
};

const stableTimeline: TimelineViewModel = {
  schemaVersion: 1,
  revision: 'timeline.current-0042',
  totalTicks: fakeTick(FAKE_TOTAL_TICKS),
  ticksPerQuarter: 960,
  tempoMap: FAKE_TEMPO_MAP,
  meterMap: FAKE_METER_MAP,
  keyMap: FAKE_KEY_MAP.map(({ tick, tonic }) => ({
    tick,
    tonic,
    mode: 'minor',
  })),
  tracks: TRACK_IDS.map((trackId) => ({
    trackId,
    label: TRACK_LABELS[trackId],
    clips: FAKE_STABLE_CLIPS[trackId].map(timelineClip),
  })),
};

export const fakeCandidateTimeline: TimelineViewModel = {
  ...stableTimeline,
  revision: 'timeline.candidate-0001',
  tracks: TRACK_IDS.map((trackId) => ({
    trackId,
    label: TRACK_LABELS[trackId],
    clips: FAKE_CANDIDATE_CLIPS[trackId].map(timelineClip),
  })),
};

const focusedScope: TaskScope = {
  type: 'timeRange',
  trackIds: ['track.guitar', 'track.keys'],
  startTick: fakeTick(61_440),
  endTick: fakeTick(122_880),
};

const generationError: StructuredUiError = {
  code: 'AGENT_GENERATION_FAILED',
  title: 'Generation stopped safely',
  message: 'The provider stopped before a valid Candidate was produced.',
  currentSafety: 'safe',
  candidateAvailability: 'unavailable',
  nextAction: 'Review the request and retry. Current remains unchanged.',
};

const project = {
  status: 'open',
  projectId: FAKE_PROJECT_ID,
  name: 'Midnight Sketch',
} as const;

const stableCurrent = {
  status: 'ready',
  revision: FAKE_CURRENT_PLAYBACK_REVISION,
  label: 'Current · v42',
  isEmpty: false,
} as const;

export const fakeCoreFixtures = {
  blank: {
    schemaVersion: 1,
    sequence: 1,
    project,
    current: {
      status: 'ready',
      revision: 'current-0000',
      label: 'Empty Current',
      isEmpty: true,
    },
    task: { status: 'idle' },
    candidate: { status: 'none' },
    timeline: blankTimeline,
    errors: [],
  },
  stable: {
    schemaVersion: 1,
    sequence: 12,
    project,
    current: stableCurrent,
    task: { status: 'idle' },
    candidate: { status: 'none' },
    timeline: stableTimeline,
    errors: [],
  },
  running: {
    schemaVersion: 1,
    sequence: 23,
    project,
    current: stableCurrent,
    task: {
      status: 'active',
      taskId: FAKE_TASK_ID,
      stage: 'editing',
      title: 'Build a wider second half',
      detail: 'Writing Guitar and Keys inside the selected range.',
      scope: focusedScope,
      scopeRevision: 3,
      cancellable: true,
    },
    candidate: {
      status: 'building',
      candidateId: FAKE_CANDIDATE_ID,
      taskId: FAKE_TASK_ID,
      summary: 'Two scoped tracks are being arranged.',
    },
    timeline: stableTimeline,
    errors: [],
  },
  failed: {
    schemaVersion: 1,
    sequence: 27,
    project,
    current: stableCurrent,
    task: {
      status: 'failed',
      taskId: FAKE_TASK_ID,
      title: 'Build a wider second half',
      scope: focusedScope,
      scopeRevision: 3,
      error: generationError,
    },
    candidate: {
      status: 'failed',
      candidateId: FAKE_CANDIDATE_ID,
      taskId: FAKE_TASK_ID,
      error: generationError,
    },
    timeline: stableTimeline,
    errors: [generationError],
  },
  candidate: {
    schemaVersion: 1,
    sequence: 31,
    project,
    current: stableCurrent,
    task: {
      status: 'active',
      taskId: FAKE_TASK_ID,
      stage: 'candidate_ready',
      title: 'Build a wider second half',
      detail: 'Candidate is ready to compare with Current.',
      scope: focusedScope,
      scopeRevision: 4,
      cancellable: false,
    },
    candidate: {
      status: 'ready',
      candidateId: FAKE_CANDIDATE_ID,
      taskId: FAKE_TASK_ID,
      summary: 'Expanded low end and a wider string lift.',
    },
    timeline: stableTimeline,
    errors: [],
  },
} as const satisfies Readonly<Record<FakeCoreFixtureName, CoreBootstrapState>>;

export const getFakeCoreFixture = (
  name: FakeCoreFixtureName,
): CoreBootstrapState => structuredClone(fakeCoreFixtures[name]);
