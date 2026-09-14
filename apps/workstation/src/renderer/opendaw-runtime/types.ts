import type {
  CandidateId,
  PlaybackCompilation,
  Tick,
  TickRange,
  TrackId,
} from '../b-contracts/index.js';

export type RuntimeSource =
  | Readonly<{ kind: 'current'; revision: string }>
  | Readonly<{
      kind: 'candidate';
      candidateId: CandidateId;
      revision: string;
    }>;

export type PlaybackCommand =
  | Readonly<{ type: 'play' }>
  | Readonly<{ type: 'pause' }>
  | Readonly<{ type: 'stop' }>
  | Readonly<{ type: 'seek'; tick: Tick }>
  | Readonly<{ type: 'setLoop'; range: TickRange | null }>
  | Readonly<{ type: 'setMute'; trackId: TrackId; muted: boolean }>
  | Readonly<{ type: 'setSolo'; trackId: TrackId; solo: boolean }>;

export type PlaybackTransportState = 'stopped' | 'paused' | 'playing';

export type PlaybackRuntimeFailureCode =
  | 'disposed'
  | 'invalid-source'
  | 'invalid-compilation'
  | 'source-not-cached'
  | 'snapshot-build-failed'
  | 'snapshot-load-failed'
  | 'no-active-source'
  | 'invalid-command'
  | 'engine-command-failed';

export interface PlaybackRuntimeFailure {
  readonly code: PlaybackRuntimeFailureCode;
  readonly message: string;
  readonly activeSourcePreserved: boolean;
}

export type RuntimeOutcome =
  | Readonly<{ status: 'applied' }>
  | Readonly<{ status: 'unchanged' }>
  | Readonly<{ status: 'stale' }>
  | Readonly<{
      status: 'failed';
      failure: PlaybackRuntimeFailure;
    }>;

export interface PlaybackRuntimeState {
  readonly lifecycle: 'running' | 'disposed';
  readonly activeSource: RuntimeSource | null;
  readonly cachedSources: Readonly<{
    current: RuntimeSource | null;
    candidate: RuntimeSource | null;
  }>;
  readonly transport: PlaybackTransportState;
  readonly positionTick: Tick;
  readonly loopRange: TickRange | null;
  readonly mutedTrackIds: readonly TrackId[];
  readonly soloTrackIds: readonly TrackId[];
  readonly lastFailure: PlaybackRuntimeFailure | null;
}

export type PlaybackRuntimeListener = () => void;
export type Unsubscribe = () => void;

export interface PlaybackRuntime {
  syncSource(
    source: RuntimeSource,
    compilation: PlaybackCompilation,
  ): Promise<RuntimeOutcome>;
  activateSource(source: RuntimeSource): Promise<RuntimeOutcome>;
  send(command: PlaybackCommand): Promise<RuntimeOutcome>;
  getSnapshot(): PlaybackRuntimeState;
  subscribe(listener: PlaybackRuntimeListener): Unsubscribe;
  dispose(): Promise<void>;
}
