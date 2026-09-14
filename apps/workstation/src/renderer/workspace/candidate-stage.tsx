import type { CandidateReviewDetails } from './competition-demo-view-model.js';

interface CandidateStageProps {
  readonly title: string;
  readonly details: CandidateReviewDetails | undefined;
  readonly previewingCandidate: boolean;
  readonly busy?: boolean;
  readonly candidateAuditionAvailable?: boolean;
  readonly candidateAcceptanceAvailable?: boolean;
  readonly onReviewCurrent: () => void;
  readonly onReviewCandidate: () => void;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}

export const CandidateStage = ({
  title,
  details,
  previewingCandidate,
  busy = false,
  candidateAuditionAvailable = true,
  candidateAcceptanceAvailable = true,
  onReviewCurrent,
  onReviewCandidate,
  onAccept,
  onReject,
}: CandidateStageProps) => (
  <section className="candidate-stage" aria-labelledby="candidate-stage-title">
    <span className="candidate-stage__glow" aria-hidden="true" />
    <div className="candidate-stage__summary">
      <small>Staged variation · not applied</small>
      <h2 id="candidate-stage-title">{details?.title ?? title}</h2>
      <p>
        {details === undefined
          ? candidateAuditionAvailable
            ? 'Review this variation in the arrangement before it changes Current.'
            : 'Candidate is safely staged. Audition will appear when Core provides a playback bundle.'
          : `${String(details.changes.length)} musical adjustments, ready to audition.`}
      </p>
    </div>
    <div
      className="candidate-stage__listen tactile-toggle"
      role="group"
      aria-label="Candidate audition"
    >
      <div
        className="tactile-toggle__indicator"
        data-active={previewingCandidate ? 'candidate' : 'current'}
        aria-hidden="true"
      />
      <button
        type="button"
        aria-pressed={!previewingCandidate}
        disabled={busy}
        onClick={onReviewCurrent}
      >
        Current
      </button>
      <button
        type="button"
        aria-pressed={previewingCandidate}
        disabled={busy || !candidateAuditionAvailable}
        title={
          !candidateAuditionAvailable
            ? 'Candidate audition is unavailable until Core provides playback data.'
            : undefined
        }
        onClick={onReviewCandidate}
      >
        {candidateAuditionAvailable ? 'Candidate' : 'Unavailable'}
      </button>
    </div>
    <div className="candidate-stage__actions">
      <button type="button" className="ghost-action" disabled={busy} onClick={onReject}>
        Discard
      </button>
      <button
        type="button"
        className="primary-action"
        disabled={busy || !candidateAcceptanceAvailable}
        title={
          !candidateAcceptanceAvailable
            ? 'Candidate must be auditioned before it can be applied.'
            : undefined
        }
        onClick={onAccept}
      >
        {candidateAcceptanceAvailable
          ? 'Apply to Current'
          : 'Apply unavailable until audition'}
      </button>
    </div>
  </section>
);
