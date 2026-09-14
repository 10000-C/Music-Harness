import type { GenerationPlanOperationView } from '@agent-music/contracts';
import type { RendererTimelineViewModel as TimelineViewModel } from '../b-contracts/index.js';
import { formatScope } from './format-scope.js';

interface GenerationPlanStageProps {
  readonly operation: Extract<
    GenerationPlanOperationView,
    { state: 'pending' }
  >;
  readonly timeline?: TimelineViewModel | null;
  readonly busy?: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

export const GenerationPlanStage = ({
  operation,
  timeline = null,
  busy = false,
  onApprove,
  onReject,
}: GenerationPlanStageProps) => {
  const { label: timeLabel, tracks: trackLabel } = formatScope(
    operation.scope,
    timeline,
  );

  return (
    <section
      className="candidate-stage"
      aria-labelledby="generation-plan-stage-title"
    >
      <span className="candidate-stage__glow" aria-hidden="true" />
      <div className="candidate-stage__summary">
        <small>Generation Plan Ready</small>
        <h2 id="generation-plan-stage-title">Approve generation plan?</h2>
        <p>{operation.summary}</p>
        <div className="candidate-stage__scope">
          <strong>Scope:</strong> {timeLabel} | {trackLabel}
        </div>
      </div>
      <div className="candidate-stage__actions">
        <button
          type="button"
          className="ghost-action"
          onClick={onReject}
          disabled={busy}
        >
          Reject
        </button>
        <button
          type="button"
          className="primary-action"
          onClick={onApprove}
          disabled={busy}
          title={busy ? 'Processing request...' : undefined}
        >
          Approve Plan
        </button>
      </div>
    </section>
  );
};
