import type { CoreBootstrapState, TaskScope } from '../../b-contracts/index.js';
import { useId, useRef } from 'react';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/ClockCounterClockwise';
import { getRovingTabIndex } from '../a11y-keyboard.js';
import type { CandidateReviewDetails } from '../competition-demo-view-model.js';
import { trackPresentation } from '../timeline/track-palette.js';
import type { AgentPanelTab } from './agent-panel.js';

interface CompetitionAgentPanelProps {
  readonly state: CoreBootstrapState;
  readonly scope: TaskScope;
  readonly scopeLabel: string;
  readonly prompt: string;
  readonly tab: AgentPanelTab;
  readonly onPromptChange: (value: string) => void;
  readonly onTabChange: (tab: AgentPanelTab) => void;
  readonly onReviewPlan: () => void;
  readonly onCancelTask: () => void;
  readonly onRetryTask: () => void;
  readonly onReviewCandidate: () => void;
  readonly onReviewCurrent: () => void;
  readonly previewingCandidate: boolean;
  readonly onSelectPianoScope: () => void;
  readonly onSelectWholeScope: () => void;
  readonly candidateDetails: CandidateReviewDetails | undefined;
  readonly onAcceptCandidate: () => void;
  readonly onRejectCandidate: () => void;
}

const PanelTabs = ({
  tab,
  onTabChange,
  tabIds,
  panelIds,
}: Pick<CompetitionAgentPanelProps, 'tab' | 'onTabChange'> & {
  readonly tabIds: Record<AgentPanelTab, string>;
  readonly panelIds: Record<AgentPanelTab, string>;
}) => {
  const tabs: readonly AgentPanelTab[] = ['agent', 'activity'];
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="agent-tabs" role="tablist" aria-label="Agent panel views">
      {tabs.map((item, index) => (
        <button
          key={item}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          id={tabIds[item]}
          type="button"
          role="tab"
          aria-controls={panelIds[item]}
          aria-selected={tab === item}
          tabIndex={tab === item ? 0 : -1}
          onKeyDown={(event) => {
            if (
              event.key !== 'ArrowLeft' &&
              event.key !== 'ArrowRight' &&
              event.key !== 'Home' &&
              event.key !== 'End'
            )
              return;
            event.preventDefault();
            const next = getRovingTabIndex(event.key, index, tabs.length);
            const nextTab = tabs[next];
            if (nextTab !== undefined) {
              onTabChange(nextTab);
              buttons.current[next]?.focus();
            }
          }}
          onClick={() => {
            onTabChange(item);
          }}
        >
          {item === 'agent' ? 'Agent' : 'Activity'}
        </button>
      ))}
    </div>
  );
};

const Composer = ({
  prompt,
  onPromptChange,
  onSubmit,
  disabled,
}: {
  readonly prompt: string;
  readonly onPromptChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly disabled: boolean;
}) => (
  <label className="agent-composer">
    <textarea
      rows={2}
      value={prompt}
      placeholder="Describe the change you want…"
      onChange={(event) => {
        onPromptChange(event.currentTarget.value);
      }}
    />
    <button
      type="button"
      aria-label="Review change plan"
      disabled={disabled || prompt.trim().length === 0}
      onClick={onSubmit}
    >
      ↑
    </button>
  </label>
);

const ScopeHeader = ({
  active,
  note,
  trackLabel,
  onSelectPiano,
  onSelectWhole,
}: {
  readonly active: 'piano' | 'whole';
  readonly note: string;
  readonly trackLabel: string;
  readonly onSelectPiano?: () => void;
  readonly onSelectWhole?: () => void;
}) => (
  <section className="agent-scope">
    <span>Agent scope</span>
    <div>
      <button type="button" disabled data-unavailable="true">
        Selection
      </button>
      <button
        type="button"
        data-active={active === 'piano'}
        disabled={onSelectPiano === undefined}
        aria-pressed={active === 'piano'}
        onClick={onSelectPiano}
      >
        {trackLabel} track
      </button>
      <button
        type="button"
        data-active={active === 'whole'}
        disabled={onSelectWhole === undefined}
        aria-pressed={active === 'whole'}
        onClick={onSelectWhole}
      >
        Whole project
      </button>
    </div>
    <small>{note}</small>
  </section>
);

const ActivityPanel = () => {
  return (
    <div className="activity-panel">
      <header>
        <h3>Committed changes</h3>
        <p>Only edits that changed the Project appear here.</p>
      </header>
      <section className="activity-empty">
        <ClockCounterClockwiseIcon size={24} aria-hidden="true" />
        <strong>History unavailable</strong>
        <p>
          Project history is not available in this workspace yet. Accepted
          Candidates and direct track edits will appear here once it is.
        </p>
      </section>
    </div>
  );
};

