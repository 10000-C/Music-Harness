import type { CandidateReviewDetails } from './competition-demo-view-model.js';

interface CandidateStageProps {
  readonly title: string;
  readonly details: CandidateReviewDetails | undefined;
  readonly previewingCandidate: boolean;
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
            : 'Candidate state is ready to apply. Audition will appear when Core provides a playback bundle.'
          : `${String(details.changes.length)} musical adjustments, ready to audition.`}
      </p>
    </div>
    <div className="candidate-stage__listen" aria-label="Candidate audition">
      <button
        type="button"
        aria-pressed={!previewingCandidate}
        onClick={onReviewCurrent}
      >
        Current
      </button>
      <button
        type="button"
        aria-pressed={previewingCandidate}
        disabled={!candidateAuditionAvailable}
        title={
          candidateAuditionAvailable
            ? undefined
            : 'Candidate audition is unavailable until Core provides playback data.'
        }
        onClick={onReviewCandidate}
      >
        {candidateAuditionAvailable
          ? 'Listen to Candidate'
          : 'Candidate audition unavailable'}
      </button>
    </div>
    <div className="candidate-stage__actions">
      <button type="button" onClick={onReject}>
        Discard
      </button>
      <button
        type="button"
        disabled={!candidateAcceptanceAvailable}
        title={
          candidateAcceptanceAvailable
            ? undefined
            : 'Candidate must be auditioned before it can be applied.'
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
