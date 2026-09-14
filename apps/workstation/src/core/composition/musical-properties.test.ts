import { parseMidi } from 'midi-file';
import { describe, expect, it } from 'vitest';

import { TRACK_IDS, type TaskScope, type Tick } from '@agent-music/contracts';

import {
  CompositionValidationError,
  canonicalizeExternalAbc,
  compileComposition,
  updateMusicalProperties,
} from './index.js';

const tick = (value: number): Tick => value as Tick;

const composition = (): string => `X:1
T:Meter fixture
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map((trackId) => `[V:${trackId}] [I:MIDI vol 72]C D E F |`).join(
  '\n',
)}
`;

const wholeProject: TaskScope = {
  type: 'wholeProject',
  trackIds: TRACK_IDS,
};

describe('musical properties update', () => {
  it('updates the only M header and regenerates every derived Meter output', () => {
    const before = compileComposition(canonicalizeExternalAbc(composition()));

    const result = updateMusicalProperties(before, wholeProject, {
      meter: { numerator: 3, denominator: 4 },
    });

    expect(result.compilation.canonicalAbc).toContain('\nM:3/4\n');
    expect(result.compilation.meterMap).toEqual([
      { tick: 0, numerator: 3, denominator: 4 },
    ]);
    expect(result.compilation.playback.meterMap).toEqual(
      result.compilation.meterMap,
    );
    expect(result.compilation.timelineViewModel.meterMap).toEqual(
      result.compilation.meterMap,
    );

    const midi = parseMidi(result.compilation.playback.midiDocument.fileBytes);
    expect(
      midi.tracks[0]?.find((event) => event.type === 'timeSignature'),
    ).toMatchObject({
      type: 'timeSignature',
      numerator: 3,
      denominator: 4,
    });
  });

  it('preserves project length, notes, velocity, Tempo, and Key', () => {
    const before = compileComposition(canonicalizeExternalAbc(composition()));

    const result = updateMusicalProperties(before, wholeProject, {
      meter: { numerator: 6, denominator: 8 },
    }).compilation;

    expect(result.totalTicks).toBe(before.totalTicks);
    expect(result.tempoMap).toEqual(before.tempoMap);
    expect(result.keyMap).toEqual(before.keyMap);
    expect(
      result.tracks.flatMap((track) =>
        track.events.map((event) =>
          event.type === 'note'
            ? {
                trackId: event.trackId,
                startTick: event.startTick,
                durationTick: event.durationTick,
                pitches: event.pitches,
                velocity: event.velocity,
              }
            : event,
        ),
      ),
    ).toEqual(
      before.tracks.flatMap((track) =>
        track.events.map((event) =>
          event.type === 'note'
            ? {
                trackId: event.trackId,
                startTick: event.startTick,
                durationTick: event.durationTick,
                pitches: event.pitches,
                velocity: event.velocity,
              }
            : event,
        ),
      ),
    );
  });

  it('updates initial Tempo while preserving local Tempo events and music', () => {
    const source = canonicalizeExternalAbc(
      composition()
        .replace(
          '[V:track.drums] [I:MIDI vol 72]C D E F |',
          '[V:track.drums] [I:MIDI vol 72]C [Q:1/4=90] D E F |',
        )
        .replace(
          '[V:track.bass] [I:MIDI vol 72]C D E F |',
          '[V:track.bass] [I:MIDI vol 72]C [Q:1/4=90] D E F |',
        )
        .replace(
          '[V:track.guitar] [I:MIDI vol 72]C D E F |',
          '[V:track.guitar] [I:MIDI vol 72]C [Q:1/4=90] D E F |',
        )
        .replace(
          '[V:track.keys] [I:MIDI vol 72]C D E F |',
          '[V:track.keys] [I:MIDI vol 72]C [Q:1/4=90] D E F |',
        )
        .replace(
          '[V:track.strings] [I:MIDI vol 72]C D E F |',
          '[V:track.strings] [I:MIDI vol 72]C [Q:1/4=90] D E F |',
        )
        .replace(
          '[V:track.winds] [I:MIDI vol 72]C D E F |',
          '[V:track.winds] [I:MIDI vol 72]C [Q:1/4=90] D E F |',
        ),
    );
    const before = compileComposition(source);

    const result = updateMusicalProperties(before, wholeProject, {
      tempo: { bpm: 100 },
    }).compilation;

    expect(result.canonicalAbc).toContain('\nQ:1/4=100\n');
    expect(result.tempoMap).toEqual([
      { tick: 0, bpm: 100 },
      { tick: 960, bpm: 90 },
    ]);
    expect(result.totalTicks).toBe(before.totalTicks);
    expect(result.keyMap).toEqual(before.keyMap);
  });

  it('updates Meter and initial Tempo together', () => {
    const before = compileComposition(canonicalizeExternalAbc(composition()));

    const result = updateMusicalProperties(before, wholeProject, {
      meter: { numerator: 3, denominator: 4 },
      tempo: { bpm: 100 },
    }).compilation;

    expect(result.meterMap).toEqual([
      { tick: 0, numerator: 3, denominator: 4 },
    ]);
    expect(result.tempoMap).toEqual([{ tick: 0, bpm: 100 }]);
  });

  it.each([0, -1, 3.5])('rejects invalid global Tempo %s BPM', (bpm) => {
    const before = compileComposition(canonicalizeExternalAbc(composition()));
    expect(() =>
      updateMusicalProperties(before, wholeProject, { tempo: { bpm } }),
    ).toThrow(CompositionValidationError);
  });

  it.each([
    [
      'a time range',
      {
        type: 'timeRange',
        trackIds: TRACK_IDS,
        startTick: tick(0),
        endTick: tick(3840),
      } satisfies TaskScope,
    ],
    [
      'a subset of tracks',
      {
        type: 'wholeProject',
        trackIds: ['track.drums'],
      } satisfies TaskScope,
    ],
  ])('rejects %s even when the replacement value is valid', (_name, scope) => {
    const before = compileComposition(canonicalizeExternalAbc(composition()));

    expect(() =>
      updateMusicalProperties(before, scope, {
        meter: { numerator: 3, denominator: 4 },
      }),
    ).toThrow(CompositionValidationError);
  });

  it.each([
    [{ numerator: 0, denominator: 4 }],
    [{ numerator: 3.5, denominator: 4 }],
    [{ numerator: 256, denominator: 4 }],
    [{ numerator: 3, denominator: 0 }],
    [{ numerator: 3, denominator: 3 }],
    [{ numerator: 3, denominator: 256 }],
  ])('rejects a Meter outside the stable ABC-to-MIDI boundary', (meter) => {
    const before = compileComposition(canonicalizeExternalAbc(composition()));

    expect(() =>
      updateMusicalProperties(before, wholeProject, { meter }),
    ).toThrow(CompositionValidationError);
  });
});

