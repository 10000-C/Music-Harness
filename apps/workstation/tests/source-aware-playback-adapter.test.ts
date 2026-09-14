import {
  canonicalizeExternalAbc,
  compileComposition,
  createInitialCanonicalAbc,
} from '../src/core/composition/index.js';
import type { CandidateId, ProjectId, Tick } from '@agent-music/contracts';
import { describe, expect, it } from 'vitest';
import {
  createFakePlaybackBridge,
  createSourceAwarePlaybackAdapter,
} from '../src/renderer/opendaw-runtime/index.js';
import { createInMemoryPlaybackRuntime } from '../src/renderer/opendaw-runtime/testing.js';
import type { PlaybackRuntime } from '../src/renderer/opendaw-runtime/types.js';
import type { CorePlaybackSnapshot } from '../src/shared/playback-bridge.js';

const projectId = '00000000-0000-4000-8000-000000000201' as ProjectId;
const candidateId = '00000000-0000-4000-8000-000000000202' as CandidateId;
const compiled = compileComposition(
  canonicalizeExternalAbc(`X:1
T:Source aware
M:4/4
L:1/4
Q:1/4=120
K:C
V:track.drums
V:track.bass
V:track.guitar
V:track.keys
V:track.strings
V:track.winds
[V:track.drums] z4 |
[V:track.bass] C,4 |
[V:track.guitar] E4 |
[V:track.keys] C4 |
[V:track.strings] G4 |
[V:track.winds] c4 |`),
);

const snapshot = (
  source: CorePlaybackSnapshot['source'],
): CorePlaybackSnapshot => ({
  type: 'playback.snapshot',
  protocolVersion: 1,
  requestId: `snapshot-${source.kind}-${source.revision}`,
  projectId,
  source,
  revision: source.revision,
  compilation: compiled.playback,
  timeline: compiled.timelineViewModel,
});

describe('source-aware playback adapter', () => {
  it('switches one runtime across Current and Candidate while preserving transport preferences', async () => {
    const current = snapshot({ kind: 'current', revision: 'current-1' });
    const candidate = snapshot({
      kind: 'candidate',
      candidateId,
      revision: 'candidate-1',
    });
    const bridge = createFakePlaybackBridge([current, candidate]);
    const runtimes: PlaybackRuntime[] = [];
    const adapter = createSourceAwarePlaybackAdapter({
      projectId,
      bridge,
      createRuntime: () => {
        const runtime = createInMemoryPlaybackRuntime();
        runtimes.push(runtime);
        return runtime;
      },
    });

    await expect(
      adapter.load({ kind: 'current', revision: 'current-1' }),
    ).resolves.toMatchObject({ status: 'applied' });
    await adapter.send({ type: 'seek', tick: 2 as Tick });
    await adapter.send({
      type: 'setLoop',
      range: { startTick: 1 as Tick, endTick: 4 as Tick },
    });
    await adapter.send({ type: 'setMute', trackId: 'track.bass', muted: true });
    await adapter.send({
      type: 'setSolo',
      trackId: 'track.guitar',
      solo: true,
    });

    await expect(
      adapter.load({ kind: 'candidate', candidateId, revision: 'candidate-1' }),
    ).resolves.toMatchObject({ status: 'applied' });
    const candidateState = adapter.getSnapshot();
    expect(runtimes).toHaveLength(1);
    expect(candidateState).toMatchObject({
      activeSource: { kind: 'candidate', candidateId, revision: 'candidate-1' },
      positionTick: 2,
      loopRange: { startTick: 1, endTick: 4 },
      mutedTrackIds: ['track.bass'],
      soloTrackIds: ['track.guitar'],
      cachedSources: { current: { kind: 'current', revision: 'current-1' } },
    });

    const updatedCandidate = snapshot({
      kind: 'candidate',
      candidateId,
      revision: 'candidate-2',
    });
    bridge.replaceSnapshot(updatedCandidate);
    await expect(
      adapter.update({
        kind: 'candidate',
        candidateId,
        revision: 'candidate-2',
      }),
    ).resolves.toMatchObject({ status: 'applied' });
    expect(adapter.getSnapshot()).toMatchObject({
      activeSource: { kind: 'candidate', revision: 'candidate-2' },
      cachedSources: { current: { kind: 'current', revision: 'current-1' } },
    });

    await expect(
      adapter.load({ kind: 'current', revision: 'current-1' }),
    ).resolves.toMatchObject({ status: 'applied' });
    expect(adapter.getSnapshot()).toMatchObject({
      activeSource: { kind: 'current', revision: 'current-1' },
      positionTick: 2,
      mutedTrackIds: ['track.bass'],
      soloTrackIds: ['track.guitar'],
    });
    await adapter.dispose();
    expect(adapter.getSnapshot()).toBeNull();
  });

  it('fails safely when a requested snapshot cannot load and keeps the active source', async () => {
    const current = snapshot({ kind: 'current', revision: 'current-1' });
    const bridge = createFakePlaybackBridge([current]);
    const adapter = createSourceAwarePlaybackAdapter({
      projectId,
      bridge,
      createRuntime: () => createInMemoryPlaybackRuntime(),
    });

    await adapter.load({ kind: 'current', revision: 'current-1' });
    const failed = await adapter.load({
      kind: 'candidate',
      candidateId,
      revision: 'missing',
    });
    expect(failed).toMatchObject({
      status: 'failed',
      failure: { activeSourcePreserved: true },
    });
    expect(adapter.getSnapshot()).toMatchObject({
      activeSource: { kind: 'current', revision: 'current-1' },
    });
    await adapter.dispose();
  });
});
