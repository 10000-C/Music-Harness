import {
  isCoreBootstrapState,
  type CoreBootstrapState,
  type CoreEvent,
  type ProjectId,
  type RendererCommand,
  type Tick,
  type TrackId,
} from '../src/renderer/b-contracts/index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  FAKE_CANDIDATE_ID,
  FAKE_PROJECT_ID,
  FakeWorkstationCoreClient,
  fakeCoreFixtures,
  getFakeCoreFixture,
} from '../src/renderer/core-client/index.js';
import type {
  CoreEventListener,
  WorkstationCoreClient,
} from '../src/renderer/core-client/workstation-core-client.js';
import {
  connectWorkstationStore,
  createWorkstationState,
  reduceWorkstationState,
  sequenceCoreEvent,
} from '../src/renderer/state/index.js';

const tick = (value: number): Tick => value as Tick;
const OTHER_PROJECT_ID = 'project.old-session' as ProjectId;

const candidateRemovedEvent = (
  sequence: number,
  projectId: ProjectId = FAKE_PROJECT_ID,
): CoreEvent => ({
  type: 'candidateChanged',
  projectId,
  sequence,
  candidate: { status: 'none' },
});

const idleTaskEvent = (
  sequence: number,
  projectId: ProjectId = FAKE_PROJECT_ID,
): CoreEvent => ({
  type: 'taskChanged',
  projectId,
  sequence,
  task: { status: 'idle' },
});

const openedProjectEvent = (sequence: number): CoreEvent => {
  const fixture = getFakeCoreFixture('stable');
  if (fixture.project.status !== 'open') {
    throw new Error('Stable fixture needs an open project.');
  }

  return {
    type: 'projectChanged',
    projectId: fixture.project.projectId,
    sequence,
    project: fixture.project,
    current: fixture.current,
    timeline: fixture.timeline,
  };
};

describe('deterministic Fake Core fixtures', () => {
  it('provides valid blank, stable, running, failed, and Candidate states', () => {
    expect(Object.keys(fakeCoreFixtures)).toEqual([
      'blank',
      'stable',
      'running',
      'failed',
      'candidate',
    ]);

    for (const fixture of Object.values(fakeCoreFixtures)) {
      expect(isCoreBootstrapState(fixture)).toBe(true);
      expect(fixture.timeline.tracks).toHaveLength(6);
    }

    expect(fakeCoreFixtures.blank.current).toMatchObject({
      status: 'ready',
      isEmpty: true,
    });
    expect(fakeCoreFixtures.running.task).toMatchObject({
      status: 'active',
      stage: 'editing',
      scope: {
        type: 'timeRange',
        trackIds: ['track.guitar', 'track.keys'],
        startTick: 61_440,
        endTick: 122_880,
      },
    });
    expect(fakeCoreFixtures.stable.timeline.totalTicks).toBe(122_880);
    expect(fakeCoreFixtures.failed.errors).toHaveLength(1);
    expect(fakeCoreFixtures.candidate.candidate).toMatchObject({
      status: 'ready',
      candidateId: FAKE_CANDIDATE_ID,
    });
  });

  it('returns independent fixture snapshots', () => {
    const first = getFakeCoreFixture('stable');
    const second = getFakeCoreFixture('stable');

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.timeline).not.toBe(second.timeline);
  });
});

