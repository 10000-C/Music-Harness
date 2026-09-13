import { CheckCircleIcon } from '@phosphor-icons/react/CheckCircle';
import { CircleIcon } from '@phosphor-icons/react/Circle';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/ClockCounterClockwise';
import { SparkleIcon } from '@phosphor-icons/react/Sparkle';
import { WarningCircleIcon } from '@phosphor-icons/react/WarningCircle';
import { WaveformIcon } from '@phosphor-icons/react/Waveform';
import { XCircleIcon } from '@phosphor-icons/react/XCircle';
import type {
  CoreBootstrapState,
  TaskStage,
  TaskScope,
  TrackId,
} from '../../b-contracts/index.js';
import { useId, useRef } from 'react';
import projectCover from '../../assets/midnight-sketch.png';
import { getRovingTabIndex } from '../a11y-keyboard.js';
import { trackPresentation } from '../timeline/track-palette.js';

export type AgentPanelTab = 'agent' | 'activity';

interface AgentPanelProps {
  readonly state: CoreBootstrapState;
  readonly projectName: string;
  readonly scope: TaskScope;
  readonly scopeLabel: string;
  readonly blankCurrentOverride: boolean;
  readonly prompt: string;
  readonly tab: AgentPanelTab;
  readonly onPromptChange: (value: string) => void;
  readonly onTabChange: (tab: AgentPanelTab) => void;
  readonly onReviewPlan: () => void;
  readonly onCancelTask: () => void;
  readonly onRetryTask: () => void;
  readonly onReviewCandidate: () => void;
  readonly onAcceptCandidate: () => void;
  readonly onRejectCandidate: () => void;
}

const scopeTitle = (scope: TaskScope | null): string => {
  if (scope === null || scope.type === 'wholeProject') return 'Whole project';
  const names = scope.trackIds.map(
    (trackId) => trackPresentation[trackId].label,
  );
  return names.join(' + ');
};

const PanelTabs = ({
  tab,
  onTabChange,
  tabIds,
  panelIds,
}: Pick<AgentPanelProps, 'tab' | 'onTabChange'> & {
  readonly tabIds: Record<AgentPanelTab, string>;
  readonly panelIds: Record<AgentPanelTab, string>;
}) => {
  const tabs: readonly AgentPanelTab[] = ['agent', 'activity'];
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }

    event.preventDefault();
    const currentIndex = tabButtons.current.indexOf(event.currentTarget);
    const nextIndex = getRovingTabIndex(event.key, currentIndex, tabs.length);
    const nextTab = tabs[nextIndex];
    if (nextTab === undefined) return;
    onTabChange(nextTab);
    tabButtons.current[nextIndex]?.focus();
  };

  return (
    <div className="agent-tabs" role="tablist" aria-label="Agent panel views">
      {tabs.map((panelTab, index) => (
        <button
          key={panelTab}
          ref={(element) => {
            tabButtons.current[index] = element;
          }}
          id={tabIds[panelTab]}
          type="button"
          role="tab"
          aria-controls={panelIds[panelTab]}
          aria-selected={tab === panelTab}
          tabIndex={tab === panelTab ? 0 : -1}
          onKeyDown={onKeyDown}
          onClick={() => {
            onTabChange(panelTab);
          }}
        >
          {panelTab === 'agent' ? 'Agent' : 'Activity'}
        </button>
      ))}
    </div>
  );
};

