import { isTickRange } from '../src/renderer/b-contracts/index.js';
import type { Tick, TickRange } from '../src/renderer/b-contracts/index.js';
import { describe, expect, it } from 'vitest';

import {
  applyScopeKeyboardCommand,
  clampTick,
  createVisibleTickRange,
  createTimelineViewport,
  maximumTimelineStartTick,
  normalizeDraggedTickRange,
  tickToViewportPercentage,
  tickToX,
  xToTick,
} from '../src/renderer/workspace/timeline/timeline-math.js';

const tick = (value: number): Tick => value as Tick;

describe('timeline viewport', () => {
  it('maps ticks to viewport x coordinates using scroll and zoom', () => {
    const viewport = createTimelineViewport({
      scrollX: 40,
      pixelsPerTick: 0.5,
      zoom: 2,
    });

    expect(tickToX(tick(80), viewport)).toBe(40);
    expect(xToTick(40, viewport)).toBe(80);
  });

  it('supports floor, round, and ceil when mapping x back to ticks', () => {
    const viewport = createTimelineViewport({
      scrollX: 0,
      pixelsPerTick: 10,
      zoom: 1,
    });

    expect(xToTick(14, viewport, 'floor')).toBe(1);
    expect(xToTick(16, viewport, 'round')).toBe(2);
    expect(xToTick(11, viewport, 'ceil')).toBe(2);
  });

  it('round-trips integer ticks across fractional scales and a scroll offset', () => {
    const viewport = createTimelineViewport({
      scrollX: 137.25,
      pixelsPerTick: 0.125,
      zoom: 1.75,
    });

    for (const value of [0, 1, 959, 960, 17_281]) {
      const original = tick(value);
      expect(xToTick(tickToX(original, viewport), viewport)).toBe(original);
    }
  });

  it('changes scale without changing the timeline origin', () => {
    const normal = createTimelineViewport({
      scrollX: 24,
      pixelsPerTick: 0.25,
      zoom: 1,
    });
    const zoomed = createTimelineViewport({
      scrollX: 24,
      pixelsPerTick: 0.25,
      zoom: 2,
    });

    expect(tickToX(tick(0), normal)).toBe(-24);
    expect(tickToX(tick(0), zoomed)).toBe(-24);
    expect(tickToX(tick(100), zoomed) + 24).toBe(
      2 * (tickToX(tick(100), normal) + 24),
    );
  });

  it('clamps x coordinates before the start of the timeline to tick zero', () => {
    const viewport = createTimelineViewport({
      scrollX: 80,
      pixelsPerTick: 2,
      zoom: 1,
    });

    expect(xToTick(-100, viewport, 'floor')).toBe(0);
  });

  it.each([
    [{ scrollX: -1, pixelsPerTick: 1, zoom: 1 }, 'scrollX'],
    [{ scrollX: Number.NaN, pixelsPerTick: 1, zoom: 1 }, 'scrollX'],
    [{ scrollX: 0, pixelsPerTick: 0, zoom: 1 }, 'pixelsPerTick'],
    [
      { scrollX: 0, pixelsPerTick: Number.POSITIVE_INFINITY, zoom: 1 },
      'pixelsPerTick',
    ],
    [{ scrollX: 0, pixelsPerTick: 1, zoom: 0 }, 'zoom'],
    [{ scrollX: 0, pixelsPerTick: 1, zoom: -0.5 }, 'zoom'],
  ])('rejects invalid viewport parameters: %o', (input, expectedParameter) => {
    expect(() => createTimelineViewport(input)).toThrow(expectedParameter);
  });

  it('rejects non-finite x coordinates', () => {
    const viewport = createTimelineViewport({
      scrollX: 0,
      pixelsPerTick: 1,
      zoom: 1,
    });

    expect(() => xToTick(Number.NaN, viewport)).toThrow('x');
  });

  it('derives a clamped visible tick range from zoom and scroll', () => {
    expect(maximumTimelineStartTick(tick(10_000), 2)).toBe(5000);
    expect(createVisibleTickRange(tick(10_000), 2, tick(3000))).toEqual({
      startTick: 3000,
      endTick: 8000,
    });
    expect(createVisibleTickRange(tick(10_000), 4, tick(9000))).toEqual({
      startTick: 7500,
      endTick: 10_000,
    });
  });

  it('maps ticks relative to the visible range', () => {
    const viewport: TickRange = {
      startTick: tick(2000),
      endTick: tick(6000),
    };

    expect(tickToViewportPercentage(tick(2000), viewport)).toBe(0);
    expect(tickToViewportPercentage(tick(4000), viewport)).toBe(50);
    expect(tickToViewportPercentage(tick(6000), viewport)).toBe(100);
  });

  it('moves and resizes a keyboard-created scope by musical steps', () => {
    const created = applyScopeKeyboardCommand(
      null,
      tick(4000),
      tick(20_000),
      tick(2000),
      'moveForward',
    );
    expect(created).toEqual({ startTick: 6000, endTick: 8000 });
    expect(
      applyScopeKeyboardCommand(
        created,
        tick(0),
        tick(20_000),
        tick(2000),
        'extendEnd',
      ),
    ).toEqual({ startTick: 6000, endTick: 10_000 });
    expect(
      applyScopeKeyboardCommand(
        created,
        tick(0),
        tick(20_000),
        tick(2000),
        'first',
      ),
    ).toEqual({ startTick: 0, endTick: 2000 });
    expect(
      applyScopeKeyboardCommand(
        created,
        tick(0),
        tick(20_000),
        tick(2000),
        'clear',
      ),
    ).toBeNull();
  });
});