describe('Core event sequencing', () => {
  const state = getFakeCoreFixture('stable');

  it('accepts a later same-project event, including a sequence gap', () => {
    expect(sequenceCoreEvent(state, idleTaskEvent(40))).toEqual({
      accepted: true,
    });
  });

  it('rejects duplicate, out-of-order, and old-project events distinctly', () => {
    expect(sequenceCoreEvent(state, idleTaskEvent(12))).toEqual({
      accepted: false,
      reason: 'duplicate',
    });
    expect(sequenceCoreEvent(state, idleTaskEvent(11))).toEqual({
      accepted: false,
      reason: 'out-of-order',
    });
    expect(
      sequenceCoreEvent(state, idleTaskEvent(100, OTHER_PROJECT_ID)),
    ).toEqual({
      accepted: false,
      reason: 'old-project',
    });
  });

  it('rejects project events until an active project bootstrap is available', () => {
    const closed: CoreBootstrapState = {
      ...state,
      sequence: 0,
      project: { status: 'closed' },
      current: { status: 'unavailable' },
      timeline: null,
    };

    expect(sequenceCoreEvent(closed, idleTaskEvent(1))).toEqual({
      accepted: false,
      reason: 'no-active-project',
    });
    expect(sequenceCoreEvent(closed, openedProjectEvent(1))).toEqual({
      accepted: true,
    });
    expect(sequenceCoreEvent(closed, openedProjectEvent(0))).toEqual({
      accepted: false,
      reason: 'duplicate',
    });
  });
});

