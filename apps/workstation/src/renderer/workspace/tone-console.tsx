import { useState, useEffect, useRef } from 'react';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/SlidersHorizontal';
import { XIcon } from '@phosphor-icons/react/X';
import type { TrackId } from '../b-contracts/index.js';
import { trackPresentation } from './timeline/track-palette.js';

interface ToneConsoleProps {
  readonly trackId: TrackId;
  readonly muted: boolean;
  readonly soloed: boolean;
  readonly onToggleMute: (trackId: TrackId) => void;
  readonly onToggleSolo: (trackId: TrackId) => void;
}

const soundProfile: Readonly<
  Record<
    TrackId,
    readonly [
      readonly [string, string],
      readonly [string, string],
      readonly [string, string],
      readonly [string, string],
    ]
  >
> = {
  'track.keys': [
    ['Grand Piano', 'Close felt'],
    ['Tone', 'Warm · 58%'],
    ['Space', 'Room · 26%'],
    ['Dynamics', 'Soft touch'],
  ],
  'track.guitar': [
    ['Clean Guitar', 'Dreamy chorus'],
    ['Tone', 'Bright · 58%'],
    ['Space', 'Wide · 72%'],
    ['Dynamics', 'Present · 68%'],
  ],
  'track.bass': [
    ['Finger Bass', 'Round core'],
    ['Tone', 'Dark · 44%'],
    ['Space', 'Dry'],
    ['Dynamics', 'Even · 62%'],
  ],
  'track.strings': [
    ['Warm Strings', 'Soft ensemble'],
    ['Tone', 'Silky · 64%'],
    ['Space', 'Hall · 64%'],
    ['Dynamics', 'Gentle swell'],
  ],
  'track.drums': [
    ['Standard Kit', 'Tight kit'],
    ['Tone', 'Crisp · 61%'],
    ['Space', 'Short room'],
    ['Dynamics', 'Punch · 73%'],
  ],
  'track.winds': [
    ['Ensemble Winds', 'Open air'],
    ['Tone', 'Breathy · 54%'],
    ['Space', 'Hall · 48%'],
    ['Dynamics', 'Light rise'],
  ],
};

export const ToneConsole = ({
  trackId,
  muted,
  soloed,
  onToggleMute,
  onToggleSolo,
}: ToneConsoleProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const lastTrackIdRef = useRef(trackId);

  // Automatically reopen when user focuses a different track
  useEffect(() => {
    if (lastTrackIdRef.current !== trackId) {
      lastTrackIdRef.current = trackId;
      setCollapsed(false);
    }
  }, [trackId]);

  const track = trackPresentation[trackId];

  if (collapsed) {
    return (
      <aside className="tone-console-dock" aria-label="Sound character docked">
        <button
          type="button"
          className="tone-console-dock__pill"
          onClick={() => {
            setCollapsed(false);
          }}
          title="Expand sound character inspector"
        >
          <span className="tone-console-dock__icon">
            <SlidersHorizontalIcon weight="bold" />
          </span>
          <span className="tone-console-dock__title">
            Sound character · <strong>{track.label}</strong>
          </span>
          <span className="tone-console-dock__badge">Show</span>
        </button>
      </aside>
    );
  }

  return (
    <section className="tone-console" aria-labelledby="tone-console-title">
      <header className="tone-console__header">
        <span>
          <h2 id="tone-console-title">Sound character · {track.label}</h2>
          <p>
            Current listening profile. Advanced shaping is intentionally kept
            out of P0.
          </p>
        </span>
        <div
          className="tone-console__actions"
          aria-label={`${track.label} controls`}
        >
          <button
            type="button"
            aria-label={muted ? 'Unmute track' : 'Mute track'}
            aria-pressed={muted}
            onClick={() => {
              onToggleMute(trackId);
            }}
          >
            Mute
          </button>
          <button
            type="button"
            aria-label={soloed ? 'Soloed' : 'Solo track'}
            aria-pressed={soloed}
            onClick={() => {
              onToggleSolo(trackId);
            }}
          >
            Solo
          </button>
          <button
            type="button"
            className="tone-console__close-btn"
            onClick={() => {
              setCollapsed(true);
            }}
            aria-label="Close sound character inspector"
            title="Close inspector"
          >
            <XIcon weight="bold" />
          </button>
        </div>
      </header>
      <div className="tone-console__profile">
        {soundProfile[trackId].map(([label, value], index) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <i
              style={
                {
                  '--track-color': track.color,
                  '--amount': `${String(42 + index * 13)}%`,
                } as React.CSSProperties
              }
            />
          </article>
        ))}
      </div>
    </section>
  );
};
