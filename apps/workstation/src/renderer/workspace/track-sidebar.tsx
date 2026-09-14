import type {
  RendererTimelineViewModel,
  TrackId,
} from '../b-contracts/index.js';
import { trackPresentation } from './timeline/track-palette.js';

interface TrackSidebarProps {
  readonly timeline: RendererTimelineViewModel | null;
  readonly inspectedTrackId: TrackId;
  readonly mutedTrackIds: ReadonlySet<TrackId>;
  readonly soloTrackIds: ReadonlySet<TrackId>;
  readonly onInspectTrack: (trackId: TrackId) => void;
  readonly onToggleMute: (trackId: TrackId) => void;
  readonly onToggleSolo: (trackId: TrackId) => void;
}

const instrumentLabel: Readonly<Record<TrackId, string>> = {
  'track.keys': 'Grand Piano',
  'track.guitar': 'Clean Guitar',
  'track.bass': 'Finger Bass',
  'track.strings': 'Warm Strings',
  'track.drums': 'Standard Kit',
  'track.winds': 'Ensemble Winds',
};

export const TrackSidebar = ({
  timeline,
  inspectedTrackId,
  mutedTrackIds,
  soloTrackIds,
  onInspectTrack,
  onToggleMute,
  onToggleSolo,
}: TrackSidebarProps) => {
  const trackOrder: readonly TrackId[] = [
    'track.keys',
    'track.guitar',
    'track.bass',
    'track.strings',
    'track.drums',
    'track.winds',
  ];
  return (
    <aside className="project-sidebar" aria-label="Project tracks">
      <span className="sidebar-eyebrow">Tracks</span>
      <div className="project-tracks">
        {[...(timeline?.tracks ?? [])]
          .sort(
            (left, right) =>
              trackOrder.indexOf(left.trackId) -
              trackOrder.indexOf(right.trackId),
          )
          .map((track) => {
            const presentation = trackPresentation[track.trackId];
            return (
              <article
                key={track.trackId}
                className="project-track"
                data-selected={inspectedTrackId === track.trackId}
              >
                <button
                  type="button"
                  className="project-track__select"
                  aria-pressed={inspectedTrackId === track.trackId}
                  onClick={() => {
                    onInspectTrack(track.trackId);
                  }}
                >
                  <span>{presentation.shortLabel}</span>
                  <strong>{presentation.label}</strong>
                  <small>{instrumentLabel[track.trackId]}</small>
                </button>
                <div className="project-track__mix">
                  <button
                    type="button"
                    aria-label={`${mutedTrackIds.has(track.trackId) ? 'Unmute' : 'Mute'} ${presentation.label}`}
                    aria-pressed={mutedTrackIds.has(track.trackId)}
                    onClick={() => {
                      onToggleMute(track.trackId);
                    }}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    aria-label={`${soloTrackIds.has(track.trackId) ? 'Unsolo' : 'Solo'} ${presentation.label}`}
                    aria-pressed={soloTrackIds.has(track.trackId)}
                    onClick={() => {
                      onToggleSolo(track.trackId);
                    }}
                  >
                    S
                  </button>
                </div>
              </article>
            );
          })}
      </div>
      <section className="sidebar-help">
        <strong>Logical tracks</strong>
        <p>MIDI channels are normalized into human-friendly tracks.</p>
      </section>
    </aside>
  );
};
