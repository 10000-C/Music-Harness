import { PaperPlaneTiltIcon } from '@phosphor-icons/react/PaperPlaneTilt';
import { PlusIcon } from '@phosphor-icons/react/Plus';
import logoImg from '../../logo.png';
import { StopIcon } from '@phosphor-icons/react/Stop';
import type { AgentSessionId } from '@agent-music/contracts';
import type { LiveAgentState } from '../../core-client/live-agent-adapter.js';

interface LiveAgentPanelProps {
  readonly state: LiveAgentState | null;
  readonly prompt: string;
  readonly projectOpen: boolean;
  readonly onPromptChange: (value: string) => void;
  readonly onSendMessage: () => void;
  readonly onCancel: () => void;
  readonly onCreateSession: () => void;
  readonly onSelectSession: (sessionId: AgentSessionId) => void;
}

export const LiveAgentPanel = ({
  state,
  prompt,
  projectOpen,
  onPromptChange,
  onSendMessage,
  onCancel,
  onCreateSession,
  onSelectSession,
}: LiveAgentPanelProps) => {
  const isExecuting = state?.isExecuting ?? false;
  const messages = state?.messages ?? [];
  const streamingText = state?.streamingText ?? '';
  const error = state?.error ?? null;
  const activeSession = state?.activeSession ?? null;
  const sessions = state?.sessions ?? [];

  return (
    <aside className="agent-panel" aria-label="Music Harness Agent studio chat">
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Music Harness</h2>
          <small>
            {activeSession !== null
              ? `Session · ${activeSession.sessionId.slice(0, 8)}`
              : 'Creative collaborator'}
          </small>
        </div>
        {projectOpen && sessions.length > 1 && (
          <select
            className="agent-chat__session-select"
            value={activeSession?.sessionId ?? ''}
            disabled={isExecuting}
            onChange={(e) => {
              if (e.target.value) {
                onSelectSession(e.target.value as AgentSessionId);
              }
            }}
            aria-label="Switch conversation session"
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
        {projectOpen && (
          <button
            type="button"
            className="agent-chat__new-session"
            disabled={isExecuting}
            onClick={onCreateSession}
            title="New conversation session"
            aria-label="New conversation session"
          >
            <PlusIcon size={14} weight="bold" />
          </button>
        )}
      </header>

      <div className="agent-chat__messages" aria-live="polite">
        {!projectOpen ? null : (
          <>
            {messages.length === 0 && streamingText.length === 0 && (
              <article className="agent-chat__message agent-chat__message--assistant">
                <p>
                  Tell me what you want to hear differently in your arrangement.
                </p>
              </article>
            )}
            {messages.map((message, index) => (
              <article
                key={index}
                className={`agent-chat__message ${
                  message.role === 'user'
                    ? 'agent-chat__message--user'
                    : 'agent-chat__message--assistant'
                }`}
              >
                <p>{message.text}</p>
              </article>
            ))}
            {streamingText.length > 0 && (
              <article className="agent-chat__message agent-chat__message--assistant agent-chat__message--streaming">
                <small>Working on your arrangement…</small>
                <p>{streamingText}</p>
              </article>
            )}
            {isExecuting && streamingText.length === 0 && (
              <article className="agent-chat__message agent-chat__message--assistant">
                <small>Thinking</small>
                <p>Developing ideas for your arrangement…</p>
                <button
                  type="button"
                  onClick={onCancel}
                  className="agent-chat__stop-btn"
                >
                  <StopIcon size={12} weight="fill" /> Stop
                </button>
              </article>
            )}
            {error !== null && (
              <article className="agent-chat__message agent-chat__message--assistant agent-chat__message--error">
                <small>{error.code}</small>
                <p>{error.message}</p>
              </article>
            )}
          </>
        )}
      </div>

      <label className="agent-composer">
        <span className="sr-only">Message Music Harness</span>
        <textarea
          rows={3}
          value={prompt}
          disabled={!projectOpen || isExecuting}
          name="composer-message"
          autoComplete="off"
          placeholder={
            !projectOpen
              ? 'Open a project to begin chatting…'
              : 'Describe the sound you are after…'
          }
          onChange={(event) => {
            onPromptChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey) &&
              projectOpen &&
              !isExecuting
            ) {
              event.preventDefault();
              onSendMessage();
            }
          }}
        />
        {isExecuting ? (
          <button
            type="button"
            aria-label="Stop task"
            onClick={onCancel}
            className="agent-composer__stop"
          >
            <StopIcon size={16} weight="fill" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send musical request"
            disabled={!projectOpen || prompt.trim().length === 0}
            onClick={onSendMessage}
          >
            <PaperPlaneTiltIcon size={16} weight="fill" />
          </button>
        )}
        <small>Ctrl/⌘ ↵ to send request</small>
      </label>
    </aside>
  );
};
