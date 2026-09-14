import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type {
  RendererTimelineViewModel as TimelineViewModel,
  Tick,
  TickRange,
  TrackId,
} from '../../b-contracts/index.js';
import {
  applyScopeKeyboardCommand,
  clampTick,
  createVisibleTickRange,
  maximumTimelineStartTick,
  normalizeDraggedTickRange,
  tickToViewportPercentage,
  type ScopeKeyboardCommand,
} from './timeline-math.js';
import {
  createBarBoundaryLabels,
  formatBarRange,
  ticksForBars,
  ticksPerBar,
  timelineBarCount,
} from './timeline-labels.js';
import { TrackRow } from './track-row.js';

const MINIMUM_ZOOM = 1;
const MAXIMUM_ZOOM = 8;
const ZOOM_FACTOR = 1.5;
const percentage = (value: number): string => `${String(value)}%`;
interface TimelineProps {
  readonly timeline: TimelineViewModel | null;
  readonly comparisonTimeline: TimelineViewModel | null;
  readonly candidateMode: boolean;
  readonly playbackTick: Tick;
  readonly selectedTrackIds: readonly TrackId[];
  readonly timeRange: TickRange | null;
  readonly loopRange: TickRange | null;
  readonly zoom: number;
  readonly startTick: Tick;
  readonly mutedTrackIds: ReadonlySet<TrackId>;
  readonly soloTrackIds: ReadonlySet<TrackId>;
  readonly onPlaybackTickChange: (tick: Tick) => void;
  readonly onTrackSelectionChange: (trackIds: readonly TrackId[]) => void;
  readonly onTimeRangeChange: (range: TickRange | null) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onStartTickChange: (tick: Tick) => void;
  readonly onToggleMute: (trackId: TrackId) => void;
  readonly onToggleSolo: (trackId: TrackId) => void;
}

const tickAtPointer = (
  event: ReactPointerEvent<HTMLElement>,
  viewport: TickRange,
): Tick => {
  const bounds = event.currentTarget.getBoundingClientRect();
  const ratio = Math.min(
    1,
    Math.max(0, (event.clientX - bounds.left) / bounds.width),
  );
  return Math.round(
    viewport.startTick + ratio * (viewport.endTick - viewport.startTick),
  ) as Tick;
};

const visibleIntersection = (
  range: TickRange | null,
  viewport: TickRange,
): TickRange | null => {
  if (
    range === null ||
    range.endTick <= viewport.startTick ||
    range.startTick >= viewport.endTick
  ) {
    return null;
  }
  return {
    startTick: Math.max(range.startTick, viewport.startTick) as Tick,
    endTick: Math.min(range.endTick, viewport.endTick) as Tick,
  };
};

const keyboardScopeRange = (
  current: TickRange | null,
  playbackTick: Tick,
  totalTicks: Tick,
  step: Tick,
  event: ReactKeyboardEvent<HTMLDivElement>,
): TickRange | null => {
  let command: ScopeKeyboardCommand | null = null;
  if (event.key === 'Escape') command = 'clear';
  else if (event.key === 'Home') command = 'first';
  else if (event.key === 'End') command = 'last';
  else if (event.key === 'ArrowLeft') {
    command = event.shiftKey ? 'shrinkEnd' : 'moveBackward';
  } else if (event.key === 'ArrowRight') {
    command = event.shiftKey ? 'extendEnd' : 'moveForward';
  }

  return command === null
    ? current
    : applyScopeKeyboardCommand(
        current,
        playbackTick,
        totalTicks,
        step,
        command,
      );
};