describe('Workstation reducer', () => {
  it('keeps Core authority separate from Renderer-only interaction state', () => {
    const initial = createWorkstationState(getFakeCoreFixture('candidate'));
    const authoritative = initial.authoritative;
    const selectedTrackIds = [
      'track.keys',
      'track.drums',
      'track.keys',
    ] as const satisfies readonly TrackId[];

    const withPlayback = reduceWorkstationState(initial, {
      type: 'ui/playbackTickChanged',
      tick: tick(12_000),
    });
    const withPreview = reduceWorkstationState(withPlayback, {
      type: 'ui/previewTargetChanged',
      target: 'candidate',
    });
    const withTracks = reduceWorkstationState(withPreview, {
      type: 'ui/trackSelectionChanged',
      trackIds: selectedTrackIds,
    });
    const withRange = reduceWorkstationState(withTracks, {
      type: 'ui/timeRangeChanged',
      range: { startTick: tick(7680), endTick: tick(15_360) },
    });
    const withTab = reduceWorkstationState(withRange, {
      type: 'ui/tabChanged',
      tab: 'activity',
    });

    expect(withTab.authoritative).toBe(authoritative);
    expect(withTab.ui).toEqual({
      playbackTick: 12_000,
      previewTarget: 'candidate',
      selectedTrackIds: ['track.drums', 'track.keys'],
      timeRange: { startTick: 7680, endTick: 15_360 },
      loopRange: null,
      timelineZoom: 1,
      timelineStartTick: 0,
      tab: 'activity',
    });
  });

  it('applies an accepted Core event without replacing unrelated UI state', () => {
    const initial = createWorkstationState(getFakeCoreFixture('candidate'));
    const selected = reduceWorkstationState(initial, {
      type: 'ui/trackSelectionChanged',
      trackIds: ['track.bass'],
    });
    const previewing = reduceWorkstationState(selected, {
      type: 'ui/previewTargetChanged',
      target: 'candidate',
    });
    const updated = reduceWorkstationState(previewing, {
      type: 'core/eventReceived',
      event: candidateRemovedEvent(32),
    });

    expect(updated.authoritative.sequence).toBe(32);
    expect(updated.authoritative.candidate).toEqual({ status: 'none' });
    expect(updated.ui).toEqual({
      ...previewing.ui,
      previewTarget: 'current',
    });
    expect(updated.ui.selectedTrackIds).toEqual(['track.bass']);
  });

  it('does not notify state changes for rejected events', () => {
    const initial = createWorkstationState(getFakeCoreFixture('stable'));

    expect(
      reduceWorkstationState(initial, {
        type: 'core/eventReceived',
        event: idleTaskEvent(12),
      }),
    ).toBe(initial);
    expect(
      reduceWorkstationState(initial, {
        type: 'core/eventReceived',
        event: idleTaskEvent(11),
      }),
    ).toBe(initial);
    expect(
      reduceWorkstationState(initial, {
        type: 'core/eventReceived',
        event: idleTaskEvent(100, OTHER_PROJECT_ID),
      }),
    ).toBe(initial);
  });

  it('keeps referential identity for repeated Renderer-only actions', () => {
    const initial = createWorkstationState(getFakeCoreFixture('stable'));

    expect(
      reduceWorkstationState(initial, {
        type: 'ui/playbackTickChanged',
        tick: tick(0),
      }),
    ).toBe(initial);
    expect(
      reduceWorkstationState(initial, {
        type: 'ui/trackSelectionChanged',
        trackIds: [
          'track.winds',
          'track.strings',
          'track.keys',
          'track.guitar',
          'track.bass',
          'track.drums',
        ],
      }),
    ).toBe(initial);
    expect(
      reduceWorkstationState(initial, {
        type: 'ui/timeRangeChanged',
        range: null,
      }),
    ).toBe(initial);
    expect(
      reduceWorkstationState(initial, {
        type: 'ui/loopRangeChanged',
        range: null,
      }),
    ).toBe(initial);
    expect(
      reduceWorkstationState(initial, {
        type: 'ui/timelineZoomChanged',
        zoom: 1,
      }),
    ).toBe(initial);
  });

  it('tracks loop, zoom, and scroll as Renderer-only state', () => {
    let state = createWorkstationState(getFakeCoreFixture('stable'));
    const authoritative = state.authoritative;

    state = reduceWorkstationState(state, {
      type: 'ui/loopRangeChanged',
      range: { startTick: tick(30_720), endTick: tick(61_440) },
    });
    state = reduceWorkstationState(state, {
      type: 'ui/timelineZoomChanged',
      zoom: 2,
    });
    state = reduceWorkstationState(state, {
      type: 'ui/timelineStartTickChanged',
      tick: tick(40_000),
    });

    expect(state.authoritative).toBe(authoritative);
    expect(state.ui).toMatchObject({
      loopRange: { startTick: 30_720, endTick: 61_440 },
      timelineZoom: 2,
      timelineStartTick: 40_000,
    });
  });

  it('clamps playback and Scope when the authoritative timeline shrinks', () => {
    let state = createWorkstationState(getFakeCoreFixture('stable'));
    state = reduceWorkstationState(state, {
      type: 'ui/playbackTickChanged',
      tick: tick(28_000),
    });
    state = reduceWorkstationState(state, {
      type: 'ui/timeRangeChanged',
      range: { startTick: tick(14_000), endTick: tick(29_000) },
    });
    state = reduceWorkstationState(state, {
      type: 'ui/loopRangeChanged',
      range: { startTick: tick(14_500), endTick: tick(30_000) },
    });
    state = reduceWorkstationState(state, {
      type: 'ui/timelineZoomChanged',
      zoom: 2,
    });
    state = reduceWorkstationState(state, {
      type: 'ui/timelineStartTickChanged',
      tick: tick(28_000),
    });

    const blankTimeline = getFakeCoreFixture('blank').timeline;
    if (blankTimeline === null)
      throw new Error('Blank fixture needs a timeline.');
    const shortTimeline = {
      ...blankTimeline,
      revision: 'timeline.short-test',
      totalTicks: tick(15_360),
    };

    state = reduceWorkstationState(state, {
      type: 'core/eventReceived',
      event: {
        type: 'timelineChanged',
        projectId: FAKE_PROJECT_ID,
        sequence: 13,
        source: { kind: 'current' },
        timeline: shortTimeline,
      },
    });

    expect(state.ui.playbackTick).toBe(15_360);
    expect(state.ui.timeRange).toEqual({
      startTick: 14_000,
      endTick: 15_360,
    });
    expect(state.ui.loopRange).toEqual({
      startTick: 14_500,
      endTick: 15_360,
    });
    expect(state.ui.timelineStartTick).toBe(7680);
  });
});

