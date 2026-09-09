import type { CandidateReviewDetails } from './competition-demo-view-model.js';

interface CandidateStageProps {
  readonly title: string;
  readonly details: CandidateReviewDetails | undefined;
  readonly previewingCandidate: boolean;
  readonly onReviewCurrent: () => void;
  readonly onReviewCandidate: () => void;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}

export const CandidateStage = ({
  title,
  details,
  previewingCandidate,
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
          ? 'Review this variation in the arrangement before it changes Current.'
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
        onClick={onReviewCandidate}
      >
        Listen to Candidate
      </button>
    </div>
    <div className="candidate-stage__actions">
      <button type="button" onClick={onReject}>
        Discard
      </button>
      <button type="button" onClick={onAccept}>
        Apply to Current
      </button>
    </div>
  </section>
);
