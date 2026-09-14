import type { GenerationPlanOperationView } from '@agent-music/contracts';
import type { RendererTimelineViewModel as TimelineViewModel } from '../b-contracts/index.js';
import { formatBarRange } from './timeline/timeline-labels.js';

interface GenerationPlanStageProps {
  readonly operation: Extract<GenerationPlanOperationView, { state: 'pending' }>;
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
  const { scope } = operation;
  const timeLabel =
    scope.type === 'wholeProject'
      ? '全工程'
      : timeline !== null
        ? formatBarRange(scope, timeline)
        : `Ticks ${scope.startTick}–${scope.endTick}`;
  const trackLabel = scope.trackIds.length === 0 ? 'All tracks' : scope.trackIds.join(', ');

  return (
    <section className="candidate-stage" aria-labelledby="generation-plan-stage-title">
      <span className="candidate-stage__glow" aria-hidden="true" />
      <div className="candidate-stage__summary">
        <small>Generation Plan Ready</small>
        <h2 id="generation-plan-stage-title">Approve generation plan?</h2>
        <p>{operation.summary}</p>
        <div className="candidate-stage__scope" style={{ marginTop: '8px', fontSize: '11px', color: '#9994a5' }}>
          <strong>Scope:</strong> {timeLabel} | {trackLabel}
        </div>
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
};
