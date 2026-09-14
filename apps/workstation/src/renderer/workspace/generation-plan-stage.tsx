import type { GenerationPlanOperationView } from '@agent-music/contracts';

interface GenerationPlanStageProps {
  readonly operation: Extract<GenerationPlanOperationView, { state: 'pending' }>;
  readonly busy?: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

export const GenerationPlanStage = ({
  operation,
  busy = false,
  onApprove,
  onReject,
}: GenerationPlanStageProps) => (
  <section className="candidate-stage" aria-labelledby="generation-plan-stage-title">
    <span className="candidate-stage__glow" aria-hidden="true" />
    <div className="candidate-stage__summary">
      <small>Generation Plan Ready</small>
      <h2 id="generation-plan-stage-title">Approve generation plan?</h2>
      <p>{operation.summary}</p>
    </div>
    <div className="candidate-stage__actions">
      <button type="button" className="ghost-action" onClick={onReject} disabled={busy}>
        Reject
      </button>
      <button
        type="button"
        className="primary-action"
        onClick={onApprove}
        disabled={busy}
        title={busy ? "Processing request..." : undefined}
      >
        Approve Plan
      </button>
    </div>
  </section>
);
