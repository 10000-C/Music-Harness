import { describe, expect, it } from 'vitest';

import { TRACK_IDS } from '@agent-music/contracts';

import {
  CompositionValidationError,
  canonicalizeExternalAbc,
  compileCanonicalAbc,
  createInitialCanonicalAbc,
} from './index.js';

const sourceWithBodies = (
  bodies: Partial<Record<(typeof TRACK_IDS)[number], string>>,
): string => `X:1
T:Test composition
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map(
  (trackId) => `[V:${trackId}] ${bodies[trackId] ?? 'z4 |'}`,
).join('\n')}
`;

describe('Canonical ABC', () => {
  it('creates and compiles an equal-length blank six-track composition', () => {
    const source = createInitialCanonicalAbc();
    const compilation = compileCanonicalAbc(source);

    expect(compilation.canonicalAbc).toBe(source);
    expect(compilation.totalTicks).toBe(3840);
    expect(compilation.tracks.map((track) => track.trackId)).toEqual(TRACK_IDS);
    expect(
      compilation.tracks.every(
        (track) =>
          track.totalTicks === 3840 &&
          track.events.length === 1 &&
          track.events[0]?.type === 'rest',
      ),
    ).toBe(true);
  });

  it('expands repeats and endings into stable played-order source', () => {
    const repeated = sourceWithBodies(
      Object.fromEntries(
        TRACK_IDS.map((trackId) => [
          trackId,
          '|: C D E F |1 G A B c :|2 c B A G |',
        ]),
      ),
    );

    const canonical = canonicalizeExternalAbc(repeated);

    expect(canonical).not.toMatch(/\|:|:\||\|1|\|2/);
    expect(canonical).toContain(
      '[V:track.drums] C D E F | G A B c | C D E F | c B A G |',
    );
    expect(canonicalizeExternalAbc(canonical)).toBe(canonical);
    expect(compileCanonicalAbc(canonical).totalTicks).toBe(15_360);
  });

  it('compiles rests, chords, ties, accidentals, and octave marks', () => {
    const source = canonicalizeExternalAbc(
      sourceWithBodies({
        'track.drums': "C z [CEG] ^F | F, C c c' |",
        'track.bass': 'C2-C2 | C2-C2 |',
        'track.guitar': '[CEG]2-[CEG]2 | z4 |',
        'track.keys': 'C z [CEG] ^F | F F F2 |',
        'track.strings': 'z4 | z4 |',
        'track.winds': "C, C c c' | z4 |",
      }),
    );

    const compilation = compileCanonicalAbc(source);
    const drums = compilation.tracks[0];
    const bass = compilation.tracks[1];
    const guitar = compilation.tracks[2];
    const winds = compilation.tracks[5];

    expect(drums?.events[1]?.type).toBe('rest');
    expect(
      drums?.events.find(
        (event) => event.type === 'note' && event.pitches.length === 3,
      ),
    ).toMatchObject({ pitches: [60, 64, 67] });
    expect(bass?.events).toHaveLength(2);
    expect(bass?.events[0]).toMatchObject({
      type: 'note',
      startTick: 0,
      durationTick: 3840,
    });
    expect(bass?.events[0]?.abcSpans).toHaveLength(2);
    expect(guitar?.events[0]).toMatchObject({
      type: 'note',
      pitches: [60, 64, 67],
      durationTick: 3840,
    });
    expect(
      winds?.events
        .filter((event) => event.type === 'note')
        .map((event) => event.pitches[0]),
    ).toEqual([48, 60, 72, 84]);
  });

  it('preserves event velocity from 1 through 127 for notes and chords', () => {
    const body = '[I:MIDI vol 1]C [I:MIDI vol 64]D [I:MIDI vol 127][CEG] z |';
    const source = canonicalizeExternalAbc(
      sourceWithBodies(
        Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, body])),
      ),
    );

    expect(source).toContain(
      '[V:track.drums] [I:MIDI vol 1] C [I:MIDI vol 64] D [I:MIDI vol 127] [CEG] z |',
    );
    expect(
      compileCanonicalAbc(source).tracks[0]?.events.map((event) =>
        event.type === 'note' ? event.velocity : null,
      ),
    ).toEqual([1, 64, 127, null]);
  });

  it('expands repeats without losing event velocity', () => {
    const repeated = sourceWithBodies(
      Object.fromEntries(
        TRACK_IDS.map((trackId) => [trackId, '|: [I:MIDI vol 37]C D :|']),
      ),
    );

    const canonical = canonicalizeExternalAbc(repeated);

    expect(canonical).toContain(
      '[V:track.drums] [I:MIDI vol 37] C D | [I:MIDI vol 37] C D |',
    );
    expect(
      compileCanonicalAbc(canonical).tracks[0]?.events.map((event) =>
        event.type === 'note' ? event.velocity : null,
      ),
    ).toEqual([37, 100, 37, 100]);
  });

  it('keeps onset velocity across a tied event', () => {
    const source = canonicalizeExternalAbc(
      sourceWithBodies(
        Object.fromEntries(
          TRACK_IDS.map((trackId) => [trackId, '[I:MIDI vol 42]C2-C2 |']),
        ),
      ),
    );
    const event = compileCanonicalAbc(source).tracks[0]?.events[0];

    expect(event).toMatchObject({
      type: 'note',
      durationTick: 3840,
      velocity: 42,
    });
    expect(event?.abcSpans).toHaveLength(3);
  });

  it.each([
    ['a different note pitch', 'C2-D2 |'],
    ['a different chord pitch set', '[CE]2-[CF]2 |'],
    ['an enharmonic respelling', '^C2-_D2 |'],
    ['an explicit accidental change', '^C2-=C2 |'],
  ])('rejects a tie continuation with %s', (_name, body) => {
    const source = canonicalizeExternalAbc(
      sourceWithBodies(
        Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, body])),
      ),
    );

    expect(() => compileCanonicalAbc(source)).toThrow(
      CompositionValidationError,
    );
  });

  it.each([
    ['inherits the accidental', '^C2-C2 |'],
    ['repeats the same accidental', '^C2-^C2 |'],
  ])('accepts a tie that %s', (_name, body) => {
    const source = canonicalizeExternalAbc(
      sourceWithBodies(
        Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, body])),
      ),
    );

    expect(compileCanonicalAbc(source).tracks[0]?.events[0]).toMatchObject({
      type: 'note',
      durationTick: 3840,
      pitches: [61],
    });
  });

  it('accepts MIDI note zero and rejects pitches outside 0 through 127', () => {
    const lowest = canonicalizeExternalAbc(
      sourceWithBodies(
        Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, 'C,,,,,4 |'])),
      ),
    );

    expect(compileCanonicalAbc(lowest).tracks[0]?.events[0]).toMatchObject({
      type: 'note',
      pitches: [0],
    });

    for (const body of ['C,,,,,,4 |', "c''''''4 |"]) {
      const source = canonicalizeExternalAbc(
        sourceWithBodies(
          Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, body])),
        ),
      );
      expect(() => compileCanonicalAbc(source)).toThrow(
        CompositionValidationError,
      );
    }
  });

  it('retains identical global tempo and key maps across all voices', () => {
    const body = 'C2 [Q:1/4=90] [K:G] D2 |';
    const source = canonicalizeExternalAbc(
      sourceWithBodies(
        Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, body])),
      ),
    );

    const compilation = compileCanonicalAbc(source);

    expect(compilation.tempoMap).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 1920, bpm: 90 },
    ]);
    expect(compilation.keyMap).toEqual([
      { tick: 0, tonic: 'C', accidental: '', mode: '' },
      { tick: 1920, tonic: 'G', accidental: '', mode: '' },
    ]);
  });

  it.each([
    ['tuplets', '(3CDE z |'],
    ['broken rhythm', 'C>D E2 |'],
    ['grace notes', '{C}D3 |'],
    ['decorations', '!trill!C4 |'],
  ])('fails closed for unsupported %s', (_name, body) => {
    expect(() =>
      canonicalizeExternalAbc(
        sourceWithBodies(
          Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, body])),
        ),
      ),
    ).toThrow(CompositionValidationError);
  });

  it.each([
    ['zero', '[I:MIDI vol 0]C4 |'],
    ['negative', '[I:MIDI vol -1]C4 |'],
    ['above 127', '[I:MIDI vol 128]C4 |'],
    ['fractional', '[I:MIDI vol 63.5]C4 |'],
    ['crosses a rest', '[I:MIDI vol 64]z C3 |'],
    ['is overwritten', '[I:MIDI vol 64][I:MIDI vol 32]C4 |'],
    ['is dangling', 'C4 [I:MIDI vol 64]|'],
    ['targets a tie continuation', 'C2-[I:MIDI vol 64]C2 |'],
    ['uses a non-canonical directive', '%%MIDI vol 64\nC4 |'],
  ])('rejects velocity that %s', (_name, body) => {
    expect(() =>
      canonicalizeExternalAbc(
        sourceWithBodies(
          Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, body])),
        ),
      ),
    ).toThrow(CompositionValidationError);
  });

  it('rejects inexact PPQ durations, unequal tracks, and non-canonical input', () => {
    expect(() =>
      canonicalizeExternalAbc(
        sourceWithBodies(
          Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, 'C/7 |'])),
        ),
      ),
    ).toThrow(CompositionValidationError);

    const unequal = canonicalizeExternalAbc(
      sourceWithBodies({ 'track.drums': 'z8 |' }),
    );
    try {
      compileCanonicalAbc(unequal);
      throw new Error('expected unequal-track validation');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionValidationError);
      expect(
        (error as CompositionValidationError).report.issues[0],
      ).toMatchObject({
        code: 'TRACK_LENGTH_MISMATCH',
        details: {
          tracks: {
            'track.drums': 7680,
            'track.bass': 3840,
          },
        },
      });
    }

    const valid = createInitialCanonicalAbc();
    expect(() => compileCanonicalAbc(valid.replaceAll('\n', '\r\n'))).toThrow(
      CompositionValidationError,
    );
  });
});

describe('agent-recoverable validation diagnostics', () => {
  it('rejects tick-zero inline tempo rather than creating duplicate tempo entries', () => {
    const source = createInitialCanonicalAbc().replaceAll(
      'z4 |',
      '[Q:1/4=72] z4 |',
    );
    expect(() => compileCanonicalAbc(canonicalizeExternalAbc(source))).toThrow(
      /Tick 0|initial Tempo/i,
    );
  });

  it('returns bounded parser diagnostics without HTML for postfix accidentals', () => {
    const source = createInitialCanonicalAbc().replace(
      '[V:track.drums] z4 |',
      '[V:track.drums] F#,, z3 |',
    );
    try {
      canonicalizeExternalAbc(source);
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionValidationError);
      const issue = (error as CompositionValidationError).report.issues[0];
      expect(issue?.message).not.toContain('<span');
      expect(issue?.message.length ?? 0).toBeLessThan(2000);
      expect(JSON.stringify(issue?.details ?? {})).toContain('^F');
    }
  });
});
