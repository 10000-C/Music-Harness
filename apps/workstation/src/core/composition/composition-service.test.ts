import { describe, expect, it } from 'vitest';

import { TRACK_IDS, type Tick } from '@agent-music/contracts';

import { createInitialComposition } from '../project/initial-composition.js';
import { CompositionPipeline, CompositionValidationError } from './index.js';

const tick = (value: number): Tick => value as Tick;

describe('CompositionPipeline facade', () => {
  it('exposes the bounded A2 operations without RuntimeSnapshot state', () => {
    const pipeline = new CompositionPipeline();
    const source = pipeline.createInitialComposition();
    const canonicalized = pipeline.canonicalizeExternalInput(
      source.replaceAll('\n', '\r\n'),
    );
    const compilation = pipeline.compileCanonical(canonicalized.canonicalAbc);

    expect(canonicalized.changed).toBe(true);
    expect(compilation.totalTicks).toBe(3840);
    expect(compilation).not.toHaveProperty('runtimeSnapshot');
    expect(compilation.playback).not.toHaveProperty('scopeMapping');
    expect(
      pipeline.getScopedComposition(compilation, {
        type: 'timeRange',
        trackIds: ['track.drums'],
        startTick: tick(0),
        endTick: tick(3840),
      }).tracks[0]?.abc,
    ).toBe('z4');
  });

  it('returns validation reports and supplies A1 initial project content', () => {
    const pipeline = new CompositionPipeline();

    expect(
      pipeline.validateCanonical(pipeline.createInitialComposition()),
    ).toEqual({ valid: true, issues: [] });
    expect(pipeline.validateCanonical('not ABC')).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: 'ABC_STRUCTURE_INVALID' })],
    });
    expect(createInitialComposition()).toBe(
      pipeline.createInitialComposition(),
    );
    expect(
      TRACK_IDS.every((trackId) =>
        createInitialComposition().includes(`V:${trackId}`),
      ),
    ).toBe(true);
  });

  it('exposes global Meter changes through the A2 facade', () => {
    const pipeline = new CompositionPipeline();
    const compilation = pipeline.compileCanonical(
      pipeline.createInitialComposition(),
    );

    const result = pipeline.updateMusicalProperties(
      compilation,
      { type: 'wholeProject', trackIds: TRACK_IDS },
      { meter: { numerator: 7, denominator: 8 } },
    );

    expect(result.compilation.meterMap).toEqual([
      { tick: 0, numerator: 7, denominator: 8 },
    ]);
  });
  it('enforces final Meter/barline consistency only at the final compile seam', () => {
    const pipeline = new CompositionPipeline();
    const staleBarlines = pipeline.canonicalizeExternalInput(`X:1
T:Final validation
M:3/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map((trackId) => `[V:${trackId}] C D E F | G A B c |`).join('\n')}
`).canonicalAbc;

    expect(() => pipeline.compileCanonical(staleBarlines)).not.toThrow();
    expect(() => pipeline.compileFinalCanonical(staleBarlines)).toThrow(
      CompositionValidationError,
    );
    try {
      pipeline.compileFinalCanonical(staleBarlines);
    } catch (error) {
      if (!(error instanceof CompositionValidationError)) {
        throw error;
      }
      expect(error.report).toMatchObject({
        valid: false,
        issues: [{ code: 'METER_BARLINE_MISMATCH' }],
      });
    }

    expect(
      pipeline.compileFinalCanonical(pipeline.createInitialComposition())
        .totalTicks,
    ).toBe(3840);
  });
});
