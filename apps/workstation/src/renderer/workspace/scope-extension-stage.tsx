import type { PendingScopeExtensionView } from '@agent-music/contracts';

interface ScopeExtensionStageProps {
  readonly pendingScopeExtension: PendingScopeExtensionView;
  readonly busy?: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

export const ScopeExtensionStage = ({
  pendingScopeExtension,
  busy = false,
  onApprove,
  onReject,
}: ScopeExtensionStageProps) => (
  <section className="candidate-stage" aria-labelledby="scope-extension-stage-title">
    <span className="candidate-stage__glow" aria-hidden="true" />
    <div className="candidate-stage__summary">
      <small>Scope Extension Requested</small>
      <h2 id="scope-extension-stage-title">Allow broader access?</h2>
      <p>
        The agent requests to expand its task scope to continue working.
      </p>
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
