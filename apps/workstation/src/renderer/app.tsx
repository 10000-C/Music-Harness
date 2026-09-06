import {
  TRACK_IDS,
  type ProjectId,
  type RendererCommand,
  type ServiceKind,
  type TaskScope,
  type Tick,
  type TickRange,
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
import { CompetitionAgentPanel } from './workspace/agent/competition-agent-panel.js';
import { ConfirmationDialog } from './workspace/confirmation-dialog.js';
import { competitionCandidateDetails } from './workspace/competition-demo-view-model.js';
import {
  ProjectHeader,
  type ProjectStatusTone,
} from './workspace/project-header.js';
import {
  ProjectSidebar,
  type WorkspaceView,
} from './workspace/project-sidebar.js';
import { TrackInspector } from './workspace/track-inspector.js';
import { TrackSidebar } from './workspace/track-sidebar.js';
import { Timeline } from './workspace/timeline/timeline.js';
import {
  formatBarRange,
  ticksForBars,
} from './workspace/timeline/timeline-labels.js';
import { trackPresentation } from './workspace/timeline/track-palette.js';
import { TransportBar } from './workspace/transport-bar.js';
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

const scopeLabel = (
  selectedTrackIds: readonly TrackId[],
  range: TickRange | null,
  timeline: TimelineViewModel | null,
): string => {
  if (range === null) return 'Whole project';
  if (selectedTrackIds.length === 0) return 'No tracks selected';
  if (timeline === null) return 'Timeline unavailable';
  const bars = formatBarRange(range, timeline);
  if (selectedTrackIds.length === TRACK_IDS.length)
    return `All tracks · ${bars}`;
  const tracks = selectedTrackIds
    .map((trackId) => trackPresentation[trackId].label)
    .join(' + ');
  return `${tracks} · ${bars}`;
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
  const [inspectedTrackId, setInspectedTrackId] =
    useState<TrackId>('track.keys');
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
        trackIds: ['track.keys'],
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
  const selectionLabel = scopeLabel(
    ui.selectedTrackIds,
    ui.timeRange,
    timeline,
  );
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
    <div className="workstation-shell" data-fixture={fixture}>
      <TrackSidebar
        timeline={timeline}
        inspectedTrackId={inspectedTrackId}
        mutedTrackIds={mutedTrackIds}
        soloTrackIds={soloTrackIds}
        onInspectTrack={(trackId) => {
          setInspectedTrackId(trackId);
          if (authoritative.task.status === 'idle') {
            store.dispatch({
              type: 'ui/trackSelectionChanged',
              trackIds: [trackId],
            });
          }
        }}
        onToggleMute={(trackId) => {
          toggleSetValue(setMutedTrackIds, trackId);
        }}
        onToggleSolo={(trackId) => {
          toggleSetValue(setSoloTrackIds, trackId);
        }}
      />

      <main className="workspace-main">
        <ProjectHeader
          projectName={projectName}
          tempo={bpm}
          keyName={keyName}
          meter={meter}
          statusLabel={statusLabel}
          statusTone={statusTone}
          playing={playing}
          playDisabled={!canPlay}
          onTogglePlayback={togglePlayback}
          onExport={() => {
            setActiveView('export');
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
            <TransportBar
              playing={playing}
              elapsedLabel={blankCurrent ? '00:00' : formatTime(elapsedSeconds)}
              durationLabel={
                blankCurrent ? '--:--' : formatTime(durationSeconds)
              }
              scopeLabel={selectionLabel}
              loopEnabled={ui.loopRange !== null}
              canLoop={ui.timeRange !== null}
              disabled={!canPlay}
              onTogglePlayback={togglePlayback}
              onStop={stopPlayback}
              onPrevious={() => {
                movePlayback(0 - navigationStep);
              }}
              onNext={() => {
                movePlayback(navigationStep);
              }}
              onToggleLoop={() => {
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
              }}
            />
            {fixture === 'candidate' && previewingCandidate && (
              <div className="candidate-preview-badge">
                Previewing Candidate 01
              </div>
            )}
            <Timeline
              timeline={timeline}
              comparisonTimeline={
                explicitFixtureMode &&
                fixture === 'candidate' &&
                previewingCandidate
                  ? authoritativeTimeline
                  : null
              }
              candidateMode={previewingCandidate}
              playbackTick={ui.playbackTick}
              selectedTrackIds={[inspectedTrackId]}
              timeRange={ui.timeRange}
              loopRange={ui.loopRange}
              zoom={ui.timelineZoom}
              startTick={ui.timelineStartTick}
              mutedTrackIds={mutedTrackIds}
              soloTrackIds={soloTrackIds}
              onPlaybackTickChange={(tick) => {
                store.dispatch({ type: 'ui/playbackTickChanged', tick });
              }}
              onTrackSelectionChange={(trackIds) => {
                setInspectedTrackId(trackIds.at(-1) ?? inspectedTrackId);
                store.dispatch({
                  type: 'ui/trackSelectionChanged',
                  trackIds,
                });
              }}
              onTimeRangeChange={(range) => {
                store.dispatch({ type: 'ui/timeRangeChanged', range });
                if (ui.loopRange !== null) {
                  store.dispatch({ type: 'ui/loopRangeChanged', range });
                }
              }}
              onZoomChange={(zoom) => {
                store.dispatch({ type: 'ui/timelineZoomChanged', zoom });
              }}
              onStartTickChange={(tick) => {
                store.dispatch({
                  type: 'ui/timelineStartTickChanged',
                  tick,
                });
              }}
              onToggleMute={(trackId) => {
                toggleSetValue(setMutedTrackIds, trackId);
              }}
              onToggleSolo={(trackId) => {
                toggleSetValue(setSoloTrackIds, trackId);
              }}
            />
            <TrackInspector
              trackId={inspectedTrackId}
              candidateReady={
                explicitFixtureMode &&
                fixture === 'candidate' &&
                authoritative.candidate.status === 'ready' &&
                previewingCandidate
              }
              muted={mutedTrackIds.has(inspectedTrackId)}
              soloed={soloTrackIds.has(inspectedTrackId)}
              onToggleMute={(trackId) => {
                toggleSetValue(setMutedTrackIds, trackId);
              }}
              onToggleSolo={(trackId) => {
                toggleSetValue(setSoloTrackIds, trackId);
              }}
            />
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
        scope={selectedScope()}
        scopeLabel={selectionLabel}
        prompt={prompt}
        tab={ui.tab}
        onPromptChange={setPrompt}
        onTabChange={(tab) => {
          store.dispatch({ type: 'ui/tabChanged', tab });
        }}
        onReviewPlan={() => {
          setConfirmationOpen(true);
        }}
        onCancelTask={cancelTask}
        onRetryTask={retryTask}
        onReviewCandidate={reviewCandidate}
        previewingCandidate={ui.previewTarget === 'candidate'}
        candidateDetails={
          explicitFixtureMode && fixture === 'candidate'
            ? competitionCandidateDetails
            : undefined
        }
        onReviewCurrent={reviewCurrent}
        onSelectPianoScope={() => {
          setInspectedTrackId('track.keys');
          store.dispatch({
            type: 'ui/trackSelectionChanged',
            trackIds: ['track.keys'],
          });
          store.dispatch({ type: 'ui/timeRangeChanged', range: null });
        }}
        onSelectWholeScope={() => {
          store.dispatch({
            type: 'ui/trackSelectionChanged',
            trackIds: TRACK_IDS,
          });
          store.dispatch({ type: 'ui/timeRangeChanged', range: null });
        }}
        onAcceptCandidate={() => {
          resolveCandidate('accept');
        }}
        onRejectCandidate={() => {
          resolveCandidate('reject');
        }}
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

const displayName = (projectPath: string): string =>
  projectPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? projectPath;

/**
 * Normal desktop mode deliberately does not synthesize a B1 fixture. Project
 * identity and Current state below come only from the A1 Utility Process.
 */
const LiveProjectWorkspace = () => {
  const [project, setProject] = useState<OpenedProject | null>(null);
  const [message, setMessage] = useState(
    'Create a project or open an existing clean Current.',
  );
  const [busy, setBusy] = useState(false);
  const latestRequest = useRef(0);

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
      const requestId = liveRequestId(purpose);
      await dispatch(
        purpose === 'create'
          ? { type: 'project.create', requestId, projectPath: chosen.path }
          : purpose === 'open'
            ? { type: 'project.open', requestId, projectPath: chosen.path }
            : { type: 'project.saveAs', requestId, targetPath: chosen.path },
      );
    },
    [dispatch],
  );

  const projectName =
    project === null ? 'No project open' : displayName(project.projectPath);
  const currentLabel =
    project === null
      ? 'Choose a project folder to begin'
      : `Current · ${project.currentRevision.slice(0, 8)}`;
  const emptyTimeline =
    project === null
      ? 'Open or create a project to view its tracks.'
      : 'Track details will appear here when this project has playable music.';

  return (
    <div
      className="workstation-shell live-project-workspace"
      aria-live="polite"
    >
      <ProjectSidebar
        activeView="studio"
        projectName={projectName}
        currentLabel={currentLabel}
        onViewChange={() => undefined}
      />
      <TrackSidebar
        timeline={null}
        inspectedTrackId="track.keys"
        mutedTrackIds={new Set()}
        soloTrackIds={new Set()}
        onInspectTrack={() => undefined}
        onToggleMute={() => undefined}
        onToggleSolo={() => undefined}
      />
      <main className="workspace-main">
        <ProjectHeader
          projectName={projectName}
          tempo={0}
          keyName="Unavailable"
          meter="—"
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
          playing={false}
          playDisabled
          onTogglePlayback={() => undefined}
          onExport={() => undefined}
        />
        <div className="workspace-content">
          <TransportBar
            playing={false}
            elapsedLabel="--:--"
            durationLabel="--:--"
            scopeLabel="Timeline unavailable"
            loopEnabled={false}
            canLoop={false}
            disabled
            onTogglePlayback={() => undefined}
            onStop={() => undefined}
            onPrevious={() => undefined}
            onNext={() => undefined}
            onToggleLoop={() => undefined}
          />
          <section className="utility-view" aria-label="Project controls">
            <h2>{projectName}</h2>
            <p>{message}</p>
            <div className="project-header__actions">
              <button
                type="button"
                disabled={busy || project !== null}
                onClick={() => void selectAndDispatch('create')}
              >
                Create project
              </button>
              <button
                type="button"
                disabled={busy || project !== null}
                onClick={() => void selectAndDispatch('open')}
              >
                Open project
              </button>
              <button
                type="button"
                disabled={busy || project === null}
                onClick={() => void selectAndDispatch('saveAs')}
              >
                Save As
              </button>
              <button
                type="button"
                disabled={busy || project === null}
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
                disabled={busy || project === null}
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
          <section className="utility-view" aria-label="Timeline empty state">
            <p>{emptyTimeline}</p>
          </section>
        </div>
      </main>
      <aside className="agent-panel" aria-label="Agent panel">
        <div className="agent-panel__header">
          <h2>MUSE Agent</h2>
        </div>
        <p className="agent-empty-state">
          Open a project before starting an agent task.
        </p>
      </aside>
    </div>
  );
};

export const App = () =>
  explicitFixtureMode ? <DemoApp /> : <LiveProjectWorkspace />;
