import type {
  RendererTimelineViewModel as TimelineViewModel,
  Tick,
} from '../src/renderer/b-contracts/index.js';
import { describe, expect, it } from 'vitest';
import { getFakeCoreFixture } from '../src/renderer/core-client/index.js';
import {
  createBarBoundaryLabels,
  formatBarRange,
  ticksForBars,
  ticksPerBar,
  timelineBarCount,
} from '../src/renderer/workspace/timeline/timeline-labels.js';

const tick = (value: number): Tick => value as Tick;
const totalTicks = tick(122_880);
const stableTimeline = (): TimelineViewModel => {
  const timeline = getFakeCoreFixture('stable').timeline;
  if (timeline === null) throw new Error('Stable fixture needs a timeline.');
  return timeline;
};

describe('timeline bar labels', () => {
  it('uses bar-boundary labels for the complete 32-bar timeline', () => {
    const timeline = stableTimeline();
    expect(
      formatBarRange({ startTick: tick(0), endTick: totalTicks }, timeline),
    ).toBe('Bars 1–33');
    expect(createBarBoundaryLabels(timeline).map(({ bar }) => bar)).toEqual([
      1, 5, 9, 13, 17, 21, 25, 29, 33,
    ]);
  });

  it('labels the second half as bars 17 through the final boundary', () => {
    expect(
      formatBarRange(
        { startTick: tick(61_440), endTick: totalTicks },
        stableTimeline(),
      ),
    ).toBe('Bars 17–33');
  });

  it('rounds a dragged end forward to the containing bar boundary', () => {
    expect(
      formatBarRange(
        { startTick: tick(61_440), endTick: tick(98_304) },
        stableTimeline(),
      ),
    ).toBe('Bars 17–27');
  });

  it('derives navigation and labels from a non-4/4 global meter', () => {
    const timeline: TimelineViewModel = {
      ...stableTimeline(),
      revision: 'timeline.3-4-seven-bars',
      totalTicks: tick(20_160),
      meterMap: [{ tick: tick(0), numerator: 3, denominator: 4 }],
    };

    expect(ticksPerBar(timeline)).toBe(2880);
    expect(timelineBarCount(timeline)).toBe(7);
    expect(ticksForBars(timeline, 4)).toBe(11_520);
    expect(
      formatBarRange(
        { startTick: tick(5760), endTick: tick(14_400) },
        timeline,
      ),
    ).toBe('Bars 3–6');
    expect(createBarBoundaryLabels(timeline).map(({ bar }) => bar)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
});
