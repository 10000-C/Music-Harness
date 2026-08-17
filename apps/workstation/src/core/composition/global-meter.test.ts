import { parseMidi } from 'midi-file';
import { describe, expect, it } from 'vitest';

import { TRACK_IDS, type TaskScope, type Tick } from '@agent-music/contracts';

import {
  CompositionValidationError,
  canonicalizeExternalAbc,
  compileComposition,
  updateGlobalMeter,
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

describe('global Meter update', () => {
  it('updates the only M header and regenerates every derived Meter output', () => {
    const before = compileComposition(canonicalizeExternalAbc(composition()));

    const result = updateGlobalMeter(before, wholeProject, {
      numerator: 3,
      denominator: 4,
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

    const result = updateGlobalMeter(before, wholeProject, {
      numerator: 6,
      denominator: 8,
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
      updateGlobalMeter(before, scope, { numerator: 3, denominator: 4 }),
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

    expect(() => updateGlobalMeter(before, wholeProject, meter)).toThrow(
      CompositionValidationError,
    );
  });
});
