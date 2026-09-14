import type { CoreBootstrapState } from '../../b-contracts/index.js';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/PaperPlaneTilt';
import logoImg from '../../logo.png';

interface CompetitionAgentPanelProps {
  readonly state: CoreBootstrapState;
  readonly prompt: string;
  readonly onPromptChange: (value: string) => void;
  readonly onReviewPlan: () => void;
  readonly onCancelTask: () => void;
  readonly onRetryTask: () => void;
}

export const CompetitionAgentPanel = ({
  state,
  prompt,
  onPromptChange,
  onReviewPlan,
  onCancelTask,
  onRetryTask,
}: CompetitionAgentPanelProps) => {
  const running =
    state.task.status === 'active' && state.task.stage !== 'candidate_ready';
  const failed = state.task.status === 'failed';
  const candidateReady = state.candidate.status === 'ready';

  return (
    <aside className="agent-panel" aria-label="Music Harness Agent chat">
      <header className="agent-chat__header">
        <span className="agent-chat__avatar" aria-hidden="true">
          <img
            src={logoImg}
            alt=""
            style={{
              width: '22px',
              height: '22px',
              transform: 'scale(2.2)',
              objectFit: 'contain',
              filter: 'invert(1)',
            }}
          />
        </span>
        <span>
          <h2>Music Harness</h2>
          <small>Creative collaborator</small>
        </span>
      </header>

      <div className="agent-chat__messages" aria-live="polite">
        <article className="agent-chat__message agent-chat__message--assistant">
          <p>Tell me what you want to hear differently.</p>
        </article>
        {running && (
          <article className="agent-chat__message agent-chat__message--assistant">
            <small>Working on your idea</small>
            <p>{state.task.detail}</p>
            <button type="button" onClick={onCancelTask}>
              Stop
            </button>
          </article>
        )}
        {failed && (
          <article className="agent-chat__message agent-chat__message--assistant agent-chat__message--error">
            <small>{state.task.error.title}</small>
            <p>{state.task.error.message}</p>
            <button type="button" onClick={onRetryTask}>
              Try again
            </button>
          </article>
        )}
        {candidateReady && (
          <article className="agent-chat__message agent-chat__message--assistant agent-chat__message--candidate">
            <small>Variation ready</small>
            <p>
              It is waiting in the main workspace for you to listen and decide.
            </p>
          </article>
        )}
      </div>

      <label className="agent-composer">
        <span className="sr-only">Message Music Harness</span>
        <textarea
          rows={3}
          value={prompt}
          name="composer-message"
          autoComplete="off"
          placeholder="Describe the sound you are after…"
          onChange={(event) => {
            onPromptChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onReviewPlan();
            }
          }}
        />
        <button
          type="button"
          aria-label="Prepare a musical change"
          disabled={running || prompt.trim().length === 0}
          onClick={onReviewPlan}
        >
          <PaperPlaneTiltIcon size={16} weight="fill" />
        </button>
        <small>Ctrl/⌘ ↵ to prepare a safe variation</small>
      </label>
    </aside>
  );
};