const ScopeSummary = ({
  scope,
  label,
}: {
  readonly scope: TaskScope | null;
  readonly label: string;
}) => {
  const rangeLabel = label.includes(' · ')
    ? (label.split(' · ').at(-1) ?? label)
    : label;
  const match = /Bars (?<start>\d+)–(?<end>\d+)/u.exec(rangeLabel);
  const start = match?.groups?.start;
  const end = match?.groups?.end;
  const middle =
    start !== undefined && end !== undefined
      ? String(Math.floor((Number(start) + Number(end)) / 2))
      : '';

  return (
    <section className="agent-card scope-summary">
      <strong>{scopeTitle(scope)}</strong>
      <div className="scope-summary__ruler">
        <span>{start ?? 'Start'}</span>
        <span>{middle}</span>
        <span>{end ?? 'End'}</span>
        <i />
        <small>{rangeLabel}</small>
      </div>
      <div className="scope-summary__tracks">
        {Object.entries(trackPresentation).map(([trackId, track]) => {
          const active =
            scope === null || scope.trackIds.includes(trackId as TrackId);
          return (
            <div key={trackId} data-active={active ? 'true' : 'false'}>
              <CircleIcon size={10} weight="fill" color={track.color} />
              <span>{track.label}</span>
              <i
                style={{ backgroundColor: active ? track.color : undefined }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};

const SafetyNote = ({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) => (
  <section className="agent-safety-note">
    <CheckCircleIcon size={34} weight="fill" aria-hidden="true" />
    <span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </span>
  </section>
);

const ActivityPanel = ({ state }: { readonly state: CoreBootstrapState }) => (
  <div className="agent-activity-list">
    <div>
      <CheckCircleIcon size={18} weight="fill" />
      <span>
        <strong>
          {state.current.status === 'ready'
            ? state.current.label
            : 'Current unavailable'}
        </strong>
        <small>
          {state.current.status === 'ready'
            ? 'Six fixed tracks validated'
            : 'Open or recover a Current to continue'}
        </small>
      </span>
    </div>
    <div>
      <ClockCounterClockwiseIcon size={18} />
      <span>
        <strong>Project checkpoint</strong>
        <small>Current can be recovered safely</small>
      </span>
    </div>
    {state.task.status !== 'idle' && (
      <div>
        <WaveformIcon size={18} />
        <span>
          <strong>{state.task.title}</strong>
          <small>
            {state.task.status === 'active'
              ? state.task.detail
              : state.task.error.message}
          </small>
        </span>
      </div>
    )}
  </div>
);

const TASK_STAGE_PRESENTATION: Readonly<
  Record<TaskStage, { readonly label: string; readonly progress: number }>
> = {
  planning: { label: 'Planning', progress: 12 },
  awaiting_confirmation: { label: 'Awaiting confirmation', progress: 20 },
  preparing_candidate: { label: 'Preparing Candidate', progress: 32 },
  editing: { label: 'Editing selected music', progress: 50 },
  compiling: { label: 'Compiling playback', progress: 68 },
  validating: { label: 'Validating Candidate', progress: 82 },
  repairing: { label: 'Repairing Candidate', progress: 90 },
  candidate_ready: { label: 'Candidate ready', progress: 100 },
};

export const AgentPanel = ({
  state,
  projectName,
  scope,
  scopeLabel,
  blankCurrentOverride,
  prompt,
  tab,
  onPromptChange,
  onTabChange,
  onReviewPlan,
  onCancelTask,
  onRetryTask,
  onReviewCandidate,
  onAcceptCandidate,
  onRejectCandidate,
}: AgentPanelProps) => {
  const idPrefix = useId();
  const tabIds: Record<AgentPanelTab, string> = {
    agent: `${idPrefix}-agent-tab`,
    activity: `${idPrefix}-activity-tab`,
  };
  const panelIds: Record<AgentPanelTab, string> = {
    agent: `${idPrefix}-agent-panel`,
    activity: `${idPrefix}-activity-panel`,
  };
  const isBlank = blankCurrentOverride;
  const isRunning =
    state.task.status === 'active' && state.task.stage !== 'candidate_ready';
  const isFailed = state.task.status === 'failed';
  const candidateReady = state.candidate.status === 'ready';
  const taskPresentation =
    state.task.status === 'active'
      ? TASK_STAGE_PRESENTATION[state.task.stage]
      : null;
  const title = isRunning
    ? isBlank
      ? 'Creating your first Candidate'
      : 'Creating Candidate'
    : isFailed
      ? 'Candidate generation failed'
      : candidateReady
        ? 'Listening review'
        : isBlank
          ? 'Create your first arrangement'
          : 'MUSE Agent';
  const subtitle = isRunning
    ? 'Arrangement in progress'
    : isFailed
      ? 'Generation stopped before completion'
      : candidateReady
        ? 'A/B audition'
        : isBlank
          ? 'Start with an idea'
          : 'Composer Assistant';

  return (
    <aside className="agent-panel" aria-label="MUSE Agent">
      <header className="agent-panel__header">
        <span>
          <h2>{title}</h2>
          <small>{subtitle}</small>
        </span>
        <span
          className="agent-panel__status"
          data-tone={isFailed ? 'failed' : isRunning ? 'working' : 'ready'}
        >
          {isFailed ? 'Failed' : isRunning ? 'Creating' : 'Ready'}
        </span>
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
          tabIndex={0}
          hidden={tab !== 'activity'}
          className="agent-tabpanel"
        >
          <ActivityPanel state={state} />
        </div>
        <div
          id={panelIds.agent}
          role="tabpanel"
          aria-labelledby={tabIds.agent}
          tabIndex={0}
          hidden={tab !== 'agent'}
          className="agent-tabpanel"
        >
          {isRunning ? (
            <>
              <section className="agent-card task-progress">
                <strong>{taskPresentation?.label}</strong>
                <small>{state.task.detail}</small>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${String(taskPresentation?.progress ?? 0)}%`,
                    }}
                  />
                </div>
              </section>
              <section className="agent-card process-steps">
                {['Edit', 'Compile', 'Validate'].map((step, index) => {
                  const progress = taskPresentation?.progress ?? 0;
                  const threshold = [0, 60, 78][index] ?? 100;
                  const nextThreshold = [60, 78, 101][index] ?? 101;
                  const complete = progress >= nextThreshold;
                  const active =
                    progress >= threshold && progress < nextThreshold;
                  return (
                    <span key={step} data-active={active ? 'true' : undefined}>
                      {complete ? (
                        <CheckCircleIcon size={20} weight="fill" />
                      ) : (
                        <CircleIcon size={20} weight="fill" />
                      )}
                      <small>{step}</small>
                    </span>
                  );
                })}
              </section>
              <ScopeSummary scope={scope} label={scopeLabel} />
              <SafetyNote
                title={
                  isBlank
                    ? 'Blank Current is unchanged'
                    : 'Candidate is isolated'
                }
                detail="Current remains editable during creation."
              />
            </>
          ) : isFailed ? (
            <>
              <section className="agent-card failure-card">
                <WarningCircleIcon size={30} weight="fill" />
                <span>
                  <strong>{state.task.error.title}</strong>
                  <small>{state.task.error.message}</small>
                </span>
              </section>
              <ScopeSummary scope={scope} label={scopeLabel} />
            </>
          ) : candidateReady ? (
            <>
              <section className="agent-card candidate-card">
                <WaveformIcon size={38} weight="duotone" />
                <span>
                  <strong>Candidate · {scopeLabel}</strong>
                  <small>{state.candidate.summary}</small>
                </span>
              </section>
              <ScopeSummary scope={scope} label={scopeLabel} />
              <section className="candidate-actions-summary">
                <button type="button" onClick={onAcceptCandidate}>
                  <CheckCircleIcon size={28} weight="fill" />
                  <strong>Accept Candidate</strong>
                  <small>Candidate becomes Current</small>
                </button>
                <button type="button" onClick={onRejectCandidate}>
                  <XCircleIcon size={28} weight="fill" />
                  <strong>Reject Candidate</strong>
                  <small>Current stays unchanged</small>
                </button>
              </section>
            </>
          ) : (
            <>
              {isBlank ? (
                <section className="agent-project-intent">
                  <img src={projectCover} alt="" />
                  <span>
                    <strong>{projectName}</strong>
                    <small>Blank Current · ready for a first arrangement</small>
                  </span>
                </section>
              ) : (
                <section className="agent-change-intent">
                  <h3>Make the chorus feel weightless and wide.</h3>
                  <p>
                    Build guitar harmony that lets the vocal breathe—softly,
                    with intimate drums and answering keys.
                  </p>
                </section>
              )}
              <label className="agent-prompt">
                <span>
                  {isBlank ? 'Describe your idea' : 'Describe the change'}
                </span>
                <textarea
                  value={prompt}
                  name="agent-prompt"
                  autoComplete="off"
                  onChange={(event) => {
                    onPromptChange(event.currentTarget.value);
                  }}
                  placeholder={
                    isBlank
                      ? 'Describe the song, feeling or structure…'
                      : 'Describe the feeling, sound or change…'
                  }
                  rows={4}
                />
                <SparkleIcon size={18} weight="fill" aria-hidden="true" />
              </label>
              <div
                className="prompt-suggestions"
                aria-label="Prompt suggestions"
              >
                {['late-night', 'indie rock', 'wide guitars'].map(
                  (suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => {
                        onPromptChange(
                          prompt.length > 0
                            ? `${prompt}, ${suggestion}`
                            : suggestion,
                        );
                      }}
                    >
                      {suggestion}
                    </button>
                  ),
                )}
              </div>
              <ScopeSummary scope={scope} label={scopeLabel} />
              <SafetyNote
                title={isBlank ? 'Safe first step' : 'Current stays stable'}
                detail="Candidate changes remain isolated until accepted."
              />
            </>
          )}
        </div>
      </div>

      <footer className="agent-panel__footer">
        {isRunning ? (
          <button
            type="button"
            className="secondary-action"
            onClick={onCancelTask}
          >
            Cancel task
          </button>
        ) : isFailed ? (
          <button
            type="button"
            className="secondary-action"
            onClick={onRetryTask}
          >
            Retry generation
          </button>
        ) : candidateReady ? (
          <button
            type="button"
            className="primary-action"
            onClick={onReviewCandidate}
          >
            Review Candidate
          </button>
        ) : (
          <button
            type="button"
            className="primary-action"
            onClick={onReviewPlan}
          >
            {isBlank ? 'Review plan' : 'Create Candidate'}
          </button>
        )}
      </footer>
    </aside>
  );
};
