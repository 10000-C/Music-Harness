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
  const track = trackPresentation[trackId];
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
            aria-pressed={muted}
            onClick={() => {
              onToggleMute(trackId);
            }}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            aria-pressed={soloed}
            onClick={() => {
              onToggleSolo(trackId);
            }}
          >
            {soloed ? 'Unsolo' : 'Solo'}
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
                  '--track-color': index === 0 ? track.color : undefined,
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
