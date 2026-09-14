import {
  TRACK_IDS,
  type ProjectId,
  type RendererCommand,
  type ServiceKind,
  type TaskScope,
  type Tick,
  type RendererTimelineViewModel as TimelineViewModel,
  type TrackId,
} from './b-contracts/index.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandResult } from '../shared/shell-contracts.js';
import type {
  OpenedProject,
  ProjectCommand,
  ProjectEvent,
} from '@agent-music/contracts';
import {
  unavailableServiceSnapshot,
  type ServiceFleetSnapshot,
} from '../shared/service-status.js';
import type { FakeCoreFixtureName } from './core-client/index.js';
import { fakeCandidateTimeline } from './core-client/fake-core-fixtures.js';
import { useWorkstationDemo } from './state/use-workstation-demo.js';
import { createCurrentPlaybackViewModel } from './core-client/current-playback-view-model.js';
import {
  createLiveCandidateAdapter,
  type LiveCandidateAdapter,
  type LiveCandidateState,
} from './core-client/live-candidate-adapter.js';
import {
  createLiveGenerationPlanAdapter,
  type LiveGenerationPlanAdapter,
  type LiveGenerationPlanState,
} from './core-client/live-generation-plan-adapter.js';
import {
  createLiveAgentAdapter,
  type LiveAgentAdapter,
  type LiveAgentState,
} from './core-client/index.js';
import { type PlaybackRuntimeState } from './opendaw-runtime/index.js';
import { createSpessaSynthPlaybackRuntime } from './opendaw-runtime/spessasynth-playback-runtime.js';
import { createSourceAwarePlaybackAdapter, type SourceAwarePlaybackAdapter } from './opendaw-runtime/index.js';
import type { PlaybackCommand } from './opendaw-runtime/types.js';
import {
  createAbcjsWavRenderer,
  createCurrentExportAdapter,
  type CurrentExportAdapter,
} from './export/index.js';
import { CompetitionAgentPanel } from './workspace/agent/competition-agent-panel.js';
import { LiveAgentPanel } from './workspace/agent/live-agent-panel.js';
import type { AgentSessionId } from '@agent-music/contracts';
import { ArrangementMap } from './workspace/arrangement-map.js';
import { CandidateStage } from './workspace/candidate-stage.js';
import { ScopeExtensionStage } from './workspace/scope-extension-stage.js';
import { GenerationPlanStage } from './workspace/generation-plan-stage.js';
import { ProjectSwitchConfirmation } from './workspace/project-switch-confirmation.js';
import { ConfirmationDialog } from './workspace/confirmation-dialog.js';
import { competitionCandidateDetails } from './workspace/competition-demo-view-model.js';
import {
  SettingsModal,
  type AgentSettings,
} from './workspace/settings-modal.js';
import { ExportCurrentView } from './workspace/export-current.js';
import {
  exportCurrentSuggestedName,
  type ExportCurrentFormat,
} from './workspace/export-current-model.js';
import {
  ProjectHeader,
  type ProjectStatusTone,
} from './workspace/project-header.js';
import {
  ProjectSidebar,
  type WorkspaceView,
} from './workspace/project-sidebar.js';
import { ToneConsole } from './workspace/tone-console.js';
import { ticksForBars } from './workspace/timeline/timeline-labels.js';
import {
  ServiceHealthNotice,
  StructuredErrorNotice,
} from './workspace/workstation-alerts.js';
import {
  currentSafetyMessage,
  selectWorkstationError,
} from './workspace/workstation-alert-model.js';

const DEFAULT_FIXTURE: FakeCoreFixtureName = 'stable';
const explicitFixtureMode = new URLSearchParams(window.location.search).has(
  'fixture',
);
const FIXTURE_NAMES = new Set<FakeCoreFixtureName>([
  'blank',
  'stable',
  'running',
  'failed',
  'candidate',
]);
const asTick = (value: number): Tick => Math.max(0, Math.round(value)) as Tick;

const fixtureFromLocation = (): FakeCoreFixtureName => {
  const fixture = new URLSearchParams(window.location.search).get('fixture');
  return fixture !== null && FIXTURE_NAMES.has(fixture as FakeCoreFixtureName)
    ? (fixture as FakeCoreFixtureName)
    : DEFAULT_FIXTURE;
};

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('button, a, input, textarea, select, [role="button"]') !==
      null
  );
};

const formatTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

const requestId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

const projectNameOf = (
  project:
    | { readonly status: 'closed' }
    | { readonly status: 'opening'; readonly displayName: string }
    | {
        readonly status: 'open';
        readonly projectId: ProjectId;
        readonly name: string;
      }
    | {
        readonly status: 'blocked';
        readonly displayName: string;
        readonly projectId: ProjectId | null;
      },
): string => {
  if (project.status === 'open') return project.name;
  if (project.status === 'opening' || project.status === 'blocked') {
    return project.displayName;
  }
  return 'No project';
};

const secondsAtTick = (
  timeline: TimelineViewModel,
  targetTick: Tick,
): number => {
  let seconds = 0;
  for (let index = 0; index < timeline.tempoMap.length; index += 1) {
    const event = timeline.tempoMap[index];
    if (event === undefined || event.tick >= targetTick) break;
    const nextEvent = timeline.tempoMap[index + 1];
    const segmentEnd = Math.min(targetTick, nextEvent?.tick ?? targetTick);
    const segmentTicks = Math.max(0, segmentEnd - event.tick);
    seconds += (segmentTicks / timeline.ticksPerQuarter / event.bpm) * 60;
    if (segmentEnd === targetTick) break;
  }
  return seconds;
};

const bpmAtTick = (timeline: TimelineViewModel, targetTick: Tick): number => {
  let activeBpm = timeline.tempoMap[0]?.bpm ?? 92;
  for (const event of timeline.tempoMap) {
    if (event.tick > targetTick) break;
    activeBpm = event.bpm;
  }
  return activeBpm;
};

const LoadingWorkspace = ({ error }: { readonly error: Error | null }) => (
  <main className="workspace-loading" role={error ? 'alert' : 'status'}>
    <span className="workspace-loading__mark">M</span>
    <h1>{error ? 'The workspace could not be opened' : 'Opening project'}</h1>
    <p>
      {error?.message ??
        'Loading the saved Current and its six-track timeline…'}
    </p>
  </main>
);

interface UtilityViewProps {
  readonly view: Exclude<WorkspaceView, 'studio'>;
  readonly projectName: string;
  readonly currentSummary: string;
  readonly settingsSummary: string;
  readonly recoveryRequired: boolean;
  readonly onBack: () => void;
}