describe('tick range math', () => {
  it('clamps ticks to inclusive bounds', () => {
    expect(clampTick(-10, tick(20), tick(80))).toBe(20);
    expect(clampTick(50, tick(20), tick(80))).toBe(50);
    expect(clampTick(120, tick(20), tick(80))).toBe(80);
  });

  it('rejects invalid clamp bounds and non-integer ticks', () => {
    expect(() => clampTick(20, tick(80), tick(20))).toThrow('minimumTick');
    expect(() => clampTick(20.5, tick(0), tick(40))).toThrow('value');
  });

  it('normalizes a reverse drag into a forward half-open range', () => {
    const range = normalizeDraggedTickRange(tick(480), tick(120));

    expect(range).toEqual({ startTick: 120, endTick: 480 });
    expect(isTickRange(range)).toBe(true);
  });

  it('turns a click into the minimum non-empty half-open range', () => {
    expect(normalizeDraggedTickRange(tick(240), tick(240))).toEqual({
      startTick: 240,
      endTick: 241,
    });
  });

  it('clamps drags to the supplied half-open bounds', () => {
    const bounds: TickRange = { startTick: tick(100), endTick: tick(200) };

    expect(normalizeDraggedTickRange(tick(40), tick(160), bounds)).toEqual({
      startTick: 100,
      endTick: 160,
    });
    expect(normalizeDraggedTickRange(tick(180), tick(260), bounds)).toEqual({
      startTick: 180,
      endTick: 200,
    });
  });

  it('keeps an out-of-bounds click non-empty at either edge', () => {
    const bounds: TickRange = { startTick: tick(100), endTick: tick(200) };

    expect(normalizeDraggedTickRange(tick(20), tick(40), bounds)).toEqual({
      startTick: 100,
      endTick: 101,
    });
    expect(normalizeDraggedTickRange(tick(240), tick(260), bounds)).toEqual({
      startTick: 199,
      endTick: 200,
    });
  });

  it('rejects invalid drag bounds', () => {
    const emptyBounds = {
      startTick: tick(100),
      endTick: tick(100),
    } as TickRange;

    expect(() =>
      normalizeDraggedTickRange(tick(40), tick(60), emptyBounds),
    ).toThrow('bounds');
  });
});
