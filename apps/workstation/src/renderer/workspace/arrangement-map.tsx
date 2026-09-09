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
  readonly previewingCandidate?: boolean;
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
  previewingCandidate = false,
  onFocusTrack,
  onToggleMute,
  onToggleSolo,
}: ArrangementMapProps) => {
  if (timeline === null) return null;

  const bars = createBarBoundaryLabels(timeline, undefined, 9);
  const playhead = Math.min(
    100,
    Math.max(0, (playbackTick / timeline.totalTicks) * 100),
  );

  return (
    <section
      className="arrangement-map"
      data-review-mode={reviewMode || undefined}
      aria-labelledby="arrangement-map-title"
    >
      <header className="arrangement-map__header">
        <span>
          <h2 id="arrangement-map-title">
            {reviewMode ? 'Candidate review' : 'Arrangement'}
          </h2>
          <p>
            {reviewMode
              ? 'Audition the staged version against Current at the same moment.'
              : 'A listening map of the complete arrangement — not a MIDI editor.'}
          </p>
        </span>
        {reviewMode && (
          <span className="arrangement-map__mode">
            {previewingCandidate
              ? 'Listening to Candidate'
              : 'Listening to Current'}
          </span>
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
            left: `calc(164px + (100% - 164px) * ${String(playhead / 100)})`,
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
                onClick={() => onFocusTrack(track.trackId)}
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
                  onClick={() => onToggleMute(track.trackId)}
                >
                  M
                </button>
                <button
                  type="button"
                  aria-label={`${soloed ? 'Unsolo' : 'Solo'} ${presentation.label}`}
                  aria-pressed={soloed}
                  onClick={() => onToggleSolo(track.trackId)}
                >
                  S
                </button>
              </div>
              <div className="arrangement-map__clips">
                {track.clips.map((clip, index) => (
                  <span
                    className="arrangement-map__clip"
                    data-density={clip.density > 0.66 ? 'high' : undefined}
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
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
