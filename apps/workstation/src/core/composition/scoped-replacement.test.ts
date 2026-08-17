import { describe, expect, it } from 'vitest';

import { TRACK_IDS, type TaskScope, type Tick } from '@agent-music/contracts';

import {
  CompositionValidationError,
  canonicalizeExternalAbc,
  compileComposition,
  replaceScopedMusic,
} from './index.js';

const tick = (value: number): Tick => value as Tick;

const composition = (drumBody: string, otherBody = drumBody): string => `X:1
T:Replacement fixture
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map(
  (trackId) =>
    `[V:${trackId}] ${trackId === 'track.drums' ? drumBody : otherBody}`,
).join('\n')}
`;

const scope = (
  trackIds: TaskScope['trackIds'],
  startTick = 0,
  endTick = 3840,
): TaskScope => ({
  type: 'timeRange',
  trackIds,
  startTick: tick(startTick),
  endTick: tick(endTick),
});

describe('scoped music replacement', () => {
  it('replaces only mapped events and recompiles every derived output', () => {
    const source = canonicalizeExternalAbc(composition('C D E F | G A B c |'));
    const before = compileComposition(source);

    const result = replaceScopedMusic(before, scope(['track.drums']), [
      { trackId: 'track.drums', abc: 'z4' },
    ]);

    expect(before.canonicalAbc).toBe(source);
    expect(result.changedTrackIds).toEqual(['track.drums']);
    expect(result.compilation.canonicalAbc).toContain(
      '[V:track.drums] z4 | G A B c |',
    );
    expect(result.compilation.tracks[0]?.events[0]).toMatchObject({
      type: 'rest',
      startTick: 0,
      durationTick: 3840,
    });
    expect(result.compilation.playback.midiDocument.tracks[0]?.notes).toEqual([
      { startTick: 3840, durationTick: 960, pitch: 67, velocity: 100 },
      { startTick: 4800, durationTick: 960, pitch: 69, velocity: 100 },
      { startTick: 5760, durationTick: 960, pitch: 71, velocity: 100 },
      { startTick: 6720, durationTick: 960, pitch: 72, velocity: 100 },
    ]);
    expect(result.compilation.scopeMapping.sourceHash).not.toBe(
      before.scopeMapping.sourceHash,
    );
  });

  it('expands a repeat submitted inside an exact-duration fragment', () => {
    const source = canonicalizeExternalAbc(composition('z4 | z4 |'));
    const before = compileComposition(source);

    const result = replaceScopedMusic(before, scope(['track.drums']), [
      { trackId: 'track.drums', abc: '|: C D :|' },
    ]);

    expect(result.compilation.canonicalAbc).not.toMatch(/\|:|:\|/);
    expect(result.compilation.canonicalAbc).toContain(
      '[V:track.drums] C D | C D | z4 |',
    );
  });

  it('updates velocity inside Scope and regenerates MIDI without touching later events', () => {
    const source = canonicalizeExternalAbc(composition('C D E F |'));
    const before = compileComposition(source);

    const result = replaceScopedMusic(before, scope(['track.drums'], 0, 960), [
      { trackId: 'track.drums', abc: '[I:MIDI vol 73]C' },
    ]);

    expect(result.compilation.canonicalAbc).toContain(
      '[V:track.drums] [I:MIDI vol 73] C D E F |',
    );
    expect(
      result.compilation.playback.midiDocument.tracks[0]?.notes.map(
        (note) => note.velocity,
      ),
    ).toEqual([73, 100, 100, 100]);
  });

  it('rejects crossing events, duration changes, and unauthorized tracks', () => {
    const tied = compileComposition(
      canonicalizeExternalAbc(composition('C2-C2 | D2 z2 |', 'z4 | z4 |')),
    );

    expect(() =>
      replaceScopedMusic(tied, scope(['track.drums'], 1920, 5760), [
        { trackId: 'track.drums', abc: 'z4' },
      ]),
    ).toThrow(CompositionValidationError);

    const regular = compileComposition(
      canonicalizeExternalAbc(composition('C D E F | G A B c |')),
    );
    expect(() =>
      replaceScopedMusic(regular, scope(['track.drums']), [
        { trackId: 'track.drums', abc: 'z2' },
      ]),
    ).toThrow(CompositionValidationError);
    expect(() =>
      replaceScopedMusic(regular, scope(['track.drums']), [
        { trackId: 'track.bass', abc: 'z4' },
      ]),
    ).toThrow(CompositionValidationError);
  });

  it('allows global Tempo and Key changes only for an all-track scope', () => {
    const before = compileComposition(
      canonicalizeExternalAbc(composition('C D E F |')),
    );
    const fragment = 'C [Q:1/4=90] [K:G] D E F';

    const result = replaceScopedMusic(
      before,
      scope(TRACK_IDS),
      TRACK_IDS.map((trackId) => ({ trackId, abc: fragment })),
    );
    expect(result.compilation.tempoMap.at(-1)).toEqual({
      tick: 960,
      bpm: 90,
    });
    expect(result.compilation.keyMap.at(-1)).toEqual({
      tick: 960,
      tonic: 'G',
      accidental: '',
      mode: '',
    });

    expect(() =>
      replaceScopedMusic(before, scope(['track.drums']), [
        { trackId: 'track.drums', abc: fragment },
      ]),
    ).toThrow(CompositionValidationError);
  });
});
