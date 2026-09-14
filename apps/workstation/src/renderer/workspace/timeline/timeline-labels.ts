import type {
  RendererTimelineViewModel as TimelineViewModel,
  Tick,
  TickRange,
} from '../../b-contracts/index.js';

export interface BarBoundaryLabel {
  readonly bar: number;
  readonly tick: Tick;
}

/** Returns the duration of one bar for the P0 global meter. */
export const ticksPerBar = (timeline: TimelineViewModel): number => {
  const meter = timeline.meterMap[0];
  if (meter === undefined) return timeline.ticksPerQuarter * 4;
  return timeline.ticksPerQuarter * meter.numerator * (4 / meter.denominator);
};

export const timelineBarCount = (timeline: TimelineViewModel): number =>
  Math.max(1, Math.ceil(timeline.totalTicks / ticksPerBar(timeline)));

/** A whole-number navigation distance measured in musical bars. */
export const ticksForBars = (timeline: TimelineViewModel, bars: number): Tick =>
  Math.max(1, Math.round(ticksPerBar(timeline) * Math.max(1, bars))) as Tick;

/**
 * Produces evenly spaced musical bar boundaries for a visible tick window.
 * The label count is capped so arbitrary project lengths do not flood the DOM.
 */
export const createBarBoundaryLabels = (
  timeline: TimelineViewModel,
  viewport: TickRange = {
    startTick: 0 as Tick,
    endTick: timeline.totalTicks,
  },
  maximumLabels = 9,
): readonly BarBoundaryLabel[] => {
  const perBar = ticksPerBar(timeline);
  const barCount = timelineBarCount(timeline);
  const firstBoundary = Math.max(0, Math.floor(viewport.startTick / perBar));
  const lastBoundary = Math.min(barCount, Math.ceil(viewport.endTick / perBar));
  const visibleBars = Math.max(1, lastBoundary - firstBoundary);
  const step = Math.max(
    1,
    Math.ceil(visibleBars / Math.max(1, maximumLabels - 1)),
  );
  const firstAlignedBoundary = Math.ceil(firstBoundary / step) * step;
  const labels: BarBoundaryLabel[] = [];

  for (
    let boundary = firstAlignedBoundary;
    boundary <= lastBoundary;
    boundary += step
  ) {
    labels.push({
      bar: boundary + 1,
      tick: Math.min(
        timeline.totalTicks,
        Math.round(boundary * perBar),
      ) as Tick,
    });
  }

  if (labels.length === 0) {
    labels.push({
      bar: firstBoundary + 1,
      tick: Math.min(
        timeline.totalTicks,
        Math.round(firstBoundary * perBar),
      ) as Tick,
    });
  }

  return labels;
};

/** Formats a half-open tick range as musical bar-boundary labels. */
export const formatBarRange = (
  range: TickRange,
  timeline: TimelineViewModel,
): string => {
  const perBar = ticksPerBar(timeline);
  const barCount = timelineBarCount(timeline);
  const startBar = Math.min(barCount, Math.floor(range.startTick / perBar) + 1);
  const endBoundary = Math.min(
    barCount + 1,
    Math.ceil(range.endTick / perBar) + 1,
  );
  return `Bars ${String(startBar)}–${String(Math.max(startBar + 1, endBoundary))}`;
};
