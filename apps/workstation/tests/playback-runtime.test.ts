import {
  TRACK_IDS,
  type CandidateId,
  type PlaybackCompilation,
  type Tick,
} from '../src/renderer/b-contracts/index.js';
import { describe, expect, it, vi } from 'vitest';

import {
  canonicalizeExternalAbc,
  compileComposition,
} from '../src/core/composition/index.js';
import type { RuntimeSource } from '../src/renderer/opendaw-runtime/index.js';
import { createInMemoryPlaybackRuntime } from '../src/renderer/opendaw-runtime/testing.js';

const tick = (value: number): Tick => value as Tick;
const candidateId = (value: string): CandidateId => value as CandidateId;

const source = (
  kind: 'current' | 'candidate',
  revision: string,
): RuntimeSource =>
  kind === 'current'
    ? { kind, revision }
    : { kind, revision, candidateId: candidateId('candidate.test') };

const compilation = (bars: number): PlaybackCompilation => {
  const body = Array.from({ length: bars }, () => 'C4 |').join(' ');
  const abc = `X:1
T:Runtime fixture
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map((trackId) => `[V:${trackId}] ${body}`).join('\n')}
`;
  return compileComposition(canonicalizeExternalAbc(abc)).playback;
};

const deferred = (): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
};

describe('PlaybackRuntime public interface', () => {
  it('keeps one cache per source while sync leaves the active runtime playing', async () => {
    const runtime = createInMemoryPlaybackRuntime();
    const current1 = source('current', 'current.1');
    const current2 = source('current', 'current.2');
    const candidate = source('candidate', 'candidate.1');

    await expect(runtime.syncSource(current1, compilation(2))).resolves.toEqual(
      {
        status: 'applied',
      },
    );
    await runtime.syncSource(candidate, compilation(1));
    await runtime.activateSource(current1);
    await runtime.send({ type: 'play' });
    await runtime.syncSource(current2, compilation(3));

    expect(runtime.getSnapshot()).toMatchObject({
      activeSource: current1,
      cachedSources: { current: current2, candidate },
      transport: 'playing',
    });
    await expect(runtime.syncSource(current2, compilation(3))).resolves.toEqual(
      {
        status: 'unchanged',
      },
    );
    await runtime.dispose();
  });

  it('aborts a stale build when a newer source revision starts', async () => {
    const staleBuildStarted = deferred();
    const staleBuildAborted = deferred();
    const runtime = createInMemoryPlaybackRuntime({
      beforeBuild: async (input, signal) => {
        if (input.totalTicks !== tick(3840)) return;
        staleBuildStarted.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              staleBuildAborted.resolve();
              resolve();
            },
            { once: true },
          );
        });
      },
    });
    const stale = source('current', 'current.stale');
    const latest = source('current', 'current.latest');

    const staleResult = runtime.syncSource(stale, compilation(1));
    await staleBuildStarted.promise;
    await expect(runtime.syncSource(latest, compilation(2))).resolves.toEqual({
      status: 'applied',
    });

    await staleBuildAborted.promise;
    await expect(staleResult).resolves.toEqual({ status: 'stale' });
    expect(runtime.getSnapshot().cachedSources.current).toEqual(latest);
    await runtime.dispose();
  });

  it('switches paused, clamps Tick and Loop, and restores every mix control', async () => {
    const runtime = createInMemoryPlaybackRuntime();
    const current = source('current', 'current.long');
    const candidate = source('candidate', 'candidate.short');
    await runtime.syncSource(current, compilation(2));
    await runtime.syncSource(candidate, compilation(1));
    await runtime.activateSource(current);
    await runtime.send({ type: 'seek', tick: tick(7000) });
    await runtime.send({
      type: 'setLoop',
      range: { startTick: tick(3000), endTick: tick(7000) },
    });
    await runtime.send({
      type: 'setMute',
      trackId: 'track.drums',
      muted: true,
    });
    await runtime.send({
      type: 'setSolo',
      trackId: 'track.keys',
      solo: true,
    });
    await runtime.send({ type: 'play' });

    await expect(runtime.activateSource(candidate)).resolves.toEqual({
      status: 'applied',
    });
    expect(runtime.getSnapshot()).toMatchObject({
      activeSource: candidate,
      transport: 'paused',
      positionTick: 3840,
      loopRange: { startTick: 3000, endTick: 3840 },
      mutedTrackIds: ['track.drums'],
      soloTrackIds: ['track.keys'],
    });
    await expect(runtime.send({ type: 'play' })).resolves.toEqual({
      status: 'applied',
    });
    await runtime.dispose();
  });

  it('keeps a cache revision synchronized while another source is activating', async () => {
    const loadStarted = deferred();
    const releaseLoad = deferred();
    const current = source('current', 'current.activating');
    const candidate1 = source('candidate', 'candidate.before-activation');
    const candidate2 = source('candidate', 'candidate.during-activation');
    const runtime = createInMemoryPlaybackRuntime({
      beforeLoad: async (input) => {
        if (input.totalTicks !== tick(7680)) return;
        loadStarted.resolve();
        await releaseLoad.promise;
      },
    });
    await runtime.syncSource(current, compilation(2));
    await runtime.syncSource(candidate1, compilation(1));

    const activation = runtime.activateSource(current);
    await loadStarted.promise;
    await runtime.syncSource(candidate2, compilation(3));
    releaseLoad.resolve();

    await expect(activation).resolves.toEqual({ status: 'applied' });
    expect(runtime.getSnapshot()).toMatchObject({
      activeSource: current,
      cachedSources: { current, candidate: candidate2 },
    });
    await expect(
      runtime.syncSource(candidate2, compilation(3)),
    ).resolves.toEqual({ status: 'unchanged' });
    expect(runtime.getSnapshot().cachedSources.candidate).toEqual(candidate2);
    await runtime.dispose();
  });

  it('rolls back a partial Candidate load without losing usable Current', async () => {
    const runtime = createInMemoryPlaybackRuntime({
      failLoadAfterApply: (input) => input.totalTicks === tick(3840),
    });
    const current = source('current', 'current.safe');
    const candidate = source('candidate', 'candidate.broken');
    await runtime.syncSource(current, compilation(2));
    await runtime.syncSource(candidate, compilation(1));
    await runtime.activateSource(current);
    await runtime.send({ type: 'seek', tick: tick(2500) });
    await runtime.send({
      type: 'setLoop',
      range: { startTick: tick(1000), endTick: tick(3000) },
    });
    await runtime.send({
      type: 'setMute',
      trackId: 'track.bass',
      muted: true,
    });

    const outcome = await runtime.activateSource(candidate);

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: {
        code: 'snapshot-load-failed',
        activeSourcePreserved: true,
      },
    });
    expect(runtime.getSnapshot()).toMatchObject({
      activeSource: current,
      transport: 'paused',
      positionTick: 2500,
      loopRange: { startTick: 1000, endTick: 3000 },
      mutedTrackIds: ['track.bass'],
    });
    await expect(runtime.send({ type: 'play' })).resolves.toEqual({
      status: 'applied',
    });
    await runtime.dispose();
  });

  it('applies Transport commands and keeps Loop/Mute/Solo as product state', async () => {
    const runtime = createInMemoryPlaybackRuntime();
    const current = source('current', 'current.transport');

    await expect(runtime.send({ type: 'play' })).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'no-active-source' },
    });
    await runtime.send({
      type: 'setLoop',
      range: { startTick: tick(100), endTick: tick(500) },
    });
    await runtime.send({
      type: 'setSolo',
      trackId: 'track.strings',
      solo: true,
    });
    await runtime.syncSource(current, compilation(1));
    await runtime.activateSource(current);
    await runtime.send({ type: 'seek', tick: tick(99_999) });
    await runtime.send({ type: 'play' });
    await runtime.send({ type: 'pause' });
    await runtime.send({ type: 'stop' });

    expect(runtime.getSnapshot()).toMatchObject({
      transport: 'stopped',
      positionTick: 0,
      loopRange: { startTick: 100, endTick: 500 },
      soloTrackIds: ['track.strings'],
    });
    await runtime.dispose();
  });

  it('serializes commands that overlap asynchronously', async () => {
    const playStarted = deferred();
    const releasePlay = deferred();
    const runtime = createInMemoryPlaybackRuntime({
      beforePlay: async () => {
        playStarted.resolve();
        await releasePlay.promise;
      },
    });
    const current = source('current', 'current.serial');
    await runtime.syncSource(current, compilation(1));
    await runtime.activateSource(current);

    const play = runtime.send({ type: 'play' });
    await playStarted.promise;
    const seekSettled = vi.fn();
    const seek = runtime
      .send({ type: 'seek', tick: tick(960) })
      .then(seekSettled);
    await Promise.resolve();
    expect(seekSettled).not.toHaveBeenCalled();

    releasePlay.resolve();
    await expect(play).resolves.toEqual({ status: 'applied' });
    await seek;
    expect(runtime.getSnapshot()).toMatchObject({
      transport: 'playing',
      positionTick: 960,
    });
    await runtime.dispose();
  });

  it('rejects invalid compilation without replacing a good cache', async () => {
    const runtime = createInMemoryPlaybackRuntime();
    const good = source('current', 'current.good');
    await runtime.syncSource(good, compilation(1));

    const invalid = { ...compilation(1), totalTicks: tick(0) };
    await expect(
      runtime.syncSource(
        source('current', 'current.invalid'),
        invalid as PlaybackCompilation,
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'invalid-compilation' },
    });
    expect(runtime.getSnapshot().cachedSources.current).toEqual(good);
    await runtime.dispose();
  });

  it('notifies a subscriber added while disposal is still in progress', async () => {
    const engineDisposeStarted = deferred();
    const releaseEngineDispose = deferred();
    const runtime = createInMemoryPlaybackRuntime({
      beforeDispose: async () => {
        engineDisposeStarted.resolve();
        await releaseEngineDispose.promise;
      },
    });

    const disposal = runtime.dispose();
    await engineDisposeStarted.promise;
    expect(runtime.getSnapshot().lifecycle).toBe('running');

    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);
    releaseEngineDispose.resolve();
    await disposal;

    expect(listener).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().lifecycle).toBe('disposed');
    unsubscribe();
  });

  it('keeps repeated subscriptions of the same listener independent', async () => {
    const runtime = createInMemoryPlaybackRuntime();
    const listener = vi.fn();
    const unsubscribeFirst = runtime.subscribe(listener);
    const unsubscribeSecond = runtime.subscribe(listener);
    unsubscribeFirst();

    await runtime.send({
      type: 'setLoop',
      range: { startTick: tick(100), endTick: tick(200) },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribeSecond();
    await runtime.send({ type: 'setLoop', range: null });
    expect(listener).toHaveBeenCalledTimes(1);
    await runtime.dispose();
  });

  it('does not call a listener removed earlier in the same publication', async () => {
    const runtime = createInMemoryPlaybackRuntime();
    const removedListener = vi.fn();
    let removeListener = (): void => undefined;
    const removeFirstListener = runtime.subscribe(() => {
      removeListener();
    });
    removeListener = runtime.subscribe(removedListener);

    await runtime.send({
      type: 'setLoop',
      range: { startTick: tick(200), endTick: tick(400) },
    });

    expect(removedListener).not.toHaveBeenCalled();
    removeFirstListener();
    await runtime.dispose();
  });

  it('aborts and joins pending builds before disposing the engine', async () => {
    const buildStarted = deferred();
    const buildAborted = deferred();
    const releaseBuildCleanup = deferred();
    const lifecycleEvents: string[] = [];
    const runtime = createInMemoryPlaybackRuntime({
      beforeBuild: async (_input, signal) => {
        buildStarted.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              lifecycleEvents.push('build-aborted');
              buildAborted.resolve();
              void releaseBuildCleanup.promise.then(() => {
                lifecycleEvents.push('build-cleaned');
                resolve();
              });
            },
            { once: true },
          );
        });
      },
      beforeDispose: () => {
        lifecycleEvents.push('engine-disposed');
      },
    });
    const listener = vi.fn();
    runtime.subscribe(listener);
    const pending = runtime.syncSource(
      source('current', 'current.late'),
      compilation(1),
    );
    await buildStarted.promise;

    const firstDispose = runtime.dispose();
    const secondDispose = runtime.dispose();
    expect(secondDispose).toBe(firstDispose);
    let disposeSettled = false;
    void firstDispose.then(() => {
      disposeSettled = true;
    });
    await buildAborted.promise;
    await Promise.resolve();
    expect(disposeSettled).toBe(false);
    expect(lifecycleEvents).toEqual(['build-aborted']);

    releaseBuildCleanup.resolve();
    await firstDispose;
    const callsAtDispose = listener.mock.calls.length;

    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'disposed' },
    });
    expect(lifecycleEvents).toEqual([
      'build-aborted',
      'build-cleaned',
      'engine-disposed',
    ]);
    expect(listener).toHaveBeenCalledTimes(callsAtDispose);
    expect(runtime.getSnapshot()).toMatchObject({
      lifecycle: 'disposed',
      activeSource: null,
      cachedSources: { current: null, candidate: null },
    });
    await expect(runtime.send({ type: 'play' })).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'disposed' },
    });
  });
});