describe('Workstation store and Fake Core adapter', () => {
  it('uses stable listener snapshots during re-entrant Fake Core delivery', () => {
    const client = new FakeWorkstationCoreClient(getFakeCoreFixture('stable'));
    const lateListener = vi.fn();
    const removedListener = vi.fn();
    let unsubscribeRemoved = (): void => undefined;

    client.subscribe(() => {
      client.subscribe(lateListener);
      unsubscribeRemoved();
    });
    unsubscribeRemoved = client.subscribe(removedListener);

    client.emit(idleTaskEvent(13));
    expect(lateListener).not.toHaveBeenCalled();
    expect(removedListener).not.toHaveBeenCalled();

    client.emit(idleTaskEvent(14));
    expect(lateListener).toHaveBeenCalledTimes(1);
  });

  it('receives ordered state, delegates commands, and disposes cleanly', async () => {
    const client = new FakeWorkstationCoreClient(getFakeCoreFixture('stable'));
    const store = await connectWorkstationStore(client);
    const listener = vi.fn();
    store.subscribe(listener);

    client.emit(idleTaskEvent(13));
    client.emit(idleTaskEvent(13));

    expect(store.getState().authoritative.sequence).toBe(13);
    expect(listener).toHaveBeenCalledTimes(1);

    const command: RendererCommand = {
      type: 'loadPreview',
      requestId: 'request-preview-001',
      projectId: FAKE_PROJECT_ID,
      source: { kind: 'current' },
    };
    await store.execute(command);
    expect(client.getReceivedCommands()).toEqual([command]);

    store.dispose();
    client.emit(candidateRemovedEvent(14));
    expect(store.getState().authoritative.sequence).toBe(13);
    await expect(store.execute(command)).rejects.toThrow(
      'Cannot execute a command after store disposal.',
    );
  });

  it('uses stable listener snapshots during re-entrant store publication', async () => {
    const client = new FakeWorkstationCoreClient(getFakeCoreFixture('stable'));
    const store = await connectWorkstationStore(client);
    const lateListener = vi.fn();
    const removedListener = vi.fn();
    let unsubscribeRemoved = (): void => undefined;

    store.subscribe(() => {
      store.subscribe(lateListener);
      unsubscribeRemoved();
    });
    unsubscribeRemoved = store.subscribe(removedListener);

    client.emit(idleTaskEvent(13));
    expect(lateListener).not.toHaveBeenCalled();
    expect(removedListener).not.toHaveBeenCalled();

    client.emit(idleTaskEvent(14));
    expect(lateListener).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('queues events that arrive while bootstrap is in flight', async () => {
    const callbacks: {
      coreListener?: CoreEventListener;
      resolveBootstrap?: (state: CoreBootstrapState) => void;
    } = {};
    const bootstrapPromise = new Promise<CoreBootstrapState>((resolve) => {
      callbacks.resolveBootstrap = resolve;
    });

    const client: WorkstationCoreClient = {
      getBootstrapState: async () => bootstrapPromise,
      readPlayback: async () => null,
      dispatch: async () => undefined,
      subscribe: (listener) => {
        callbacks.coreListener = listener;
        return () => {
          delete callbacks.coreListener;
        };
      },
    };

    const connecting = connectWorkstationStore(client);
    callbacks.coreListener?.(idleTaskEvent(13));
    callbacks.resolveBootstrap?.(getFakeCoreFixture('stable'));
    const store = await connecting;

    expect(store.getState().authoritative.sequence).toBe(13);
    store.dispose();
  });

  it('unsubscribes promptly when an in-flight bootstrap is aborted', async () => {
    let resolveBootstrap = (_state: CoreBootstrapState): void => undefined;
    const bootstrapPromise = new Promise<CoreBootstrapState>((resolve) => {
      resolveBootstrap = resolve;
    });
    const unsubscribe = vi.fn();
    const client: WorkstationCoreClient = {
      getBootstrapState: async () => bootstrapPromise,
      readPlayback: async () => null,
      dispatch: async () => undefined,
      subscribe: () => unsubscribe,
    };
    const abortController = new AbortController();

    const connecting = connectWorkstationStore(client, {
      signal: abortController.signal,
    });
    abortController.abort();

    await expect(connecting).rejects.toThrow(
      'Workstation store connection was aborted.',
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    resolveBootstrap(getFakeCoreFixture('stable'));
  });
});