const UtilityView = ({
  view,
  projectName,
  currentSummary,
  settingsSummary,
  recoveryRequired,
  onBack,
}: UtilityViewProps) => {
  const content = {
    export: {
      eyebrow: 'Delivery',
      title: 'Export Current',
      detail:
        'Only the saved Current can be exported. Candidate material stays isolated until it is accepted.',
    },
    recovery: {
      eyebrow: 'Safety',
      title: 'Recovery points',
      detail: recoveryRequired
        ? `${projectName} requires recovery before editing can continue.`
        : `${projectName} has a healthy Current checkpoint. No recovery action is required.`,
    },
    settings: {
      eyebrow: 'Workspace',
      title: 'Project settings',
      detail:
        'Project preferences remain local to this workstation and do not alter the musical Current.',
    },
  }[view];

  return (
    <section className="utility-view" aria-labelledby="utility-title">
      <span className="utility-view__eyebrow">{content.eyebrow}</span>
      <h2 id="utility-title">{content.title}</h2>
      <p>{content.detail}</p>
      <div className="utility-view__card">
        <strong>
          {view === 'export'
            ? 'ABC · MIDI · WAV'
            : view === 'recovery'
              ? currentSummary
              : settingsSummary}
        </strong>
        <small>
          {view === 'export'
            ? 'Export destinations are chosen with the native system dialog.'
            : view === 'recovery'
              ? 'Saved locally and available for safe restore.'
              : 'Music settings are read from the authoritative project model.'}
        </small>
      </div>
      <button type="button" className="secondary-action" onClick={onBack}>
        Return to Studio
      </button>
    </section>
  );
};

