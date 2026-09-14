import type { ProjectId } from '@agent-music/contracts';
import type {
  CorePlaybackSnapshot,
  PlaybackSnapshotSource,
} from '../../shared/playback-bridge.js';
import type { PlaybackSnapshotResult } from '../../shared/shell-contracts.js';
import type {
  PlaybackCommand,
  PlaybackRuntime,
  PlaybackRuntimeState,
  RuntimeOutcome,
  RuntimeSource,
} from './types.js';
import {
  SourceAwarePlaybackSession,
  type SourcePlaybackInput,
} from './source-aware-playback-session.js';

export interface SourceAwarePlaybackBridge {
  readPlaybackSnapshot(
    projectId: ProjectId,
    source: PlaybackSnapshotSource,
  ): Promise<PlaybackSnapshotResult>;
}

export interface SourceAwarePlaybackAdapterOptions {
  readonly projectId: ProjectId;
  readonly bridge: SourceAwarePlaybackBridge;
  readonly createRuntime: () => PlaybackRuntime;
}

export interface SourceAwarePlaybackAdapter {
  load(source: RuntimeSource): Promise<RuntimeOutcome>;
  update(source: RuntimeSource): Promise<RuntimeOutcome>;
  send(command: PlaybackCommand): Promise<RuntimeOutcome>;
  getSnapshot(): PlaybackRuntimeState | null;
  subscribe(listener: (state: PlaybackRuntimeState | null) => void): () => void;
  dispose(): Promise<void>;
}

const sameSlot = (left: RuntimeSource | null, right: RuntimeSource): boolean =>
  left?.kind === right.kind &&
  (right.kind === 'current' ||
    (left?.kind === 'candidate' && left.candidateId === right.candidateId));

const failedRead = (
  message: string,
  activeSourcePreserved: boolean,
): RuntimeOutcome => ({
  status: 'failed',
  failure: {
    code: 'snapshot-build-failed',
    message,
    activeSourcePreserved,
  },
});

const sourceMatches = (
  snapshot: CorePlaybackSnapshot,
  projectId: ProjectId,
  source: RuntimeSource,
): boolean =>
  snapshot.projectId === projectId &&
  snapshot.revision === source.revision &&
  snapshot.source.kind === source.kind &&
  snapshot.source.revision === source.revision &&
  (source.kind === 'current' ||
    (snapshot.source.kind === 'candidate' &&
      snapshot.source.candidateId === source.candidateId));

export const createSourceAwarePlaybackAdapter = ({
  projectId,
  bridge,
  createRuntime,
}: SourceAwarePlaybackAdapterOptions): SourceAwarePlaybackAdapter => {
  const listeners = new Set<(state: PlaybackRuntimeState | null) => void>();
  let disposed = false;
  let operation = 0;
  let state: PlaybackRuntimeState | null = null;
  const session = new SourceAwarePlaybackSession(createRuntime, (next) => {
    state = next;
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener(next);
    }
  });

  const read = async (
    source: RuntimeSource,
    requestOperation: number,
  ): Promise<SourcePlaybackInput | RuntimeOutcome> => {
    const result = await bridge.readPlaybackSnapshot(projectId, source);
    if (disposed || requestOperation !== operation) return { status: 'stale' };
    if (!result.ok)
      return failedRead(
        result.userMessage,
        state !== null && state.activeSource !== null,
      );
    if (!sourceMatches(result.snapshot, projectId, source)) {
      return failedRead(
        'Playback snapshot identity did not match the requested source.',
        state !== null && state.activeSource !== null,
      );
    }
    return {
      source,
      compilation: result.snapshot.compilation,
    };
  };

  const load = async (source: RuntimeSource): Promise<RuntimeOutcome> => {
    if (disposed) return { status: 'stale' };
    const requestOperation = ++operation;
    const input = await read(source, requestOperation);
    if (!('compilation' in input)) return input;
    return session.load(input);
  };

  const update = async (source: RuntimeSource): Promise<RuntimeOutcome> => {
    if (disposed) return { status: 'stale' };
    const requestOperation = ++operation;
    const input = await read(source, requestOperation);
    if (!('compilation' in input)) return input;
    const synchronized = await session.sync(input);
    if (
      synchronized.status !== 'applied' &&
      synchronized.status !== 'unchanged'
    )
      return synchronized;
    const activeSource = state?.activeSource;
    return sameSlot(activeSource ?? null, source)
      ? session.activate(source)
      : synchronized;
  };

  return {
    load,
    update,
    send: (command) => session.send(command),
    getSnapshot: () => state,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      ++operation;
      listeners.clear();
      await session.dispose();
    },
  };
};
