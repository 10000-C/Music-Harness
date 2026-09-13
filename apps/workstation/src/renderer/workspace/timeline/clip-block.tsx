import type { CSSProperties } from 'react';
import type {
  RendererTimelineClip as TimelineClip,
  TickRange,
  TrackId,
} from '../../b-contracts/index.js';
import { trackPresentation } from './track-palette.js';

interface ClipBlockProps {
  readonly clip: TimelineClip;
  readonly trackId: TrackId;
  readonly viewport: TickRange;
}

const percentage = (value: number): string => `${String(value)}%`;

export const ClipBlock = ({ clip, trackId, viewport }: ClipBlockProps) => {
  const presentation = trackPresentation[trackId];
  const clipDuration = clip.endTick - clip.startTick;
  const viewportDuration = viewport.endTick - viewport.startTick;
  if (
    clip.endTick <= viewport.startTick ||
    clip.startTick >= viewport.endTick
  ) {
    return null;
  }
  const style: CSSProperties = {
    left: percentage(
      ((clip.startTick - viewport.startTick) / viewportDuration) * 100,
    ),
    width: percentage((clipDuration / viewportDuration) * 100),
    borderColor: presentation.color,
    backgroundColor: presentation.softColor,
  };

  return (
    <div
      className={`timeline-clip ${clip.label.includes('Candidate') ? 'clip-candidate-diff' : ''}`}
      style={style}
      title={`${presentation.label}: ${clip.label}`}
      data-track-id={trackId}
    >
      <span className="sr-only">{clip.label}</span>
      {clip.noteMarkers.map((marker, index) => {
        const markerLeft =
          ((marker.startTick - clip.startTick) / clipDuration) * 100;
        const markerWidth = Math.max(
          ((marker.endTick - marker.startTick) / clipDuration) * 100,
          0.7,
        );
        const markerHeight = 22 + ((marker.pitch - 24) / 103) * 48;
        return (
          <span
            className="timeline-clip__note"
            key={`${String(marker.startTick)}-${String(marker.pitch)}-${String(index)}`}
            style={{
              left: percentage(markerLeft),
              width: percentage(markerWidth),
              height: percentage(Math.min(72, Math.max(22, markerHeight))),
              backgroundColor: presentation.color,
              opacity: 0.42 + (marker.velocity / 127) * 0.46,
            }}
          />
        );
      })}
    </div>
  );
};