export const CompetitionAgentPanel = ({
  state,
  scope,
  scopeLabel,
  prompt,
  tab,
  onPromptChange,
  onTabChange,
  onReviewPlan,
  onCancelTask,
  onRetryTask,
  onReviewCandidate,
  onReviewCurrent,
  previewingCandidate,
  onSelectPianoScope,
  onSelectWholeScope,
  candidateDetails,
  onAcceptCandidate,
  onRejectCandidate,
}: CompetitionAgentPanelProps) => {
  const prefix = useId();
  const tabIds = {
    agent: `${prefix}-agent-tab`,
    activity: `${prefix}-activity-tab`,
  };
  const panelIds = {
    agent: `${prefix}-agent-panel`,
    activity: `${prefix}-activity-panel`,
  };
  const candidateReady = state.candidate.status === 'ready';
  const running =
    state.task.status === 'active' && state.task.stage !== 'candidate_ready';
  const failed = state.task.status === 'failed';
  const selectedLabel =
    scope.trackIds.length === 6
      ? 'Whole project'
      : scope.trackIds.map((id) => trackPresentation[id].label).join(' + ');
  const trackScopeLabel =
    selectedLabel === 'Whole project' ? 'Piano' : selectedLabel;
  return (
    <aside className="agent-panel" aria-label="MUSE Agent">
      <span className="sr-only">{scopeLabel}</span>
      <header className="agent-panel__header sr-only">
        <h2>MUSE Agent</h2>
      </header>
      <PanelTabs
        tab={tab}
        onTabChange={onTabChange}
        tabIds={tabIds}
        panelIds={panelIds}
      />
      <div className="agent-panel__body">
        <div
          id={panelIds.activity}
          role="tabpanel"
          aria-labelledby={tabIds.activity}
          hidden={tab !== 'activity'}
          className="agent-tabpanel"
        >
          <ActivityPanel />
        </div>
        <div
          id={panelIds.agent}
          role="tabpanel"
          aria-labelledby={tabIds.agent}
          hidden={tab !== 'agent'}
          className="agent-tabpanel"
        >
          {candidateReady ? (
            <div className="candidate-review">
              <ScopeHeader
                active={selectedLabel === 'Whole project' ? 'whole' : 'piano'}
                note="May update multiple tracks, instruments, and mix settings."
                trackLabel={trackScopeLabel}
              />
              <article className="agent-message agent-message--user">
                <small>You · {selectedLabel}</small>
                Make the chorus wider and warmer without masking the lead.
              </article>
              <article className="agent-message agent-message--assistant">
                <small>Agent</small>
                <p>Prepared 1 staged Candidate.</p>
              </article>
              <section className="candidate-diff">
                <header>
                  <span>Candidate 01</span>
                  <strong>Not applied</strong>
                </header>
                <h3>{candidateDetails?.title ?? state.candidate.summary}</h3>
                <p>
                  {candidateDetails === undefined
                    ? 'Candidate summary'
                    : `${String(candidateDetails.changes.length)} structured changes`}{' '}
                  · {selectedLabel}
                </p>
                <dl>
                  {(
                    candidateDetails?.changes ?? [
                      { track: 'Summary', detail: state.candidate.summary },
                    ]
                  ).map((change, index) => (
                    <div key={`${change.track}-${String(index)}`}>
                      <dt>{change.track}</dt>
                      <dd>{change.detail}</dd>
                    </div>
                  ))}
                </dl>
                <div className="candidate-preview">
                  <button
                    type="button"
                    aria-pressed={!previewingCandidate}
                    onClick={onReviewCurrent}
                  >
                    Original
                  </button>
                  <button
                    type="button"
                    aria-pressed={previewingCandidate}
                    onClick={onReviewCandidate}
                  >
                    Candidate
                  </button>
                </div>
                <div className="candidate-actions">
                  <button type="button" onClick={onRejectCandidate}>
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onPromptChange(
                        'Refine the Candidate with a softer attack',
                      );
                    }}
                  >
                    Refine
                  </button>
                  <button type="button" onClick={onAcceptCandidate}>
                    Apply
                  </button>
                </div>
              </section>
            </div>
          ) : running ? (
            <div className="agent-running">
              <span className="agent-avatar">A</span>
              <h3>{state.task.title}</h3>
              <p>{state.task.detail}</p>
              <button type="button" onClick={onCancelTask}>
                Cancel task
              </button>
            </div>
          ) : failed ? (
            <div className="agent-running">
              <span className="agent-avatar">!</span>
              <h3>{state.task.error.title}</h3>
              <p>{state.task.error.message}</p>
              <button type="button" onClick={onRetryTask}>
                Retry generation
              </button>
            </div>
          ) : (
            <div className="agent-home">
              <ScopeHeader
                active={selectedLabel === 'Whole project' ? 'whole' : 'piano'}
                note="Defaults to the selected logical track."
                trackLabel={trackScopeLabel}
                onSelectPiano={onSelectPianoScope}
                onSelectWhole={onSelectWholeScope}
              />
              <strong className="agent-selection-badge">
                {selectedLabel} selected
              </strong>
              <h3>What should change?</h3>
              <p>
                Ask naturally. The Agent proposes a Candidate before anything is
                committed.
              </p>
              <div className="agent-quick-actions">
                {[
                  'Make this piano softer and warmer',
                  'Try a more intimate instrument',
                  'Reduce harshness in the chorus',
                ].map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    onClick={() => {
                      onPromptChange(suggestion);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <section className="candidate-explainer">
                <strong>Candidate</strong>
                <p>Previewable staged changes — not yet applied.</p>
              </section>
            </div>
          )}
        </div>
      </div>
      {!running && !failed && tab === 'agent' && (
        <Composer
          prompt={prompt}
          onPromptChange={onPromptChange}
          onSubmit={onReviewPlan}
          disabled={scope.trackIds.length === 0}
        />
      )}
    </aside>
  );
};