describe('composition resize', () => {
  it('grows a one-measure composition to 64 empty measures and is idempotent', async () => {
    const { resizeComposition } = await import('./composition-resize.js');
    const before = compileComposition(
      canonicalizeExternalAbc(
        composition().replaceAll('[I:MIDI vol 72]C D E F |', 'z4 |'),
      ),
    );
    const grown = resizeComposition(before, wholeProject, 64).compilation;
    expect(grown.totalTicks).toBe(245_760);
    expect(grown.tracks).toHaveLength(6);
    expect(
      grown.tracks.every((track) =>
        track.events.every((event) => event.type === 'rest'),
      ),
    ).toBe(true);
    expect(
      resizeComposition(grown, wholeProject, 64).compilation.canonicalAbc,
    ).toBe(grown.canonicalAbc);
  });

  it('truncates an empty tail but refuses to delete musical content', async () => {
    const { resizeComposition } = await import('./composition-resize.js');
    const emptyOne = compileComposition(
      canonicalizeExternalAbc(
        composition().replaceAll('[I:MIDI vol 72]C D E F |', 'z4 |'),
      ),
    );
    const four = resizeComposition(emptyOne, wholeProject, 4).compilation;
    const three = resizeComposition(four, wholeProject, 3).compilation;
    expect(three.totalTicks).toBe(11_520);

    const withTailMusic = compileComposition(
      canonicalizeExternalAbc(
        four.canonicalAbc.replace(
          '[V:track.drums] z4 | z4 | z4 | z4 |',
          '[V:track.drums] z4 | z4 | z4 | C D E F |',
        ),
      ),
    );
    try {
      resizeComposition(withTailMusic, wholeProject, 3);
      throw new Error('expected truncate rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionValidationError);
      expect(
        (error as CompositionValidationError).report.issues[0],
      ).toMatchObject({
        code: 'COMPOSITION_TRUNCATE_WOULD_DELETE_CONTENT',
        details: { affectedTracks: ['track.drums'] },
      });
    }
  });
});
