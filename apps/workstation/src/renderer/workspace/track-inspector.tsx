import type { TrackId } from '../b-contracts/index.js';
import { competitionCandidatePianoPatch } from './competition-demo-view-model.js';
import { trackPresentation } from './timeline/track-palette.js';

interface TrackInspectorProps {
  readonly trackId: TrackId;
  readonly candidateReady: boolean;
  readonly muted: boolean;
  readonly soloed: boolean;
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

const Parameter = ({
  label,
  value,
  amount,
}: {
  readonly label: string;
  readonly value: string;
  readonly amount: number;
}) => (
  <div className="inspector-parameter">
    <span>{label}</span>
    <output>{value}</output>
    <i style={{ '--amount': `${String(amount)}%` } as React.CSSProperties} />
  </div>
);

export const TrackInspector = ({
  trackId,
  candidateReady,
  muted,
  soloed,
  onToggleMute,
  onToggleSolo,
}: TrackInspectorProps) => {
  const track = trackPresentation[trackId];
  return (
    <section
      className="track-inspector"
      aria-label={`${track.label} track inspector`}
    >
      <header>
        <strong>{track.label}</strong>
        <div>
          <span>Track Inspector</span>
          <small>
            Shape how this track sounds. Notes stay in the Piano Roll.
          </small>
        </div>
      </header>
      <div className="inspector-column inspector-instrument">
        <h3>Instrument</h3>
        <button type="button" disabled>
          {candidateReady && trackId === 'track.keys'
            ? competitionCandidatePianoPatch.instrument.to
            : instrumentLabel[trackId]}
          <span>⌄</span>
        </button>
        <p>SoundFont preset</p>
        <div className="inspector-mix__buttons">
          <button
            type="button"
            aria-pressed={muted}
            onClick={() => {
              onToggleMute(trackId);
            }}
          >
            Mute
          </button>
          <button
            type="button"
            aria-pressed={soloed}
            onClick={() => {
              onToggleSolo(trackId);
            }}
          >
            Solo
          </button>
        </div>
      </div>
      <div className="inspector-column">
        <h3>
          Tone <em>Experimental</em>
        </h3>
        <Parameter
          label="Brightness"
          value={String(
            candidateReady
              ? competitionCandidatePianoPatch.brightness.to
              : competitionCandidatePianoPatch.brightness.from,
          )}
          amount={
            candidateReady
              ? competitionCandidatePianoPatch.brightness.to
              : competitionCandidatePianoPatch.brightness.from
          }
        />
        <Parameter label="Attack" value="30" amount={30} />
        <Parameter label="Release" value="55" amount={55} />
        <footer>
          <span>Advanced</span>
          <small>Resonance is hidden in P0</small>
        </footer>
      </div>
      <div className="inspector-column">
        <h3>Space</h3>
        <Parameter
          label="Reverb"
          value={String(
            candidateReady
              ? competitionCandidatePianoPatch.reverb.to
              : competitionCandidatePianoPatch.reverb.from,
          )}
          amount={
            candidateReady
              ? competitionCandidatePianoPatch.reverb.to
              : competitionCandidatePianoPatch.reverb.from
          }
        />
        <Parameter
          label="Chorus"
          value={String(
            candidateReady
              ? competitionCandidatePianoPatch.chorus.to
              : competitionCandidatePianoPatch.chorus.from,
          )}
          amount={
            candidateReady
              ? competitionCandidatePianoPatch.chorus.to
              : competitionCandidatePianoPatch.chorus.from
          }
        />
      </div>
      <div className="inspector-column inspector-mix">
        <h3>Mix</h3>
        <Parameter label="Volume" value="−2.4 dB" amount={66} />
        <Parameter label="Pan" value="Center" amount={50} />
        <p>Track-level mix only</p>
      </div>
    </section>
  );
};
