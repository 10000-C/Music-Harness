import { describe, expect, it } from 'vitest';

import {
  TRACK_IDS,
  type CandidateId,
  type ProjectId,
  type TaskId,
  type Tick,
} from '../index.js';
import { isCoreEvent, isRendererCommand } from './protocol.js';
import {
  isCoreBootstrapState,
  type CoreBootstrapState,
  type StructuredUiError,
} from './state.js';
import {
  isTimelineClip,
  isTimelineViewModel,
  type TimelineViewModel,
} from './timeline.js';

const projectId = 'project-fixture' as ProjectId;
const taskId = 'task-fixture' as TaskId;
const candidateId = 'candidate-fixture' as CandidateId;
const tick = (value: number): Tick => value as Tick;

const uiError: StructuredUiError = {
  code: 'CORE_UNAVAILABLE',
  title: 'Music Core is unavailable',
  message: 'The workstation cannot load project state right now.',
  currentSafety: 'safe',
  candidateAvailability: 'unknown',
  nextAction: 'Restart Music Core and try again.',
};

const createTimeline = (): TimelineViewModel => ({
  schemaVersion: 1,
  revision: 'current@abc123',
  totalTicks: tick(15_360),
  ticksPerQuarter: 960,
  tempoMap: [
    { tick: tick(0), bpm: 112 },
    { tick: tick(7_680), bpm: 118 },
  ],
  meterMap: [{ tick: tick(0), numerator: 4, denominator: 4 }],
  keyMap: [{ tick: tick(0), tonic: 'D', mode: 'minor' }],
  tracks: TRACK_IDS.map((trackId, index) => ({
    trackId,
    label: trackId.slice('track.'.length),
    clips: [
      {
        startTick: tick(0),
        endTick: tick(15_360),
        label: `${trackId} arrangement`,
        density: index / TRACK_IDS.length,
        noteMarkers: [
          {
            startTick: tick(index * 120),
            endTick: tick(index * 120 + 240),
            pitch: 36 + index * 7,
            velocity: 96,
          },
        ],
      },
    ],
  })),
});

const createBootstrap = (): CoreBootstrapState => ({
  schemaVersion: 1,
  sequence: 7,
  project: { status: 'open', projectId, name: 'Fixture Project' },
  current: {
    status: 'ready',
    revision: 'abc123',
    label: 'Current',
    isEmpty: false,
  },
  task: { status: 'idle' },
  candidate: { status: 'none' },
  timeline: createTimeline(),
  errors: [],
});

describe('TimelineViewModel runtime boundary', () => {
  it('accepts exactly the six fixed product tracks in registry order', () => {
    const timeline = createTimeline();

    expect(isTimelineViewModel(timeline)).toBe(true);
    expect(timeline.tracks.map(({ trackId }) => trackId)).toEqual(TRACK_IDS);
  });

  it('rejects a missing, duplicate, or reordered fixed track', () => {
    const timeline = createTimeline();

    expect(
      isTimelineViewModel({ ...timeline, tracks: timeline.tracks.slice(0, 5) }),
    ).toBe(false);
    expect(
      isTimelineViewModel({
        ...timeline,
        tracks: [timeline.tracks[0], ...timeline.tracks.slice(0, 5)],
      }),
    ).toBe(false);
    expect(
      isTimelineViewModel({
        ...timeline,
        tracks: [...timeline.tracks].reverse(),
      }),
    ).toBe(false);
  });

  it('rejects an invalid clip range and a note marker outside its clip', () => {
    const timeline = createTimeline();
    const firstTrack = timeline.tracks[0];
    const firstClip = firstTrack?.clips[0];
    expect(firstTrack).toBeDefined();
    expect(firstClip).toBeDefined();
    if (firstTrack === undefined || firstClip === undefined) return;

    const withBadClip = {
      ...timeline,
      tracks: timeline.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              clips: [{ ...firstClip, endTick: tick(15_361) }],
            }
          : track,
      ),
    };
    const withBadMarker = {
      ...timeline,
      tracks: timeline.tracks.map((track, index) =>
        index === 0
          ? {
              ...track,
              clips: [
                {
                  ...firstClip,
                  noteMarkers: [
                    {
                      ...firstClip.noteMarkers[0],
                      startTick: tick(15_300),
                      endTick: tick(15_480),
                    },
                  ],
                },
              ],
            }
          : track,
      ),
    };

    expect(isTimelineViewModel(withBadClip)).toBe(false);
    expect(isTimelineViewModel(withBadMarker)).toBe(false);
    expect(
      isTimelineClip({
        ...firstClip,
        startTick: tick(960),
        endTick: tick(960),
      }),
    ).toBe(false);
  });

  it('rejects unordered/out-of-range maps and SDK-shaped extra fields', () => {
    const timeline = createTimeline();
    const firstTrack = timeline.tracks[0];
    const firstClip = firstTrack?.clips[0];
    expect(firstTrack).toBeDefined();
    expect(firstClip).toBeDefined();
    if (firstTrack === undefined || firstClip === undefined) return;

    expect(
      isTimelineViewModel({
        ...timeline,
        tempoMap: [
          { tick: tick(0), bpm: 112 },
          { tick: tick(0), bpm: 118 },
        ],
      }),
    ).toBe(false);
    expect(
      isTimelineViewModel({
        ...timeline,
        meterMap: [{ tick: tick(15_360), numerator: 4, denominator: 4 }],
      }),
    ).toBe(false);
    expect(isTimelineViewModel({ ...timeline, runtimeUuid: 'sdk-uuid' })).toBe(
      false,
    );
    expect(
      isTimelineViewModel({
        ...timeline,
        tracks: [
          {
            ...firstTrack,
            clips: [{ ...firstClip, boxGraph: {} }],
          },
          ...timeline.tracks.slice(1),
        ],
      }),
    ).toBe(false);
    expect(JSON.stringify(timeline)).not.toMatch(/uuid|boxGraph/i);
  });
});

