import type {
  RendererTimelineViewModel,
  Tick,
  TrackId,
} from '../b-contracts/index.js';
import { createBarBoundaryLabels } from './timeline/timeline-labels.js';
import { trackPresentation } from './timeline/track-palette.js';

interface ArrangementMapProps {
  readonly timeline: RendererTimelineViewModel | null;
  readonly playbackTick: Tick;
  readonly focusedTrackId: TrackId;
  readonly mutedTrackIds: ReadonlySet<TrackId>;
  readonly soloTrackIds: ReadonlySet<TrackId>;
  readonly reviewMode?: boolean;
  readonly onFocusTrack: (trackId: TrackId) => void;
  readonly onToggleMute: (trackId: TrackId) => void;
  readonly onToggleSolo: (trackId: TrackId) => void;
}

const percent = (value: number): string => `${String(value)}%`;

export const ArrangementMap = ({
  timeline,
  playbackTick,
  focusedTrackId,
  mutedTrackIds,
  soloTrackIds,
  reviewMode = false,
  onFocusTrack,
  onToggleMute,
  onToggleSolo,
}: ArrangementMapProps) => {
  if (timeline === null) return null;

  const bars = createBarBoundaryLabels(timeline, undefined, 9);
  const playhead = Math.min(
    Math.max(0, (playbackTick / timeline.totalTicks) * 100),
    100,
  );
  const TRACK_HEADER_WIDTH_PX = 164;
  const TRACK_HEADER_WIDTH_CSS = `${String(TRACK_HEADER_WIDTH_PX)}px`;
  const playheadStyleLeft =
    playhead === 0
      ? TRACK_HEADER_WIDTH_CSS
      : `calc(${TRACK_HEADER_WIDTH_CSS} + (100% - ${TRACK_HEADER_WIDTH_CSS}) * ${String(playhead / 100)})`;

  return (
    <section
      className="arrangement-map"
      data-review-mode={reviewMode || undefined}
      aria-labelledby="arrangement-map-title"
    >
      <header
        className="arrangement-map__header"
        style={
          reviewMode ? { padding: 0, height: 0, overflow: 'hidden' } : undefined
        }
      >
        <h2
          id="arrangement-map-title"
          className={reviewMode ? 'candidate-stage__sr-only' : undefined}
          style={
            reviewMode
              ? {
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }
              : undefined
          }
        >
          {reviewMode ? 'Candidate review' : 'Arrangement'}
        </h2>
        {!reviewMode && (
          <p>
            A listening map of the complete arrangement — not a MIDI editor.
          </p>
        )}
      </header>
      <div className="arrangement-map__ruler" aria-hidden="true">
        <span />
        <div>
          {bars.map(({ bar, tick }) => (
            <small
              key={tick}
              style={{ left: percent((tick / timeline.totalTicks) * 100) }}
            >
              {bar}
            </small>
          ))}
        </div>
      </div>
      <div className="arrangement-map__tracks">
        <div
          className="arrangement-map__playhead"
          style={{
            left: playheadStyleLeft,
          }}
          aria-hidden="true"
        />
        {timeline.tracks.map((track) => {
          const presentation = trackPresentation[track.trackId];
          const muted = mutedTrackIds.has(track.trackId);
          const soloed = soloTrackIds.has(track.trackId);
          return (
            <article
              className="arrangement-map__track"
              data-focused={focusedTrackId === track.trackId || undefined}
              data-muted={muted || undefined}
              key={track.trackId}
            >
              <button
                className="arrangement-map__identity"
                type="button"
                aria-pressed={focusedTrackId === track.trackId}
                aria-label={`Show ${presentation.label} sound`}
                onClick={() => {
                  onFocusTrack(track.trackId);
                }}
              >
                <span
                  style={
                    {
                      '--track-color': presentation.color,
                    } as React.CSSProperties
                  }
                >
                  {presentation.shortLabel}
                </span>
                <strong>{presentation.label}</strong>
              </button>
              <div className="arrangement-map__mix">
                <button
                  type="button"
                  aria-label={`${muted ? 'Unmute' : 'Mute'} ${presentation.label}`}
                  aria-pressed={muted}
                  onClick={() => {
                    onToggleMute(track.trackId);
                  }}
                >
                  M
                </button>
                <button
                  type="button"
                  aria-label={`${soloed ? 'Unsolo' : 'Solo'} ${presentation.label}`}
                  aria-pressed={soloed}
                  onClick={() => {
                    onToggleSolo(track.trackId);
                  }}
                >
                  S
                </button>
              </div>
              <div className="arrangement-map__clips">
                {track.clips.map((clip, index) => {
                  const isCandidate =
                    reviewMode &&
                    clip.label.toLowerCase().includes('candidate');
                  return (
                    <span
                      className="arrangement-map__clip"
                      data-density={clip.density > 0.66 ? 'high' : undefined}
                      data-candidate={isCandidate ? 'true' : undefined}
                      key={`${track.trackId}-${String(index)}-${String(clip.startTick)}`}
                      style={
                        {
                          '--track-color': presentation.color,
                          left: percent(
                            (clip.startTick / timeline.totalTicks) * 100,
                          ),
                          width: percent(
                            ((clip.endTick - clip.startTick) /
                              timeline.totalTicks) *
                              100,
                          ),
                        } as React.CSSProperties
                      }
                      title={`${presentation.label}: ${clip.label}`}
                    >
                      <span>{clip.label}</span>
                    </span>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
