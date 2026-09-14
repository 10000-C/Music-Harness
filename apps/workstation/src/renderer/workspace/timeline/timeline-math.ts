import { isTick, isTickRange } from '../../b-contracts/index.js';
import type { Tick, TickRange } from '../../b-contracts/index.js';

declare const timelineViewportBrand: unique symbol;

export interface TimelineViewportInput {
  /** Horizontal pixel offset from the timeline origin. */
  readonly scrollX: number;
  /** Base horizontal scale before applying zoom. */
  readonly pixelsPerTick: number;
  /** Positive multiplier applied to the base horizontal scale. */
  readonly zoom: number;
}

/**
 * Validated timeline projection values. Construct with
 * {@link createTimelineViewport}; pixel units remain a Renderer concern.
 */
export interface TimelineViewport extends TimelineViewportInput {
  readonly [timelineViewportBrand]: true;
}

export type TickRounding = 'floor' | 'round' | 'ceil';
export type ScopeKeyboardCommand =
  | 'clear'
  | 'first'
  | 'last'
  | 'moveBackward'
  | 'moveForward'
  | 'shrinkEnd'
  | 'extendEnd';

const assertFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
};

const assertTickValue: (
  value: number,
  name: string,
) => asserts value is Tick = (value, name) => {
  if (!isTick(value)) {
    throw new RangeError(`${name} must be a non-negative integer tick`);
  }
};

const assertTickRange: (
  value: TickRange,
  name: string,
) => asserts value is TickRange = (value, name) => {
  if (!isTickRange(value)) {
    throw new RangeError(`${name} must be a non-empty half-open tick range`);
  }
};

export const createTimelineViewport = (
  input: TimelineViewportInput,
): TimelineViewport => {
  assertFinite(input.scrollX, 'scrollX');
  assertFinite(input.pixelsPerTick, 'pixelsPerTick');
  assertFinite(input.zoom, 'zoom');

  if (input.scrollX < 0) {
    throw new RangeError('scrollX must be greater than or equal to zero');
  }

  if (input.pixelsPerTick <= 0) {
    throw new RangeError('pixelsPerTick must be greater than zero');
  }

  if (input.zoom <= 0) {
    throw new RangeError('zoom must be greater than zero');
  }

  const effectiveScale = input.pixelsPerTick * input.zoom;
  if (!Number.isFinite(effectiveScale) || effectiveScale <= 0) {
    throw new RangeError(
      'pixelsPerTick multiplied by zoom must be finite and greater than zero',
    );
  }

  return Object.freeze({ ...input }) as TimelineViewport;
};

const effectivePixelsPerTick = (viewport: TimelineViewport): number =>
  viewport.pixelsPerTick * viewport.zoom;

/** Maps a product-domain tick to a Renderer-local viewport x coordinate. */
export const tickToX = (tick: Tick, viewport: TimelineViewport): number => {
  assertTickValue(tick, 'tick');
  const x = tick * effectivePixelsPerTick(viewport) - viewport.scrollX;
  assertFinite(x, 'mapped x');
  return x;
};

/**
 * Maps a Renderer-local x coordinate to a product-domain tick. Coordinates
 * before the timeline origin clamp to tick zero.
 */
export const xToTick = (
  x: number,
  viewport: TimelineViewport,
  rounding: TickRounding = 'round',
): Tick => {
  assertFinite(x, 'x');

  const unroundedTick =
    (x + viewport.scrollX) / effectivePixelsPerTick(viewport);
  const roundedTick = Math[rounding](unroundedTick);

  if (!Number.isFinite(roundedTick)) {
    throw new RangeError('mapped tick must be finite');
  }

  return Math.max(0, roundedTick) as Tick;
};

/** Clamps an integer tick value to inclusive domain bounds. */
export const clampTick = (
  value: number,
  minimumTick: Tick,
  maximumTick: Tick,
): Tick => {
  assertTickValue(minimumTick, 'minimumTick');
  assertTickValue(maximumTick, 'maximumTick');

  if (minimumTick > maximumTick) {
    throw new RangeError(
      'minimumTick must be less than or equal to maximumTick',
    );
  }

  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError('value must be a finite integer tick');
  }

  return Math.min(maximumTick, Math.max(minimumTick, value)) as Tick;
};

/** Returns the maximum valid viewport origin for the requested zoom. */
export const maximumTimelineStartTick = (
  totalTicks: Tick,
  zoom: number,
): Tick => {
  assertTickValue(totalTicks, 'totalTicks');
  assertFinite(zoom, 'zoom');
  if (totalTicks === 0) return 0 as Tick;
  if (zoom < 1)
    throw new RangeError('zoom must be greater than or equal to one');
  const visibleTicks = Math.max(1, Math.ceil(totalTicks / zoom));
  return Math.max(0, totalTicks - visibleTicks) as Tick;
};

