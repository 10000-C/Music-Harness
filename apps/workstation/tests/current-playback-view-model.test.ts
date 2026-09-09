import { describe, expect, it } from 'vitest';
import {
  canonicalizeExternalAbc,
  compileComposition,
} from '../src/core/composition/index.js';
import { createCurrentPlaybackViewModel } from '../src/renderer/core-client/current-playback-view-model.js';

const source = `X:1
T:Projection
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
[V:track.guitar] E2 G2 |
[V:track.keys] C E G c |
[V:track.strings] C4 |
[V:track.winds] G4 |`;

describe('Current playback Timeline projection', () => {
  it('preserves the compilation note values and six-track order', () => {
    const compiled = compileComposition(canonicalizeExternalAbc(source));
    const timeline = createCurrentPlaybackViewModel(
      'revision-1',
      compiled.timelineViewModel,
      compiled.playback,
    );

    expect(timeline?.tracks.map((track) => track.trackId)).toEqual(
      compiled.playback.trackIds,
    );
    const marker = timeline?.tracks[3]?.clips[0]?.noteMarkers[0];
    const note = compiled.playback.midiDocument.tracks[3]?.notes[0];
    expect(marker).toEqual({
      startTick: note?.startTick,
      endTick: (note?.startTick ?? 0) + (note?.durationTick ?? 0),
      pitch: note?.pitch,
      velocity: note?.velocity,
    });
  });

  it('fails closed when the Core timeline no longer describes the compilation', () => {
    const compiled = compileComposition(canonicalizeExternalAbc(source));
    expect(
      createCurrentPlaybackViewModel(
        'revision-1',
        { ...compiled.timelineViewModel, totalTicks: 1 as never },
        compiled.playback,
      ),
    ).toBeNull();
  });
});
