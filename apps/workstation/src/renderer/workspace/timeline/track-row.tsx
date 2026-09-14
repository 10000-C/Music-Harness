import type {
  TickRange,
  TimelineTrackViewModel,
  TrackId,
} from '../../b-contracts/index.js';
import { ClipBlock } from './clip-block.js';
import { trackPresentation } from './track-palette.js';

interface TrackRowProps {
  readonly track: TimelineTrackViewModel;
  readonly viewport: TickRange;
  readonly selected: boolean;
  readonly muted: boolean;
  readonly soloed: boolean;
  readonly selectionLeft: number | null;
  readonly selectionWidth: number | null;
  readonly selectionLabel: string;
  readonly showSelectionLabel: boolean;
  readonly onToggleTrack: (trackId: TrackId) => void;
  readonly onToggleMute: (trackId: TrackId) => void;
  readonly onToggleSolo: (trackId: TrackId) => void;
}

const percentage = (value: number): string => `${String(value)}%`;

export const TrackRow = ({
  track,
  viewport,
  selected,
  muted,
  soloed,
  selectionLeft,
  selectionWidth,
  selectionLabel,
  showSelectionLabel,
  onToggleTrack,
  onToggleMute,
  onToggleSolo,
}: TrackRowProps) => {
  const presentation = trackPresentation[track.trackId];
  return (
    <div
      className="track-row"
      data-selected={selected ? 'true' : 'false'}
      data-muted={muted ? 'true' : 'false'}
      data-track-id={track.trackId}
    >
      <div className="track-row__header">
        <button
          className="track-row__badge"
          style={{ borderColor: presentation.color, color: presentation.color }}
          type="button"
          aria-pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Add'} ${presentation.label} from scope`}
          onClick={() => {
            onToggleTrack(track.trackId);
          }}
        >
          {presentation.shortLabel}
        </button>
        <div className="track-row__identity">
          <strong>{presentation.label}</strong>
          <div className="track-row__mix-controls">
            <button
              type="button"
              aria-pressed={muted}
              aria-label={`${muted ? 'Unmute' : 'Mute'} ${presentation.label}`}
              onClick={() => {
                onToggleMute(track.trackId);
              }}
            >
              M
            </button>
            <button
              type="button"
              aria-pressed={soloed}
              aria-label={`${soloed ? 'Unsolo' : 'Solo'} ${presentation.label}`}
              onClick={() => {
                onToggleSolo(track.trackId);
              }}
            >
              S
            </button>
          </div>
        </div>
      </div>
      <div className="track-row__plot">
        {track.clips.map((clip, index) => (
          <ClipBlock
            clip={clip}
            trackId={track.trackId}
            viewport={viewport}
            key={`${track.trackId}-${String(clip.startTick)}-${String(index)}`}
          />
        ))}
        {selected && selectionLeft !== null && selectionWidth !== null && (
          <div
            className="track-row__selection"
            style={{
              left: percentage(selectionLeft),
              width: percentage(selectionWidth),
            }}
          >
            {showSelectionLabel && (
              <span className="track-row__selection-label">
                {selectionLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