export const Timeline = ({
  timeline,
  comparisonTimeline,
  candidateMode,
  playbackTick,
  selectedTrackIds,
  timeRange,
  loopRange,
  zoom,
  startTick,
  mutedTrackIds,
  soloTrackIds,
  onPlaybackTickChange,
  onTrackSelectionChange,
  onTimeRangeChange,
  onZoomChange,
  onStartTickChange,
  onToggleMute,
  onToggleSolo,
}: TimelineProps) => {
  const [dragAnchor, setDragAnchor] = useState<Tick | null>(null);
  const [dragFocus, setDragFocus] = useState<Tick | null>(null);
  const pointerId = useRef<number | null>(null);
  const selected = useMemo(
    () => new Set<TrackId>(selectedTrackIds),
    [selectedTrackIds],
  );

  if (timeline === null) return null;
  const totalTicks = timeline.totalTicks;
  const viewport = createVisibleTickRange(totalTicks, zoom, startTick);
  const maximumStart = maximumTimelineStartTick(totalTicks, zoom);
  const oneBar = ticksForBars(timeline, 1);
  const activeRange =
    dragAnchor === null || dragFocus === null
      ? timeRange
      : normalizeDraggedTickRange(dragAnchor, dragFocus, {
          startTick: 0 as Tick,
          endTick: totalTicks,
        });
  const visibleSelection = visibleIntersection(activeRange, viewport);
  const visibleLoop = visibleIntersection(loopRange, viewport);
  const selectionLeft = visibleSelection
    ? tickToViewportPercentage(visibleSelection.startTick, viewport)
    : null;
  const selectionWidth = visibleSelection
    ? ((visibleSelection.endTick - visibleSelection.startTick) /
        (viewport.endTick - viewport.startTick)) *
      100
    : null;
  const finalSelectedTrack = timeline.tracks
    .filter((track) => selected.has(track.trackId))
    .at(-1)?.trackId;
  const rangeLabel = activeRange ? formatBarRange(activeRange, timeline) : '';
  const rulerLabels = createBarBoundaryLabels(timeline, viewport, 9);
  const gridLines = createBarBoundaryLabels(timeline, viewport, 65);
  const playheadVisible =
    playbackTick >= viewport.startTick && playbackTick <= viewport.endTick;
  const playbackBar = Math.min(
    timelineBarCount(timeline),
    Math.floor(playbackTick / ticksPerBar(timeline)) + 1,
  );
  const inspectedTrack =
    timeline.tracks.find((track) => selected.has(track.trackId)) ??
    timeline.tracks[0];
  const noteIsVisible = (note: {
    readonly startTick: Tick;
    readonly endTick: Tick;
  }): boolean =>
    note.endTick > viewport.startTick && note.startTick < viewport.endTick;
  const activeNotes = (inspectedTrack?.clips ?? []).flatMap((clip) =>
    clip.noteMarkers.filter(noteIsVisible).map(
      (note) =>
        ({
          note,
          tone: clip.label.includes('Candidate') ? 'candidate' : 'current',
        }) as const,
    ),
  );
  const comparisonTrack = comparisonTimeline?.tracks.find(
    (track) => track.trackId === inspectedTrack?.trackId,
  );
  const comparisonNotes = (comparisonTrack?.clips ?? []).flatMap((clip) =>
    clip.noteMarkers
      .filter(noteIsVisible)
      .map((note) => ({ note, tone: 'current' }) as const),
  );
  const visibleNotes = candidateMode
    ? [
        ...comparisonNotes,
        ...activeNotes.filter(({ tone }) => tone === 'candidate'),
      ]
    : activeNotes;
  const chorusClip = inspectedTrack?.clips.find((clip) =>
    clip.label.toUpperCase().startsWith('CHORUS'),
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    pointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const tick = tickAtPointer(event, viewport);
    setDragAnchor(tick);
    setDragFocus(tick);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerId.current !== event.pointerId || dragAnchor === null) return;
    setDragFocus(tickAtPointer(event, viewport));
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerId.current !== event.pointerId || dragAnchor === null) return;
    const focus = tickAtPointer(event, viewport);
    onTimeRangeChange(
      normalizeDraggedTickRange(dragAnchor, focus, {
        startTick: 0 as Tick,
        endTick: totalTicks,
      }),
    );
    pointerId.current = null;
    setDragAnchor(null);
    setDragFocus(null);
  };

  const toggleTrack = (trackId: TrackId): void => {
    const next = new Set(selected);
    if (next.has(trackId) && next.size > 1) next.delete(trackId);
    else next.add(trackId);
    onTrackSelectionChange(
      timeline.tracks
        .map((track) => track.trackId)
        .filter((candidate) => next.has(candidate)),
    );
  };

  const changeZoom = (nextZoom: number): void => {
    onZoomChange(
      Math.min(
        MAXIMUM_ZOOM,
        Math.max(MINIMUM_ZOOM, Math.round(nextZoom * 100) / 100),
      ),
    );
  };

  const scrollByBars = (bars: number): void => {
    onStartTickChange(
      clampTick(
        viewport.startTick +
          ticksForBars(timeline, Math.abs(bars)) * Math.sign(bars),
        0 as Tick,
        maximumStart,
      ),
    );
  };

  const onWheel = (event: ReactWheelEvent<HTMLElement>): void => {
    if (zoom <= MINIMUM_ZOOM) return;
    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!horizontalDelta && !event.shiftKey) return;
    event.preventDefault();
    scrollByBars(event.deltaX + event.deltaY < 0 ? -1 : 1);
  };

  return (
    <section
      className="timeline"
      aria-label="Six-track arrangement"
      onWheel={onWheel}
    >
      <div className="timeline__ruler">
        <div className="timeline__ruler-spacer">
          <button
            type="button"
            aria-label="Zoom timeline out"
            disabled={zoom <= MINIMUM_ZOOM}
            onClick={() => {
              changeZoom(zoom / ZOOM_FACTOR);
            }}
          >
            −
          </button>
          <output aria-label="Timeline zoom">{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            aria-label="Zoom timeline in"
            disabled={zoom >= MAXIMUM_ZOOM}
            onClick={() => {
              changeZoom(zoom * ZOOM_FACTOR);
            }}
          >
            +
          </button>
        </div>
        <div className="timeline__bar-labels">
          {rulerLabels.map(({ bar, tick }) => (
            <span
              key={`${String(bar)}-${String(tick)}`}
              style={{
                left: percentage(tickToViewportPercentage(tick, viewport)),
              }}
            >
              {bar}
            </span>
          ))}
          <div
            className="timeline__seek-layer"
            role="slider"
            tabIndex={0}
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={totalTicks}
            aria-valuenow={playbackTick}
            aria-valuetext={`Bar ${String(playbackBar)}`}
            onPointerDown={(event) => {
              onPlaybackTickChange(tickAtPointer(event, viewport));
            }}
            onKeyDown={(event) => {
              let next: Tick | null = null;
              if (event.key === 'ArrowLeft') {
                next = clampTick(playbackTick - oneBar, 0 as Tick, totalTicks);
              } else if (event.key === 'ArrowRight') {
                next = clampTick(playbackTick + oneBar, 0 as Tick, totalTicks);
              } else if (event.key === 'Home') {
                next = 0 as Tick;
              } else if (event.key === 'End') {
                next = totalTicks;
              }
              if (next !== null) {
                event.preventDefault();
                onPlaybackTickChange(next);
              }
            }}
          />
          <input
            className="timeline__scrollbar"
            type="range"
            min={0}
            max={maximumStart}
            step={oneBar}
            value={viewport.startTick}
            disabled={maximumStart === 0}
            aria-label="Scroll timeline"
            onChange={(event) => {
              onStartTickChange(Number(event.currentTarget.value) as Tick);
            }}
          />
        </div>
      </div>
      <div className="timeline__body">
        <div
          className="timeline__interaction-layer"
          aria-label="Timeline scope selection"
          aria-describedby="timeline-scope-instructions"
          aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End Escape"
          role="group"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onKeyDown={(event) => {
            const next = keyboardScopeRange(
              timeRange,
              playbackTick,
              totalTicks,
              oneBar,
              event,
            );
            if (next !== timeRange) {
              event.preventDefault();
              onTimeRangeChange(next);
            }
          }}
        >
          <span className="sr-only" id="timeline-scope-instructions">
            Use Left and Right Arrow to move the scope by one bar. Hold Shift to
            resize its end. Home and End select an edge bar. Escape clears the
            time range.
          </span>
        </div>
        <div className="timeline__plot-overlay" aria-hidden="true">
          <div className="piano-notes">
            {visibleNotes.map(({ note, tone }, index) => (
              <i
                data-tone={tone}
                key={`${String(note.startTick)}-${String(note.pitch)}-${String(index)}`}
                style={{
                  left: percentage(
                    tickToViewportPercentage(note.startTick, viewport),
                  ),
                  top: percentage(
                    Math.min(88, Math.max(8, 50 - (note.pitch - 64) * 3.3)),
                  ),
                  width: percentage(
                    ((note.endTick - note.startTick) /
                      (viewport.endTick - viewport.startTick)) *
                      100,
                  ),
                  opacity: 0.55 + (note.velocity / 127) * 0.4,
                }}
              />
            ))}
          </div>
          {chorusClip !== undefined &&
            chorusClip.endTick > viewport.startTick &&
            chorusClip.startTick < viewport.endTick && (
              <div
                className="timeline-section"
                style={{
                  left: percentage(
                    tickToViewportPercentage(chorusClip.startTick, viewport),
                  ),
                  width: percentage(
                    ((chorusClip.endTick - chorusClip.startTick) /
                      (viewport.endTick - viewport.startTick)) *
                      100,
                  ),
                }}
              >
                {chorusClip.label.split(' · ')[0]}
              </div>
            )}
          {gridLines.map(({ bar, tick }) => (
            <span
              className="timeline__grid-line"
              key={`grid-${String(bar)}-${String(tick)}`}
              style={{
                left: percentage(tickToViewportPercentage(tick, viewport)),
              }}
            />
          ))}
          {visibleLoop !== null && (
            <div
              className="timeline__loop-range"
              style={{
                left: percentage(
                  tickToViewportPercentage(visibleLoop.startTick, viewport),
                ),
                width: percentage(
                  ((visibleLoop.endTick - visibleLoop.startTick) /
                    (viewport.endTick - viewport.startTick)) *
                    100,
                ),
              }}
            />
          )}
          {playheadVisible && (
            <div
              className="timeline__playhead"
              style={{
                left: percentage(
                  tickToViewportPercentage(playbackTick, viewport),
                ),
              }}
            >
              <span />
            </div>
          )}
        </div>
        {timeline.tracks.map((track) => (
          <TrackRow
            key={track.trackId}
            track={track}
            viewport={viewport}
            selected={selected.has(track.trackId)}
            muted={mutedTrackIds.has(track.trackId)}
            soloed={soloTrackIds.has(track.trackId)}
            selectionLeft={selectionLeft}
            selectionWidth={selectionWidth}
            selectionLabel={rangeLabel}
            showSelectionLabel={finalSelectedTrack === track.trackId}
            onToggleTrack={toggleTrack}
            onToggleMute={onToggleMute}
            onToggleSolo={onToggleSolo}
          />
        ))}
      </div>
    </section>
  );
};