/** Builds the visible half-open tick window for zoom and horizontal scroll. */
export const createVisibleTickRange = (
  totalTicks: Tick,
  zoom: number,
  requestedStartTick: Tick,
): TickRange => {
  if (totalTicks === 0) {
    throw new RangeError('totalTicks must be greater than zero');
  }
  assertTickValue(requestedStartTick, 'requestedStartTick');
  const maximumStart = maximumTimelineStartTick(totalTicks, zoom);
  const startTick = clampTick(requestedStartTick, 0 as Tick, maximumStart);
  const visibleTicks = Math.max(1, Math.ceil(totalTicks / zoom));
  return {
    startTick,
    endTick: Math.min(totalTicks, startTick + visibleTicks) as Tick,
  };
};

/** Maps a tick into a percentage of a visible half-open tick window. */
export const tickToViewportPercentage = (
  tick: Tick,
  viewport: TickRange,
): number => {
  assertTickValue(tick, 'tick');
  assertTickRange(viewport, 'viewport');
  return (
    ((tick - viewport.startTick) / (viewport.endTick - viewport.startTick)) *
    100
  );
};

/** Applies the keyboard scope-selection model without depending on the DOM. */
export const applyScopeKeyboardCommand = (
  current: TickRange | null,
  playbackTick: Tick,
  totalTicks: Tick,
  step: Tick,
  command: ScopeKeyboardCommand,
): TickRange | null => {
  assertTickValue(playbackTick, 'playbackTick');
  assertTickValue(totalTicks, 'totalTicks');
  assertTickValue(step, 'step');
  if (totalTicks === 0 || step === 0) {
    throw new RangeError('totalTicks and step must be greater than zero');
  }
  if (current !== null) assertTickRange(current, 'current');
  if (command === 'clear') return null;

  const initialStart = Math.min(
    playbackTick,
    Math.max(0, totalTicks - step),
  ) as Tick;
  const range = current ?? {
    startTick: initialStart,
    endTick: Math.min(totalTicks, initialStart + step) as Tick,
  };

  if (command === 'first') {
    return {
      startTick: 0 as Tick,
      endTick: Math.min(step, totalTicks) as Tick,
    };
  }
  if (command === 'last') {
    return {
      startTick: Math.max(0, totalTicks - step) as Tick,
      endTick: totalTicks,
    };
  }
  if (command === 'shrinkEnd' || command === 'extendEnd') {
    return {
      startTick: range.startTick,
      endTick: clampTick(
        command === 'shrinkEnd' ? range.endTick - step : range.endTick + step,
        (range.startTick + 1) as Tick,
        totalTicks,
      ),
    };
  }

  const duration = range.endTick - range.startTick;
  const direction = command === 'moveBackward' ? -1 : 1;
  const startTick = clampTick(
    range.startTick + step * direction,
    0 as Tick,
    Math.max(0, totalTicks - duration) as Tick,
  );
  return { startTick, endTick: (startTick + duration) as Tick };
};

/**
 * Normalizes either drag direction into one non-empty half-open range. When
 * bounds are supplied, they are treated as the selectable half-open extent;
 * a click at its exclusive end selects the final tick.
 */
export const normalizeDraggedTickRange = (
  anchorTick: Tick,
  focusTick: Tick,
  bounds?: TickRange,
): TickRange => {
  assertTickValue(anchorTick, 'anchorTick');
  assertTickValue(focusTick, 'focusTick');

  let normalizedAnchor = anchorTick;
  let normalizedFocus = focusTick;

  if (bounds !== undefined) {
    assertTickRange(bounds, 'bounds');
    normalizedAnchor = clampTick(anchorTick, bounds.startTick, bounds.endTick);
    normalizedFocus = clampTick(focusTick, bounds.startTick, bounds.endTick);
  }

  const lowerTick = Math.min(normalizedAnchor, normalizedFocus) as Tick;
  const upperTick = Math.max(normalizedAnchor, normalizedFocus) as Tick;

  if (lowerTick < upperTick) {
    return { startTick: lowerTick, endTick: upperTick };
  }

  if (lowerTick === bounds?.endTick) {
    return {
      startTick: (bounds.endTick - 1) as Tick,
      endTick: bounds.endTick,
    };
  }

  const endTick = (lowerTick + 1) as Tick;
  if (!isTick(endTick) || endTick === lowerTick) {
    throw new RangeError('tick range cannot be advanced by one tick');
  }

  return { startTick: lowerTick, endTick };
};
