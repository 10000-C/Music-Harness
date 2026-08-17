import { describe, expect, it } from 'vitest';

import { TRACK_IDS, type TrackId } from '@agent-music/contracts';

import { CompositionPipeline } from './index.js';

const canonicalComposition = (
  meter: string,
  defaultBody: string,
  overrides: Partial<Record<TrackId, string>> = {},
): string => {
  const pipeline = new CompositionPipeline();
  const source = `X:1
T:Meter consistency
M:${meter}
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map(
  (trackId) => `[V:${trackId}] ${overrides[trackId] ?? defaultBody}`,
).join('\n')}
`;
  return pipeline.canonicalizeExternalInput(source).canonicalAbc;
};

describe('final Meter consistency', () => {
  it('accepts complete 3/4 measures with a shorter final measure', () => {
    const pipeline = new CompositionPipeline();
    const source = canonicalComposition('3/4', 'C D E | F G A | B c |');

    expect(pipeline.validateFinalMeterConsistency(source)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('rejects stale 4/4 barlines after the Global Meter becomes 3/4', () => {
    const pipeline = new CompositionPipeline();
    const source = canonicalComposition('3/4', 'C D E F | G A B c |');

    expect(pipeline.validateFinalMeterConsistency(source)).toMatchObject({
      valid: false,
      issues: [{ code: 'METER_BARLINE_MISMATCH' }],
    });
  });

  it('rejects one track whose barlines disagree with the shared Meter grid', () => {
    const pipeline = new CompositionPipeline();
    const source = canonicalComposition('3/4', 'C D E | F G A |', {
      'track.drums': 'C D E F | G A |',
    });

    expect(pipeline.validateFinalMeterConsistency(source)).toMatchObject({
      valid: false,
      issues: [{ code: 'METER_BARLINE_MISMATCH' }],
    });
  });

  it('rejects a pickup-style offset because P0 has no shifted measure grid', () => {
    const pipeline = new CompositionPipeline();
    const source = canonicalComposition('4/4', 'C | D E F |');

    expect(pipeline.validateFinalMeterConsistency(source)).toMatchObject({
      valid: false,
      issues: [{ code: 'METER_BARLINE_MISMATCH' }],
    });
  });
});