const DemoApp = () => {
  const [fixture, setFixture] =
    useState<FakeCoreFixtureName>(fixtureFromLocation);
  const [taskStartedFromBlank, setTaskStartedFromBlank] = useState(
    fixture === 'blank',
  );
  const [activeView, setActiveView] = useState<WorkspaceView>('studio');
  const [playing, setPlaying] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [mutedTrackIds, setMutedTrackIds] = useState<ReadonlySet<TrackId>>(
    () => new Set(),
  );
  const [soloTrackIds, setSoloTrackIds] = useState<ReadonlySet<TrackId>>(
    () => new Set(),
  );
  const [focusedTrackId, setFocusedTrackId] = useState<TrackId>('track.guitar');
  const [serviceSnapshot, setServiceSnapshot] =
    useState<ServiceFleetSnapshot | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const initializedStore = useRef<object | null>(null);
  const taskOrigin = useRef<FakeCoreFixtureName>('stable');
  const requestedScope = useRef<TaskScope | null>(null);
  const { state, store, error } = useWorkstationDemo(fixture);

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimer.current !== null) {
      window.clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
  }, []);

  useEffect(() => clearTransitionTimer, [clearTransitionTimer]);

  useEffect(() => {
    const bridge = window.agentMusic;
    if (bridge === undefined) return undefined;

    let active = true;
    void bridge
      .getServiceSnapshot()
      .then((snapshot) => {
        if (active) setServiceSnapshot(snapshot);
      })
      .catch(() => {
        if (active) setServiceSnapshot(unavailableServiceSnapshot());
      });
    const unsubscribe = bridge.onServiceSnapshot((snapshot) => {
      if (active) setServiceSnapshot(snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const restartDesktopService = useCallback(
    async (service: ServiceKind): Promise<CommandResult> => {
      const bridge = window.agentMusic;
      if (bridge === undefined) {
        return {
          ok: false,
          code: 'DESKTOP_BRIDGE_UNAVAILABLE',
          userMessage: 'Desktop service controls are unavailable.',
        };
      }
      return await bridge.restartService(service);
    },
    [],
  );

  useEffect(() => {
    if (store === null || initializedStore.current === store) return;
    initializedStore.current = store;
    store.dispatch({ type: 'ui/timelineZoomChanged', zoom: 4 });
    store.dispatch({ type: 'ui/timelineStartTickChanged', tick: 0 as Tick });
    const demoTotalTicks = store.getState().authoritative.timeline?.totalTicks;
    if (demoTotalTicks !== undefined) {
      store.dispatch({
        type: 'ui/playbackTickChanged',
        tick: asTick((demoTotalTicks * 7) / 64),
      });
    }
    if (fixture === 'candidate') {
      store.dispatch({
        type: 'ui/previewTargetChanged',
        target: 'candidate',
      });
    }

    const task = store.getState().authoritative.task;
    if (task.status !== 'idle') {
      const scope = requestedScope.current ?? task.scope;
      store.dispatch({
        type: 'ui/trackSelectionChanged',
        trackIds: scope.trackIds,
      });
      store.dispatch({
        type: 'ui/timeRangeChanged',
        range:
          scope.type === 'timeRange'
            ? {
                startTick: scope.startTick,
                endTick: scope.endTick,
              }
            : null,
      });
      return;
    }

    if (fixture === 'blank') {
      store.dispatch({
        type: 'ui/trackSelectionChanged',
        trackIds: TRACK_IDS,
      });
      store.dispatch({ type: 'ui/timeRangeChanged', range: null });
    } else {
      store.dispatch({
        type: 'ui/trackSelectionChanged',
        trackIds: TRACK_IDS,
      });
      store.dispatch({ type: 'ui/timeRangeChanged', range: null });
    }
  }, [fixture, store]);

  const authoritativeTimeline = state?.authoritative.timeline ?? null;
  const previewingCandidate = state?.ui.previewTarget === 'candidate';
  const previewTimeline =
    explicitFixtureMode && fixture === 'candidate' && previewingCandidate
      ? fakeCandidateTimeline
      : authoritativeTimeline;
  const timeline =
    previewTimeline !== null && taskStartedFromBlank && fixture === 'running'
      ? {
          ...previewTimeline,
          tracks: previewTimeline.tracks.map((track) => ({
            ...track,
            clips: [],
          })),
        }
      : previewTimeline;
  const totalTicks = timeline?.totalTicks ?? (0 as Tick);
  const bpm = timeline?.tempoMap[0]?.bpm ?? 92;
  const ticksPerQuarter = timeline?.ticksPerQuarter ?? 960;
  const authoritativeBlankCurrent =
    state?.authoritative.current.status === 'ready' &&
    state.authoritative.current.isEmpty;
  const visuallyBlankCurrent =
    authoritativeBlankCurrent || (taskStartedFromBlank && fixture !== 'stable');
  const candidateCanPlay =
    state?.ui.previewTarget === 'candidate' &&
    state.authoritative.candidate.status === 'ready';
  const canPlay = totalTicks > 0 && (!visuallyBlankCurrent || candidateCanPlay);

  useEffect(() => {
    if (!playing || store === null || totalTicks === 0) return undefined;
    const interval = window.setInterval(() => {
      const currentUi = store.getState().ui;
      const current = currentUi.playbackTick;
      const activeBpm = timeline === null ? bpm : bpmAtTick(timeline, current);
      const ticksPerStep = (ticksPerQuarter * activeBpm * 0.05) / 60;
      const next = current + ticksPerStep;
      const loopRange = currentUi.loopRange;
      let destination = next >= totalTicks ? 0 : next;
      if (loopRange !== null) {
        if (current < loopRange.startTick || current >= loopRange.endTick) {
          destination = loopRange.startTick;
        } else if (next >= loopRange.endTick) {
          const duration = loopRange.endTick - loopRange.startTick;
          destination =
            loopRange.startTick + ((next - loopRange.endTick) % duration);
        }
      }
      store.dispatch({
        type: 'ui/playbackTickChanged',
        tick: asTick(destination),
      });
    }, 50);
    return () => {
      window.clearInterval(interval);
    };
  }, [bpm, playing, store, ticksPerQuarter, timeline, totalTicks]);

  const togglePlayback = useCallback(() => {
    if (canPlay) setPlaying((current) => !current);
  }, [canPlay]);

  useEffect(() => {
    if (!canPlay) setPlaying(false);
  }, [canPlay]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    store?.dispatch({ type: 'ui/playbackTickChanged', tick: 0 as Tick });
  }, [store]);

  const clearSelection = useCallback(() => {
    setConfirmationOpen(false);
    store?.dispatch({ type: 'ui/timeRangeChanged', range: null });
    store?.dispatch({ type: 'ui/loopRangeChanged', range: null });
    store?.dispatch({ type: 'ui/trackSelectionChanged', trackIds: TRACK_IDS });
  }, [store]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (confirmationOpen) {
        if (event.code === 'Escape') setConfirmationOpen(false);
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.code === 'Escape') {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [clearSelection, confirmationOpen, togglePlayback]);

  const scheduleCandidate = useCallback(() => {
    clearTransitionTimer();
    transitionTimer.current = window.setTimeout(() => {
      setFixture('candidate');
      transitionTimer.current = null;
    }, 1_800);
  }, [clearTransitionTimer]);

  if (state === null || store === null)
    return <LoadingWorkspace error={error} />;

  const { authoritative, ui } = state;
  const project = authoritative.project;
  const projectName = projectNameOf(project);
  const projectId = project.status === 'open' ? project.projectId : null;
  const taskBusy =
    authoritative.task.status === 'active' &&
    authoritative.task.stage !== 'candidate_ready';
  const primaryError = selectWorkstationError(authoritative);
  const blankCurrent = visuallyBlankCurrent;
  const candidateReady = authoritative.candidate.status === 'ready';
  const keyEvent = timeline?.keyMap[0];
  const meterEvent = timeline?.meterMap[0];
  const keyName = keyEvent
    ? `${keyEvent.tonic} ${keyEvent.mode}`
    : 'Key unavailable';
  const meter = meterEvent
    ? `${String(meterEvent.numerator)}/${String(meterEvent.denominator)}`
    : '—';
  const currentLabel =
    authoritative.current.status === 'ready'
      ? `${authoritative.current.label}${authoritative.current.isEmpty ? ' · Blank' : ' · Saved'}`
      : authoritative.current.status === 'recoveryRequired'
        ? 'Recovery required'
        : 'Current unavailable';
  const currentSummary =
    authoritative.current.status === 'ready'
      ? `${authoritative.current.label} · ${authoritative.current.revision}`
      : currentLabel;
  const settingsSummary = `${String(bpm)} BPM · ${keyName} · ${meter}`;
  const durationSeconds =
    timeline === null ? 0 : secondsAtTick(timeline, timeline.totalTicks);
  const elapsedSeconds =
    timeline === null ? 0 : secondsAtTick(timeline, ui.playbackTick);
  const navigationStep =
    timeline === null ? (1 as Tick) : ticksForBars(timeline, 4);
  const statusTone: ProjectStatusTone =
    primaryError !== null
      ? 'warning'
      : taskBusy
        ? 'working'
        : blankCurrent
          ? 'blank'
          : 'stable';
  const statusLabel = primaryError
    ? currentSafetyMessage(primaryError.currentSafety).replace(/\.$/u, '')
    : taskBusy
      ? 'Current safe · Creating'
      : candidateReady
        ? 'Current safe · Candidate ready'
        : blankCurrent
          ? 'Blank Current · Saved'
          : 'Current · Stable';

  const movePlayback = (delta: number): void => {
    const next = Math.min(totalTicks, Math.max(0, ui.playbackTick + delta));
    store.dispatch({ type: 'ui/playbackTickChanged', tick: asTick(next) });
  };

  const toggleSetValue = (
    setter: React.Dispatch<React.SetStateAction<ReadonlySet<TrackId>>>,
    trackId: TrackId,
  ): void => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const selectedScope = (): TaskScope => {
    const trackIds = ui.selectedTrackIds;
    return ui.timeRange === null
      ? { type: 'wholeProject', trackIds }
      : {
          type: 'timeRange',
          trackIds,
          startTick: ui.timeRange.startTick,
          endTick: ui.timeRange.endTick,
        };
  };

  const beginTask = (): void => {
    if (projectId === null || ui.selectedTrackIds.length === 0) return;
    const scope = selectedScope();
    const command: RendererCommand = {
      type: 'startTask',
      requestId: requestId('start-task'),
      projectId,
      prompt: prompt.trim() || 'Develop the selected musical scope',
      scope,
      scopeRevision: 1,
    };
    void store.execute(command);
    taskOrigin.current = blankCurrent ? 'blank' : 'stable';
    requestedScope.current = scope;
    setTaskStartedFromBlank(blankCurrent);
    setConfirmationOpen(false);
    setFixture('running');
    scheduleCandidate();
  };

  const cancelTask = (): void => {
    clearTransitionTimer();
    if (projectId !== null && authoritative.task.status === 'active') {
      void store.execute({
        type: 'cancelTask',
        requestId: requestId('cancel-task'),
        projectId,
        taskId: authoritative.task.taskId,
      });
    }
    requestedScope.current = null;
    setTaskStartedFromBlank(taskOrigin.current === 'blank');
    setFixture(taskOrigin.current);
  };

  const retryTask = (): void => {
    setFixture('running');
    scheduleCandidate();
  };

  const reviewCandidate = (): void => {
    if (projectId !== null && authoritative.candidate.status === 'ready') {
      void store.execute({
        type: 'loadPreview',
        requestId: requestId('preview-candidate'),
        projectId,
        source: {
          kind: 'candidate',
          candidateId: authoritative.candidate.candidateId,
        },
      });
    }
    store.dispatch({
      type: 'ui/previewTargetChanged',
      target: 'candidate',
    });
    setPlaying(true);
  };

  const reviewCurrent = (): void => {
    if (projectId !== null && authoritative.current.status === 'ready') {
      void store.execute({
        type: 'loadPreview',
        requestId: requestId('preview-current'),
        projectId,
        source: { kind: 'current' },
      });
    }
    store.dispatch({
      type: 'ui/previewTargetChanged',
      target: 'current',
    });
    setPlaying(true);
  };

  const resolveCandidate = (resolution: 'accept' | 'reject'): void => {
    if (projectId === null || authoritative.candidate.status !== 'ready')
      return;
    const command: RendererCommand = {
      type: resolution === 'accept' ? 'acceptCandidate' : 'rejectCandidate',
      requestId: requestId(`${resolution}-candidate`),
      projectId,
      candidateId: authoritative.candidate.candidateId,
    };
    void store.execute(command);
    setPlaying(false);
    store.dispatch({ type: 'ui/previewTargetChanged', target: 'current' });
    requestedScope.current = null;
    if (resolution === 'accept') {
      setTaskStartedFromBlank(false);
      setFixture('stable');
    } else {
      setFixture(taskStartedFromBlank ? 'blank' : 'stable');
    }
  };

  return (
    <div
      className="workstation-shell"
      data-fixture={fixture}
      data-review-mode={candidateReady}
    >
      <a className="skip-link" href="#workspace-main">
        Skip to workspace
      </a>
      <ProjectSidebar
        activeView={activeView}
        projectName={projectName}
        currentLabel={currentLabel}
        isSettingsConfigured={true}
        onViewChange={setActiveView}
        onSwitchProject={() => {
          setActiveView('studio');
        }}
        onOpenSettings={() => {
          // Dummy for demo
        }}
      />

      <main className="workspace-main" id="workspace-main">
        <ProjectHeader
          projectName={projectName}
          statusLabel={statusLabel}
          statusTone={statusTone}
          onExport={() => {
            setActiveView('export');
          }}
          transport={{
            playing,
            playDisabled: !canPlay,
            elapsedLabel: blankCurrent ? '00:00' : formatTime(elapsedSeconds),
            durationLabel: blankCurrent ? '--:--' : formatTime(durationSeconds),
            tempo: bpm,
            meter,
            keyName,
            loopEnabled: ui.loopRange !== null,
            canLoop: ui.timeRange !== null,
            onTogglePlayback: togglePlayback,
            onStop: stopPlayback,
            onPrevious: () => {
              movePlayback(0 - navigationStep);
            },
            onNext: () => {
              movePlayback(navigationStep);
            },
            onToggleLoop: () => {
              const range = ui.loopRange === null ? ui.timeRange : null;
              store.dispatch({ type: 'ui/loopRangeChanged', range });
              if (
                range !== null &&
                (ui.playbackTick < range.startTick ||
                  ui.playbackTick >= range.endTick)
              ) {
                store.dispatch({
                  type: 'ui/playbackTickChanged',
                  tick: range.startTick,
                });
              }
            },
          }}
        />

        {(serviceSnapshot !== null || primaryError !== null) && (
          <div className="workspace-notices">
            {serviceSnapshot !== null && (
              <ServiceHealthNotice
                snapshot={serviceSnapshot}
                restart={restartDesktopService}
              />
            )}
            {primaryError !== null && (
              <StructuredErrorNotice error={primaryError} />
            )}
          </div>
        )}

        {activeView === 'studio' ? (
          <div className="workspace-content">
            {candidateReady && (
              <CandidateStage
                title={authoritative.candidate.summary}
                details={
                  explicitFixtureMode && fixture === 'candidate'
                    ? competitionCandidateDetails
                    : undefined
                }
                previewingCandidate={previewingCandidate}
                onReviewCurrent={() => {
                  reviewCurrent();
                }}
                onReviewCandidate={() => {
                  reviewCandidate();
                }}
                onAccept={() => {
                  resolveCandidate('accept');
                }}
                onReject={() => {
                  resolveCandidate('reject');
                }}
              />
            )}
            <ArrangementMap
              timeline={timeline}
              playbackTick={ui.playbackTick}
              focusedTrackId={focusedTrackId}
              mutedTrackIds={mutedTrackIds}
              soloTrackIds={soloTrackIds}
              reviewMode={candidateReady}
              onFocusTrack={setFocusedTrackId}
              onToggleMute={(trackId) => {
                toggleSetValue(setMutedTrackIds, trackId);
              }}
              onToggleSolo={(trackId) => {
                toggleSetValue(setSoloTrackIds, trackId);
              }}
            />
            {!candidateReady && (
              <ToneConsole
                trackId={focusedTrackId}
                muted={mutedTrackIds.has(focusedTrackId)}
                soloed={soloTrackIds.has(focusedTrackId)}
                onToggleMute={(trackId) => {
                  toggleSetValue(setMutedTrackIds, trackId);
                }}
                onToggleSolo={(trackId) => {
                  toggleSetValue(setSoloTrackIds, trackId);
                }}
              />
            )}
          </div>
        ) : (
          <UtilityView
            view={activeView}
            projectName={projectName}
            currentSummary={currentSummary}
            settingsSummary={settingsSummary}
            recoveryRequired={
              authoritative.current.status === 'recoveryRequired'
            }
            onBack={() => {
              setActiveView('studio');
            }}
          />
        )}
      </main>

      <CompetitionAgentPanel
        state={authoritative}
        prompt={prompt}
        onPromptChange={setPrompt}
        onReviewPlan={() => {
          setConfirmationOpen(true);
        }}
        onCancelTask={cancelTask}
        onRetryTask={retryTask}
      />

      <ConfirmationDialog
        open={confirmationOpen}
        blankCurrent={blankCurrent}
        confirmDisabled={ui.selectedTrackIds.length === 0}
        onCancel={() => {
          setConfirmationOpen(false);
        }}
        onConfirm={beginTask}
      />
    </div>
  );
};

const liveRequestId = (action: string): string =>
  `project-${action}-${crypto.randomUUID()}`;

const unavailableCandidateAudition = (): void => {
  // A Candidate playback bundle has not crossed the trusted Core boundary.
};

const displayName = (projectPath: string): string =>
  projectPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? projectPath;

/**
 * Normal desktop mode deliberately does not synthesize a B1 fixture. Project
 * identity and Current state below come only from the A1 Utility Process.
 */
const LiveProjectWorkspace = () => {
  const [project, setProject] = useState<OpenedProject | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>('studio');
  const [message, setMessage] = useState('Ready.');
  const [busy, setBusy] = useState(false);
  const latestRequest = useRef(0);
  const mounted = useRef(false);
  const playbackAdapter = useRef<SourceAwarePlaybackAdapter | null>(null);

  const [timeline, setTimeline] = useState<TimelineViewModel | null>(null);
  const [runtimeState, setRuntimeState] = useState<PlaybackRuntimeState | null>(null);
  const [focusedTrackId, setFocusedTrackId] = useState<TrackId>('track.guitar');
  const [candidateState, setCandidateState] = useState<LiveCandidateState | null>(null);
  const candidateAdapter = useRef<LiveCandidateAdapter | null>(null);
  const [generationPlanState, setGenerationPlanState] = useState<LiveGenerationPlanState | null>(null);
  const generationPlanAdapter = useRef<LiveGenerationPlanAdapter | null>(null);
  const [agentState, setAgentState] = useState<LiveAgentState | null>(null);
  const [agentPrompt, setAgentPrompt] = useState('');
  const agentAdapter = useRef<LiveAgentAdapter | null>(null);
  const exportAdapter = useRef<CurrentExportAdapter | null>(null);
  const exportAbortController = useRef<AbortController | null>(null);
  const [selectedExportPaths, setSelectedExportPaths] = useState<Partial<Record<ExportCurrentFormat, string>>>({});
  const [exportDeliveryStates, setExportDeliveryStates] = useState<Partial<Record<ExportCurrentFormat, 'preparing' | 'exporting' | 'completed' | 'failed' | 'cancelled'>>>({});

  const [pendingSwitch, setPendingSwitch] = useState<{
    purpose: 'create' | 'open';
    path: string;
  } | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [agentSettings, setAgentSettings] = useState<AgentSettings | undefined>(
    undefined
  );

  useEffect(() => {
    void window.agentMusic?.readSettings().then((settings) => {
      if (settings !== null) {
        setAgentSettings(settings);
      }
    });
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (project?.state !== 'ready') {
      void playbackAdapter.current?.dispose();
      playbackAdapter.current = null;
      setRuntimeState(null);
      setTimeline(null);
      return;
    }
    const bridge = window.agentMusic;
    if (bridge === undefined) {
      setMessage('The secure desktop bridge is unavailable.');
      return;
    }
    const adapter = createSourceAwarePlaybackAdapter({
      projectId: project.projectId,
      bridge,
      createRuntime: createSpessaSynthPlaybackRuntime,
    });
    playbackAdapter.current = adapter;
    const unsubscribe = adapter.subscribe((state) => {
      if (mounted.current) setRuntimeState(state);
    });
    void adapter.load({ kind: 'current', revision: project.currentRevision }).then((result) => {
      if (!mounted.current) return;
      if (result.status === 'failed') setMessage(result.failure.message);
      else setMessage('Current is loaded for playback.');
    });
    return () => {
      unsubscribe();
      void adapter.dispose();
      if (playbackAdapter.current === adapter) playbackAdapter.current = null;
    };
  }, [project?.state, project?.projectId, project?.currentRevision]);

  useEffect(() => {
    const bridge = window.agentMusic;
    const source = runtimeState?.activeSource;
    if (!bridge || !source || project?.state !== 'ready') {
      if (!source) setTimeline(null);
      return;
    }
    let active = true;
    void bridge.readPlaybackSnapshot(project.projectId, source).then((result) => {
      if (!active) return;
      if (result.ok) {
        const view = createCurrentPlaybackViewModel(
          result.snapshot.revision,
          result.snapshot.timeline,
          result.snapshot.compilation
        );
        if (view !== null) setTimeline(view);
        else {
          setTimeline(null);
          setMessage('Playback data did not pass the Renderer boundary.');
        }
      } else {
        setTimeline(null);
        setMessage(result.userMessage);
      }
    });
    return () => { active = false; };
  }, [
    runtimeState?.activeSource?.kind,
    runtimeState?.activeSource?.revision,
    project?.state,
    project?.projectId,
  ]);

  useEffect(() => {
    const bridge = window.agentMusic;
    const previous = candidateAdapter.current;
    candidateAdapter.current = null;
    previous?.dispose();
    setCandidateState(null);
    if (project?.state !== 'ready' || bridge === undefined) return undefined;

    const adapter = createLiveCandidateAdapter({
      projectId: project.projectId,
      bridge,
    });
    candidateAdapter.current = adapter;
    setCandidateState(adapter.getState());
    const unsubscribe = adapter.subscribe(setCandidateState);
    return () => {
      unsubscribe();
      adapter.dispose();
      if (candidateAdapter.current === adapter) candidateAdapter.current = null;
    };
  }, [project?.projectId, project?.state]);

  useEffect(() => {
    const bridge = window.agentMusic;
    const previous = generationPlanAdapter.current;
    generationPlanAdapter.current = null;
    previous?.dispose();
    setGenerationPlanState(null);
    if (project?.state !== 'ready' || bridge === undefined) return undefined;

    const adapter = createLiveGenerationPlanAdapter({
      projectId: project.projectId,
      bridge,
    });
    generationPlanAdapter.current = adapter;
    setGenerationPlanState(adapter.getState());
    const unsubscribe = adapter.subscribe(setGenerationPlanState);
    return () => {
      unsubscribe();
      adapter.dispose();
      if (generationPlanAdapter.current === adapter) generationPlanAdapter.current = null;
    };
  }, [project?.projectId, project?.state]);

  useEffect(() => {
    const bridge = window.agentMusic;
    const previous = agentAdapter.current;
    agentAdapter.current = null;
    previous?.dispose();
    setAgentState(null);
    if (project?.state !== 'ready' || bridge === undefined) return undefined;

    const adapter = createLiveAgentAdapter({
      projectId: project.projectId,
      bridge,
    });
    agentAdapter.current = adapter;
    setAgentState(adapter.getState());
    const unsubscribe = adapter.subscribe(setAgentState);
    void adapter.initialize();

    return () => {
      unsubscribe();
      adapter.dispose();
      if (agentAdapter.current === adapter) agentAdapter.current = null;
    };
  }, [project?.projectId, project?.state, project?.currentRevision]);

  useEffect(() => {
    exportAbortController.current?.abort();
    exportAbortController.current = null;
    exportAdapter.current = null;
    setExportDeliveryStates({});

    const bridge = window.agentMusic;
    if (project?.state !== 'ready' || bridge === undefined) return undefined;

    const adapter = createCurrentExportAdapter({
      projectId: project.projectId,
      preparation: bridge,
      files: bridge,
      wavRenderer: createAbcjsWavRenderer(),
    });
    exportAdapter.current = adapter;
    return () => {
      exportAbortController.current?.abort();
      exportAbortController.current = null;
      if (exportAdapter.current === adapter) exportAdapter.current = null;
    };
  }, [project?.projectId, project?.state]);

  const handleSendAgentMessage = useCallback(() => {
    if (agentPrompt.trim().length === 0) return;
    const adapter = agentAdapter.current;
    if (adapter === null) return;
    const taskContext =
      candidateState?.task !== null && candidateState?.task !== undefined
        ? {
            taskId: candidateState.task.taskId,
            candidateId: candidateState.task.candidateId,
          }
        : undefined;
    void adapter.sendMessage(agentPrompt, taskContext);
    setAgentPrompt('');
  }, [agentPrompt, candidateState?.task]);

  const handleCancelAgentExecution = useCallback(() => {
    void agentAdapter.current?.cancel();
  }, []);

  const handleCreateAgentSession = useCallback(() => {
    void agentAdapter.current?.createSession();
  }, []);

  const handleSelectAgentSession = useCallback((sessionId: AgentSessionId) => {
    void agentAdapter.current?.openSession(sessionId);
  }, []);

  const sendPlayback = useCallback(async (command: PlaybackCommand) => {
    const outcome = await playbackAdapter.current?.send(command);
    if (outcome === undefined) return;
    if (outcome.status === 'failed') setMessage(outcome.failure.message);
  }, []);

  const resolveCandidate = useCallback(
    async (resolution: 'accept' | 'reject') => {
      const adapter = candidateAdapter.current;
      if (adapter === null || candidateState?.status !== 'ready') return;
      setBusy(true);
      try {
        if (resolution === 'accept') await adapter.accept();
        else await adapter.reject();
        const committedRevision = adapter.getState().committedRevision;
        if (resolution === 'accept' && committedRevision !== null && project) {
          setProject((current) =>
            current === null
              ? current
              : { ...current, currentRevision: committedRevision },
          );
          setMessage('Candidate applied. Current is reloading for playback.');
        } else {
          setMessage('Candidate discarded. Current is unchanged.');
          if (project?.state === 'ready') {
            void playbackAdapter.current?.update({ kind: 'current', revision: project.currentRevision });
          }
        }
      } catch (error: unknown) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'Candidate action could not be completed.',
        );
      } finally {
        setBusy(false);
      }
    },
    [candidateState?.status, project],
  );

  const dispatch = useCallback(async (command: ProjectCommand) => {
    const bridge = window.agentMusic;
    if (bridge === undefined) {
      setMessage('The secure desktop bridge is unavailable.');
      return;
    }
    const operation = ++latestRequest.current;
    setBusy(true);
    const result = await bridge.dispatchProject(command);
    if (operation !== latestRequest.current) return;
    setBusy(false);
    if (!result.ok) {
      setMessage(result.userMessage);
      return;
    }
    const event: ProjectEvent = result.event;
    if (event.type === 'project.opened') {
      setProject(event.project);
      setMessage(
        event.project.state === 'recoveryRequired'
          ? 'Current needs recovery before it can be edited.'
          : 'Current is clean and ready.',
      );
    } else if (event.type === 'project.closed') {
      setProject(null);
      setMessage('Project closed.');
    } else {
      setMessage(event.message);
    }
  }, []);

  const chooseExportPath = useCallback(
    async (format: ExportCurrentFormat) => {
      const bridge = window.agentMusic;
      if (bridge === undefined || project?.state !== 'ready') {
        setMessage(
          'Open a clean Current before choosing an export destination.',
        );
        return;
      }
      const chosen = await bridge.chooseExportPath({
        format,
        suggestedName: exportCurrentSuggestedName(
          displayName(project.projectPath),
          format,
        ),
      });
      if (!chosen.ok) {
        setMessage(
          chosen.userMessage ?? 'The export destination could not be selected.',
        );
        return;
      }
      if (chosen.cancelled || chosen.path === undefined) return;
      setSelectedExportPaths((current) => ({
        ...current,
        [format]: chosen.path,
      }));
      setMessage(
        'Destination saved. Start the export when you are ready.',
      );
    },
    [project],
  );

  const startExport = useCallback(
    async (format: ExportCurrentFormat) => {
      if (format === 'abc') {
        setMessage('Canonical ABC is an internal format and cannot be exported.');
        return;
      }
      const path = selectedExportPaths[format];
      if (path === undefined) {
        setMessage('Choose an export destination first.');
        return;
      }
      const adapter = exportAdapter.current;
      if (adapter === null) {
        setExportDeliveryStates((current) => ({
          ...current,
          [format]: 'failed',
        }));
        setMessage('Current export is unavailable until the desktop bridge is ready.');
        return;
      }
      if (exportAbortController.current !== null) {
        setMessage('Another Current export is already in progress.');
        return;
      }

      const controller = new AbortController();
      exportAbortController.current = controller;
      setExportDeliveryStates((current) => ({
        ...current,
        [format]: 'preparing',
      }));
      const operation = adapter.exportCurrent(format, path, controller.signal);
      setExportDeliveryStates((current) => ({
        ...current,
        [format]: 'exporting',
      }));
      try {
        const outcome = await operation;
        if (!mounted.current) return;
        if (outcome.ok) {
          setExportDeliveryStates((current) => ({
            ...current,
            [format]: 'completed',
          }));
          setMessage(`${format.toUpperCase()} exported to ${outcome.path}.`);
        } else {
          setExportDeliveryStates((current) => ({
            ...current,
            [format]: outcome.code === 'EXPORT_CANCELLED' ? 'cancelled' : 'failed',
          }));
          setMessage(outcome.userMessage);
        }
      } finally {
        if (exportAbortController.current === controller) {
          exportAbortController.current = null;
        }
      }
    },
    [selectedExportPaths],
  );

  const selectAndDispatch = useCallback(
    async (purpose: 'create' | 'open' | 'saveAs') => {
      const bridge = window.agentMusic;
      if (bridge === undefined) {
        setMessage('The secure desktop bridge is unavailable.');
        return;
      }
      const chosen = await bridge.chooseProjectDirectory(purpose);
      if (!chosen.ok) {
        setMessage(
          chosen.userMessage ?? 'The project folder could not be selected.',
        );
        return;
      }
      if (chosen.cancelled || chosen.path === undefined) return;

      if ((purpose === 'open' || purpose === 'create') && project !== null) {
        setPendingSwitch({ purpose, path: chosen.path });
        return;
      }

      const requestId = liveRequestId(purpose);
      await dispatch(
        purpose === 'create'
          ? { type: 'project.create', requestId, projectPath: chosen.path }
          : purpose === 'open'
            ? { type: 'project.open', requestId, projectPath: chosen.path }
            : { type: 'project.saveAs', requestId, targetPath: chosen.path },
      );
    },
    [dispatch, project],
  );

  const projectName =
    project === null ? 'No project open' : displayName(project.projectPath);
  const currentLabel =
    project === null
      ? 'Choose a project folder to begin'
      : `Current · ${project.currentRevision.slice(0, 8)}`;
  const playback = runtimeState;
  const playable =
    timeline !== null && playback?.activeSource !== null;
  const mutedTrackIds = new Set(playback?.mutedTrackIds ?? []);
  const soloTrackIds = new Set(playback?.soloTrackIds ?? []);
  const bpm = timeline?.tempoMap[0]?.bpm ?? 0;
  const meterEvent = timeline?.meterMap[0];
  const keyEvent = timeline?.keyMap[0];
  const duration =
    timeline === null ? 0 : secondsAtTick(timeline, timeline.totalTicks);
  const elapsed =
    timeline === null || playback === null
      ? 0
      : secondsAtTick(timeline, playback.positionTick);
  const generationPlan = generationPlanState?.operation ?? null;
  const pendingGenerationPlan =
    generationPlan !== null && generationPlan.state === 'pending'
      ? generationPlan
      : null;

  return (
    <div
      className="workstation-shell live-project-workspace"
      aria-live="polite"
    >
      {pendingSwitch !== null && project !== null && (
        <ProjectSwitchConfirmation
          source={project.projectId}
          target={pendingSwitch.path}
          sourceName={projectName}
          targetName={displayName(pendingSwitch.path)}
          canSuspend={false}
          activeExecution={agentState?.isExecuting ?? false}
          activeTask={
            generationPlanState?.operation?.state === 'pending' ||
            (candidateState?.task !== null && candidateState?.task !== undefined)
          }
          onConfirm={() => {
            void (async () => {
              const requestId = liveRequestId(pendingSwitch.purpose);
              await dispatch(
                pendingSwitch.purpose === 'create'
                  ? { type: 'project.create', requestId, projectPath: pendingSwitch.path }
                  : { type: 'project.open', requestId, projectPath: pendingSwitch.path }
              );
              setActiveView('studio');
              setPendingSwitch(null);
            })();
          }}
          onCancel={() => {
            setPendingSwitch(null);
          }}
        />
      )}
      {isSettingsOpen && (
        <SettingsModal
          initialSettings={agentSettings}
          onSave={(settings) => {
            void (async () => {
              setBusy(true);
              try {
                if (window.agentMusic) {
                  const result = await window.agentMusic.writeSettings(settings);
                  if (result.ok) {
                    setAgentSettings(settings);
                    setIsSettingsOpen(false);
                  } else {
                    setMessage(
                      `Failed to save settings: ${result.userMessage ?? 'Unknown error'}`,
                    );
                  }
                } else {
                  // Fallback for browser mock
                  setAgentSettings(settings);
                  setIsSettingsOpen(false);
                }
              } finally {
                setBusy(false);
              }
            })();
          }}
          onClose={() => {
            setIsSettingsOpen(false);
          }}
        />
      )}
      <a className="skip-link" href="#workspace-main">
        Skip to workspace
      </a>
      <ProjectSidebar
        activeView={activeView}
        projectName={projectName}
        currentLabel={currentLabel}
        projectOpen={project !== null}
        busy={busy}
        isSettingsConfigured={
          agentSettings !== undefined && agentSettings.apiKey.trim() !== ''
        }
        onViewChange={setActiveView}
        onSwitchProject={() => {
          void selectAndDispatch('open');
        }}
        onOpenSettings={() => {
          setIsSettingsOpen(true);
        }}
        availableViews={project === null ? ['studio'] : ['studio', 'export']}
      />
      <main className="workspace-main" id="workspace-main">
        <ProjectHeader
          projectName={projectName}
          projectOpen={project !== null}
          statusLabel={
            project === null
              ? 'Project needed'
              : project.state === 'ready'
                ? 'Current · Clean'
                : 'Recovery required'
          }
          statusTone={
            project?.state === 'recoveryRequired'
              ? 'warning'
              : project === null
                ? 'blank'
                : 'stable'
          }
          onExport={() => {
            setActiveView('export');
          }}
          transport={{
            playing: playback?.transport === 'playing',
            playDisabled: !playable,
            elapsedLabel: playable ? formatTime(elapsed) : '--:--',
            durationLabel: playable ? formatTime(duration) : '--:--',
            tempo: bpm,
            meter: meterEvent
              ? `${String(meterEvent.numerator)}/${String(meterEvent.denominator)}`
              : '—',
            keyName: keyEvent
              ? `${keyEvent.tonic} ${keyEvent.mode}`
              : 'Unavailable',
            loopEnabled: playback?.loopRange !== null && playback !== null,
            canLoop: playable,
            onTogglePlayback: () =>
              void sendPlayback({
                type: playback?.transport === 'playing' ? 'pause' : 'play',
              }),
            onStop: () => void sendPlayback({ type: 'stop' }),
            onPrevious: () =>
              void sendPlayback({
                type: 'seek',
                tick: asTick(
                  Math.max(
                    0,
                    (playback?.positionTick ?? 0) -
                      (timeline === null ? 0 : ticksForBars(timeline, 4)),
                  ),
                ),
              }),
            onNext: () =>
              void sendPlayback({
                type: 'seek',
                tick: asTick(
                  Math.min(
                    timeline?.totalTicks ?? 0,
                    (playback?.positionTick ?? 0) +
                      (timeline === null ? 0 : ticksForBars(timeline, 4)),
                  ),
                ),
              }),
            onToggleLoop: () =>
              void sendPlayback({
                type: 'setLoop',
                range:
                  playback?.loopRange === null && timeline !== null
                    ? {
                        startTick: 0 as Tick,
                        endTick: timeline.totalTicks,
                      }
                    : null,
              }),
          }}
        />
        {activeView === 'export' ? (
          <ExportCurrentView
            projectName={projectName}
            currentRevision={project?.currentRevision ?? null}
            currentReady={project?.state === 'ready'}
            playbackInputReady={project?.state === 'ready'}
            selectedPaths={selectedExportPaths}
            exportStates={exportDeliveryStates}
            onChoosePath={(format) => {
              void chooseExportPath(format);
            }}
            onStartExport={(format) => {
              void startExport(format);
            }}
          />
        ) : (
          <div className="workspace-content">
            {project === null ? (
              <section
                className="project-empty-state"
                aria-labelledby="project-empty-title"
              >
                <div className="project-empty-state__signal" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="project-empty-state__copy">
                  <h1 id="project-empty-title">Start your next piece.</h1>
                  <p>
                    Create a project to arrange, shape, and review music in one
                    focused place.
                  </p>
                </div>
                <div className="project-empty-state__actions">
                  <button
                    type="button"
                    className="project-empty-state__primary"
                    disabled={busy}
                    onClick={() => void selectAndDispatch('create')}
                  >
                    Create Project
                  </button>
                  <button
                    type="button"
                    className="project-empty-state__secondary"
                    disabled={busy}
                    onClick={() => void selectAndDispatch('open')}
                  >
                    Open Project
                  </button>
                </div>
                <p className="project-empty-state__note">
                  Your Current stays local, isolated, and recoverable.
                </p>
                {message !== 'Ready.' && (
                  <p className="project-empty-state__message">{message}</p>
                )}
              </section>
            ) : (
              <>
                {pendingGenerationPlan !== null ? (
                  <GenerationPlanStage
                    operation={pendingGenerationPlan}
                    timeline={timeline}
                    busy={busy}
                    onApprove={() => {
                      void (async () => {
                        try {
                          setBusy(true);
                          await generationPlanAdapter.current?.approve();
                        } catch (error: unknown) {
                          setMessage(
                            error instanceof Error ? error.message : 'Failed to approve plan.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                    onReject={() => {
                      void (async () => {
                        try {
                          setBusy(true);
                          await generationPlanAdapter.current?.reject();
                        } catch (error: unknown) {
                          setMessage(
                            error instanceof Error ? error.message : 'Failed to reject plan.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  />
                ) : candidateState?.pendingScopeExtension ? (
                  <ScopeExtensionStage
                    pendingScopeExtension={candidateState.pendingScopeExtension}
                    timeline={timeline}
                    busy={busy}
                    onApprove={() => {
                      void (async () => {
                        try {
                          setBusy(true);
                          await candidateAdapter.current?.approveScopeExtension();
                        } catch (error: unknown) {
                          setMessage(
                            error instanceof Error ? error.message : 'Failed to approve scope extension.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                    onReject={() => {
                      void (async () => {
                        try {
                          setBusy(true);
                          await candidateAdapter.current?.rejectScopeExtension();
                        } catch (error: unknown) {
                          setMessage(
                            error instanceof Error ? error.message : 'Failed to reject scope extension.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  />
                ) : candidateState?.status === 'ready' ? (
                  <CandidateStage
                    title="Candidate ready to review"
                    details={undefined}
                    previewingCandidate={runtimeState?.activeSource?.kind === 'candidate'}
                    candidateAuditionAvailable={
                      !busy && candidateState.candidatePlaybackSnapshot !== null
                    }
                    candidateAcceptanceAvailable={!busy}
                    onReviewCurrent={() => {
                      void (async () => {
                        if (project.state === 'ready') {
                          const outcome = await playbackAdapter.current?.update({ kind: 'current', revision: project.currentRevision });
                          if (outcome?.status === 'failed') setMessage(outcome.failure.message);
                        }
                      })();
                    }}
                    onReviewCandidate={() => {
                      void (async () => {
                        const ref = candidateState.candidatePlaybackSnapshot;
                        if (ref === null) {
                          unavailableCandidateAudition();
                          return;
                        }
                        const outcome = await playbackAdapter.current?.update({
                          kind: 'candidate',
                          candidateId: ref.candidateId,
                          revision: ref.revision,
                        });
                        if (outcome?.status === 'failed') setMessage(outcome.failure.message);
                      })();
                    }}
                    onAccept={() => void resolveCandidate('accept')}
                    onReject={() => void resolveCandidate('reject')}
                  />
                ) : null}
                <section className="utility-view" aria-label="Project controls">
                  <h2>{projectName}</h2>
                  <p>{message}</p>
                  <div className="project-header__actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void selectAndDispatch('saveAs')}
                    >
                      Save As
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void dispatch({
                          type: 'project.recoverCurrent',
                          requestId: liveRequestId('recover'),
                        })
                      }
                    >
                      Recover Current
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void dispatch({
                          type: 'project.close',
                          requestId: liveRequestId('close'),
                        })
                      }
                    >
                      Close project
                    </button>
                  </div>
                </section>
                {timeline !== null && playback !== null ? (
                  <>
                    <ArrangementMap
                      timeline={timeline}
                      playbackTick={playback.positionTick}
                      focusedTrackId={focusedTrackId}
                      mutedTrackIds={mutedTrackIds}
                      soloTrackIds={soloTrackIds}
                      onFocusTrack={setFocusedTrackId}
                      onToggleMute={(trackId) =>
                        void sendPlayback({
                          type: 'setMute',
                          trackId,
                          muted: !mutedTrackIds.has(trackId),
                        })
                      }
                      onToggleSolo={(trackId) =>
                        void sendPlayback({
                          type: 'setSolo',
                          trackId,
                          solo: !soloTrackIds.has(trackId),
                        })
                      }
                    />
                    <ToneConsole
                      trackId={focusedTrackId}
                      muted={mutedTrackIds.has(focusedTrackId)}
                      soloed={soloTrackIds.has(focusedTrackId)}
                      onToggleMute={(trackId) =>
                        void sendPlayback({
                          type: 'setMute',
                          trackId,
                          muted: !mutedTrackIds.has(trackId),
                        })
                      }
                      onToggleSolo={(trackId) =>
                        void sendPlayback({
                          type: 'setSolo',
                          trackId,
                          solo: !soloTrackIds.has(trackId),
                        })
                      }
                    />
                  </>
                ) : (
                  <section
                    className="utility-view"
                    aria-label="Timeline empty state"
                  >
                    <p>
                      Open a clean Current to load its six-track playback
                      timeline.
                    </p>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </main>
      <LiveAgentPanel
        state={agentState}
        prompt={agentPrompt}
        projectOpen={project !== null && project.state === 'ready'}
        onPromptChange={setAgentPrompt}
        onSendMessage={handleSendAgentMessage}
        onCancel={handleCancelAgentExecution}
        onCreateSession={handleCreateAgentSession}
        onSelectSession={handleSelectAgentSession}
      />
    </div>
  );
};
export const App = () =>
  explicitFixtureMode ? <DemoApp /> : <LiveProjectWorkspace />;
