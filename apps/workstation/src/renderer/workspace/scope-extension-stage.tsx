import type { PendingScopeExtensionView } from '@agent-music/contracts';
import type { RendererTimelineViewModel as TimelineViewModel } from '../b-contracts/index.js';
import { formatBarRange } from './timeline/timeline-labels.js';

interface ScopeExtensionStageProps {
  readonly pendingScopeExtension: PendingScopeExtensionView;
  readonly timeline?: TimelineViewModel | null;
  readonly busy?: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

export const ScopeExtensionStage = ({
  pendingScopeExtension,
  timeline = null,
  busy = false,
  onApprove,
  onReject,
}: ScopeExtensionStageProps) => {
  const { requestedScope, fromScopeRevision } = pendingScopeExtension;
  const timeLabel =
    requestedScope.type === 'wholeProject'
      ? '全工程'
      : timeline !== null
        ? formatBarRange(requestedScope, timeline)
        : `Ticks ${requestedScope.startTick}–${requestedScope.endTick}`;
  const trackLabel =
    requestedScope.trackIds.length === 0 ? 'All tracks' : requestedScope.trackIds.join(', ');

  return (
    <section className="candidate-stage" aria-labelledby="scope-extension-stage-title">
      <span className="candidate-stage__glow" aria-hidden="true" />
      <div className="candidate-stage__summary">
        <small>Scope Extension Requested</small>
        <h2 id="scope-extension-stage-title">Allow broader access?</h2>
        <p>
          <strong>Strong Confirmation:</strong> The agent requests to expand its task scope to continue working. This will allow the agent to modify the requested areas of your project.
        </p>
        <div className="candidate-stage__scope" style={{ marginTop: '8px', fontSize: '11px', color: '#9994a5' }}>
          <strong>Requested Scope:</strong> {timeLabel} | {trackLabel}
          <br />
          <strong>From Revision:</strong> {fromScopeRevision}
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
          Approve Scope
        </button>
      </div>
    </section>
  );
};
