import { describe, expect, it } from 'vitest';

import {
  TRACK_IDS,
  isTaskScope,
  isTick,
  isTickRange,
  isTrackId,
} from './domain.js';

describe('fixed track registry', () => {
  it('preserves the six fixed P0 track IDs in order', () => {
    expect(TRACK_IDS).toEqual([
      'track.drums',
      'track.bass',
      'track.guitar',
      'track.keys',
      'track.strings',
      'track.winds',
    ]);
  });

  it('recognizes only fixed track IDs', () => {
    expect(isTrackId('track.keys')).toBe(true);
    expect(isTrackId('track.vocals')).toBe(false);
  });
});

describe('tick invariants', () => {
  it('accepts only finite non-negative integers', () => {
    expect(isTick(0)).toBe(true);
    expect(isTick(-1)).toBe(false);
    expect(isTick(1.5)).toBe(false);
    expect(isTick(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('requires a non-empty half-open range', () => {
    expect(isTickRange({ startTick: 0, endTick: 960 })).toBe(true);
    expect(isTickRange({ startTick: 960, endTick: 960 })).toBe(false);
  });
});

describe('task scope invariants', () => {
  it('accepts a whole-project scope with valid tracks', () => {
    expect(
      isTaskScope({ type: 'wholeProject', trackIds: ['track.drums'] }),
    ).toBe(true);
  });

  it('accepts a continuous time range with valid tracks', () => {
    expect(
      isTaskScope({
        type: 'timeRange',
        trackIds: ['track.guitar', 'track.keys'],
        startTick: 0,
        endTick: 3840,
      }),
    ).toBe(true);
  });

  it('rejects unknown tracks, duplicate tracks, and empty track sets', () => {
    expect(
      isTaskScope({
        type: 'timeRange',
        trackIds: ['track.guitar', 'track.vocals'],
        startTick: 0,
        endTick: 3840,
      }),
    ).toBe(false);
    expect(
      isTaskScope({
        type: 'wholeProject',
        trackIds: ['track.drums', 'track.drums'],
      }),
    ).toBe(false);
    expect(isTaskScope({ type: 'wholeProject', trackIds: [] })).toBe(false);
  });
});