describe('RendererCommand runtime boundary', () => {
  it('accepts the typed command set with a requestId', () => {
    expect(
      isRendererCommand({
        type: 'startTask',
        requestId: 'request-1',
        projectId,
        prompt: 'Add a restrained bass counterline.',
        scope: {
          type: 'timeRange',
          trackIds: ['track.bass'],
          startTick: tick(0),
          endTick: tick(3_840),
        },
        scopeRevision: 1,
      }),
    ).toBe(true);
    expect(
      isRendererCommand({
        type: 'loadPreview',
        requestId: 'request-2',
        projectId,
        source: { kind: 'candidate', candidateId },
      }),
    ).toBe(true);
  });

  it('rejects a missing requestId, invalid scope range, and raw SDK fields', () => {
    expect(
      isRendererCommand({
        type: 'cancelTask',
        requestId: '',
        projectId,
        taskId,
      }),
    ).toBe(false);
    expect(
      isRendererCommand({
        type: 'createScope',
        requestId: 'request-3',
        projectId,
        scope: {
          type: 'timeRange',
          trackIds: ['track.keys'],
          startTick: tick(1_920),
          endTick: tick(960),
        },
      }),
    ).toBe(false);
    expect(
      isRendererCommand({
        type: 'loadPreview',
        requestId: 'request-4',
        projectId,
        source: { kind: 'current', uuid: 'open-daw-uuid' },
      }),
    ).toBe(false);
  });
});

describe('Core state/event runtime boundary', () => {
  it('accepts a complete bootstrap snapshot and matching sequenced event', () => {
    const state = createBootstrap();

    expect(isCoreBootstrapState(state)).toBe(true);
    expect(
      isCoreEvent({
        type: 'bootstrapChanged',
        projectId,
        sequence: 7,
        state,
      }),
    ).toBe(true);
  });

  it('rejects zero, negative, fractional, and mismatched event sequences', () => {
    const baseEvent = {
      type: 'taskChanged',
      projectId,
      task: { status: 'idle' },
    };

    expect(isCoreEvent({ ...baseEvent, sequence: 0 })).toBe(false);
    expect(isCoreEvent({ ...baseEvent, sequence: -1 })).toBe(false);
    expect(isCoreEvent({ ...baseEvent, sequence: 1.5 })).toBe(false);
    expect(
      isCoreEvent({
        type: 'bootstrapChanged',
        projectId,
        sequence: 8,
        state: createBootstrap(),
      }),
    ).toBe(false);
  });

  it('rejects malformed, unknown, and SDK-leaking events', () => {
    expect(
      isCoreEvent({
        type: 'timelineChanged',
        projectId,
        sequence: 8,
        source: { kind: 'current' },
        timeline: { ...createTimeline(), totalTicks: tick(0) },
      }),
    ).toBe(false);
    expect(
      isCoreEvent({
        type: 'boxGraphChanged',
        projectId,
        sequence: 8,
        boxGraph: {},
      }),
    ).toBe(false);
    expect(
      isCoreEvent({
        type: 'errorOccurred',
        projectId,
        sequence: 8,
        error: uiError,
        uuid: 'open-daw-uuid',
      }),
    ).toBe(false);
  });
});
