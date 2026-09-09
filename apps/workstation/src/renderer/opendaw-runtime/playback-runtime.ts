import {
  TRACK_IDS,
  isPlaybackCompilation,
  isTick,
  isTickRange,
  isTrackId,
  type PlaybackCompilation,
  type Tick,
  type TickRange,
  type TrackId,
} from '../b-contracts/index.js';

import type {
  PlaybackCommand,
  PlaybackRuntime,
  PlaybackRuntimeFailure,
  PlaybackRuntimeFailureCode,
  PlaybackRuntimeListener,
  PlaybackRuntimeState,
  RuntimeOutcome,
  RuntimeSource,
  Unsubscribe,
} from './types.js';

/** @internal Adapter seam; intentionally omitted from the public index barrel. */
export interface PlaybackRuntimeEnginePort<Snapshot> {
  buildSnapshot(
    compilation: PlaybackCompilation,
    signal: AbortSignal,
  ): Promise<Snapshot>;
  loadSnapshot(snapshot: Snapshot): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(tick: Tick): Promise<void>;
  setLoop(range: TickRange | null): Promise<void>;
  setMute(trackId: TrackId, muted: boolean): Promise<void>;
  setSolo(trackId: TrackId, solo: boolean): Promise<void>;
  observePosition(listener: (tick: Tick) => void): Unsubscribe;
  dispose(): Promise<void>;
}

interface CacheEntry<Snapshot> {
  readonly source: RuntimeSource;
  readonly snapshot: Snapshot;
  readonly totalTicks: Tick;
}

interface PendingBuild {
  readonly source: RuntimeSource;
  readonly generation: number;
  readonly controller: AbortController;
  readonly promise: Promise<RuntimeOutcome>;
}

interface SourceSlot<Snapshot> {
  generation: number;
  cache: CacheEntry<Snapshot> | null;
  pending: PendingBuild | null;
}

interface ListenerSubscription {
  readonly listener: PlaybackRuntimeListener;
}

type SlotKind = RuntimeSource['kind'];

const APPLIED = { status: 'applied' } as const;
const UNCHANGED = { status: 'unchanged' } as const;
const STALE = { status: 'stale' } as const;
const ZERO_TICK = 0 as Tick;

const throwIfAborted = (signal: AbortSignal): void => {
  if (!signal.aborted) return;
  const error = new Error('Playback snapshot build was aborted.');
  error.name = 'AbortError';
  throw error;
};

const copySource = (source: RuntimeSource): RuntimeSource | null => {
  if (source.kind === 'current') {
    return source.revision.trim().length === 0
      ? null
      : { kind: 'current', revision: source.revision };
  }

  return source.revision.trim().length === 0 || source.candidateId.length === 0
    ? null
    : {
        kind: 'candidate',
        candidateId: source.candidateId,
        revision: source.revision,
      };
};

const sameSource = (
  left: RuntimeSource | null,
  right: RuntimeSource,
): boolean =>
  left !== null &&
  left.kind === right.kind &&
  left.revision === right.revision &&
  (left.kind === 'current' ||
    (right.kind === 'candidate' && left.candidateId === right.candidateId));

const clampTick = (tick: Tick, totalTicks: Tick): Tick =>
  Math.min(tick, totalTicks) as Tick;

const clampLoop = (
  range: TickRange | null,
  totalTicks: Tick,
): TickRange | null => {
  if (range === null) return null;

  const startTick = Math.min(range.startTick, totalTicks) as Tick;
  const endTick = Math.min(range.endTick, totalTicks) as Tick;
  return startTick < endTick ? { startTick, endTick } : null;
};

const createFailure = (
  code: PlaybackRuntimeFailureCode,
  message: string,
  activeSourcePreserved: boolean,
): PlaybackRuntimeFailure => ({ code, message, activeSourcePreserved });

const failed = (failure: PlaybackRuntimeFailure): RuntimeOutcome => ({
  status: 'failed',
  failure,
});

const initialState = (): PlaybackRuntimeState => ({
  lifecycle: 'running',
  activeSource: null,
  cachedSources: { current: null, candidate: null },
  transport: 'stopped',
  positionTick: ZERO_TICK,
  loopRange: null,
  mutedTrackIds: [],
  soloTrackIds: [],
  lastFailure: null,
});

const isPlaybackCommand = (command: PlaybackCommand): boolean => {
  switch (command.type) {
    case 'play':
    case 'pause':
    case 'stop':
      return true;
    case 'seek':
      return isTick(command.tick);
    case 'setLoop':
      return command.range === null || isTickRange(command.range);
    case 'setMute':
      return isTrackId(command.trackId) && typeof command.muted === 'boolean';
    case 'setSolo':
      return isTrackId(command.trackId) && typeof command.solo === 'boolean';
  }
};

class PlaybackRuntimeCoordinator<Snapshot> implements PlaybackRuntime {
  readonly #engine: PlaybackRuntimeEnginePort<Snapshot>;
  readonly #listeners = new Set<ListenerSubscription>();
  readonly #buildTasks = new Set<Promise<RuntimeOutcome>>();
  readonly #slots: Record<SlotKind, SourceSlot<Snapshot>> = {
    current: { generation: 0, cache: null, pending: null },
    candidate: { generation: 0, cache: null, pending: null },
  };
  #state = initialState();
  #activeEntry: CacheEntry<Snapshot> | null = null;
  #commandTail: Promise<void> = Promise.resolve();
  #disposing = false;
  #disposePromise: Promise<void> | null = null;
  #positionUnsubscribe: Unsubscribe;
  #suppressPosition = false;

  constructor(engine: PlaybackRuntimeEnginePort<Snapshot>) {
    this.#engine = engine;
    this.#positionUnsubscribe = engine.observePosition((tick) => {
      if (
        this.#disposing ||
        this.#suppressPosition ||
        this.#activeEntry === null ||
        !isTick(tick)
      ) {
        return;
      }

      const positionTick = clampTick(tick, this.#activeEntry.totalTicks);
      if (this.#state.transport === 'stopped') return;
      if (
        positionTick === this.#activeEntry.totalTicks &&
        this.#state.loopRange === null &&
        this.#state.transport === 'playing'
      ) {
        this.#publish({
          ...this.#state,
          transport: 'stopped',
          positionTick,
        });
        void this.#enqueue(async () => {
          try {
            await this.#engine.pause();
            return APPLIED;
          } catch {
            return this.#recordFailure(
              'engine-command-failed',
              'The playback engine could not pause at the end of Current.',
            );
          }
        });
        return;
      }
      if (positionTick !== this.#state.positionTick) {
        this.#publish({ ...this.#state, positionTick });
      }
    });
  }

  syncSource(
    untrustedSource: RuntimeSource,
    compilation: PlaybackCompilation,
  ): Promise<RuntimeOutcome> {
    if (this.#disposing) return Promise.resolve(this.#disposedOutcome());

    const source = copySource(untrustedSource);
    if (source === null) {
      return Promise.resolve(
        this.#recordFailure(
          'invalid-source',
          'Playback source identity and revision must be non-empty.',
        ),
      );
    }

    if (!isPlaybackCompilation(compilation)) {
      return Promise.resolve(
        this.#recordFailure(
          'invalid-compilation',
          'Playback compilation failed runtime validation.',
        ),
      );
    }

    const slot = this.#slots[source.kind];
    if (slot.pending !== null && sameSource(slot.pending.source, source)) {
      return slot.pending.promise;
    }

    if (slot.cache !== null && sameSource(slot.cache.source, source)) {
      if (slot.pending !== null) {
        slot.pending.controller.abort();
        slot.generation += 1;
        slot.pending = null;
      }
      return Promise.resolve(UNCHANGED);
    }

    slot.pending?.controller.abort();
    const generation = slot.generation + 1;
    slot.generation = generation;
    const controller = new AbortController();
    const promise = this.#buildSource(
      source,
      compilation,
      generation,
      controller.signal,
    );
    slot.pending = { source, generation, controller, promise };
    this.#buildTasks.add(promise);
    void promise.then(
      () => this.#buildTasks.delete(promise),
      () => this.#buildTasks.delete(promise),
    );
    return promise;
  }

  activateSource(untrustedSource: RuntimeSource): Promise<RuntimeOutcome> {
    const source = copySource(untrustedSource);
    if (source === null) {
      return Promise.resolve(
        this.#recordFailure(
          'invalid-source',
          'Playback source identity and revision must be non-empty.',
        ),
      );
    }

    return this.#enqueue(() => this.#activate(source));
  }

  send(command: PlaybackCommand): Promise<RuntimeOutcome> {
    if (!isPlaybackCommand(command)) {
      return Promise.resolve(
        this.#recordFailure(
          'invalid-command',
          'Playback command failed runtime validation.',
        ),
      );
    }

    return this.#enqueue(() => this.#send(command));
  }

  getSnapshot(): PlaybackRuntimeState {
    return this.#state;
  }

  subscribe(listener: PlaybackRuntimeListener): Unsubscribe {
    if (this.#state.lifecycle === 'disposed') return () => undefined;

    const subscription: ListenerSubscription = { listener };
    this.#listeners.add(subscription);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(subscription);
    };
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise;

    this.#disposing = true;
    for (const slot of Object.values(this.#slots)) {
      slot.generation += 1;
      slot.pending?.controller.abort();
      slot.pending = null;
    }

    const buildTasks = [...this.#buildTasks];
    const disposePromise = Promise.all([
      this.#commandTail,
      Promise.allSettled(buildTasks),
    ])
      .then(async () => {
        try {
          this.#positionUnsubscribe();
        } finally {
          this.#positionUnsubscribe = () => undefined;
          await this.#engine.dispose();
        }
      })
      .finally(() => {
        this.#activeEntry = null;
        this.#slots.current.cache = null;
        this.#slots.candidate.cache = null;
        this.#publish({
          ...initialState(),
          lifecycle: 'disposed',
        });
        this.#listeners.clear();
      });
    this.#disposePromise = disposePromise;
    return disposePromise;
  }

  async #buildSource(
    source: RuntimeSource,
    compilation: PlaybackCompilation,
    generation: number,
    signal: AbortSignal,
  ): Promise<RuntimeOutcome> {
    const slot = this.#slots[source.kind];
    try {
      const snapshot = await this.#engine.buildSnapshot(compilation, signal);
      if (this.#disposing) return this.#disposedOutcome();
      if (signal.aborted || slot.generation !== generation) return STALE;

      slot.cache = {
        source,
        snapshot,
        totalTicks: compilation.totalTicks,
      };
      this.#publish({
        ...this.#state,
        cachedSources: {
          ...this.#state.cachedSources,
          [source.kind]: source,
        },
        lastFailure: null,
      });
      return APPLIED;
    } catch {
      if (this.#disposing) return this.#disposedOutcome();
      if (signal.aborted || slot.generation !== generation) return STALE;

      return this.#recordFailure(
        'snapshot-build-failed',
        'The playback snapshot could not be built.',
      );
    } finally {
      if (slot.pending?.generation === generation) {
        slot.pending = null;
      }
    }
  }

  #enqueue(operation: () => Promise<RuntimeOutcome>): Promise<RuntimeOutcome> {
    if (this.#disposing) return Promise.resolve(this.#disposedOutcome());

    const result = this.#commandTail.then(() =>
      this.#disposing ? this.#disposedOutcome() : operation(),
    );
    this.#commandTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #activate(source: RuntimeSource): Promise<RuntimeOutcome> {
    const target = this.#slots[source.kind].cache;
    if (target === null || !sameSource(target.source, source)) {
      return this.#recordFailure(
        'source-not-cached',
        'The requested playback source has not been synchronized.',
      );
    }

    if (sameSource(this.#state.activeSource, source)) return UNCHANGED;

    const previousEntry = this.#activeEntry;
    const previousState = this.#state;
    const positionTick = clampTick(
      previousState.positionTick,
      target.totalTicks,
    );
    const loopRange = clampLoop(previousState.loopRange, target.totalTicks);

    this.#suppressPosition = true;
    try {
      await this.#loadAndRestore(
        target,
        positionTick,
        loopRange,
        previousState.mutedTrackIds,
        previousState.soloTrackIds,
      );
      this.#activeEntry = target;
      this.#publish({
        ...this.#state,
        activeSource: source,
        transport: 'paused',
        positionTick,
        loopRange,
        lastFailure: null,
      });
      return APPLIED;
    } catch {
      const preserved = await this.#rollback(previousEntry, previousState);
      const failure = createFailure(
        'snapshot-load-failed',
        'The playback source could not be activated.',
        preserved,
      );
      this.#publish({ ...this.#state, lastFailure: failure });
      return failed(failure);
    } finally {
      this.#suppressPosition = false;
    }
  }

  async #loadAndRestore(
    entry: CacheEntry<Snapshot>,
    positionTick: Tick,
    loopRange: TickRange | null,
    mutedTrackIds: readonly TrackId[],
    soloTrackIds: readonly TrackId[],
  ): Promise<void> {
    await this.#engine.stop();
    await this.#engine.loadSnapshot(entry.snapshot);
    await this.#engine.seek(positionTick);
    await this.#engine.setLoop(loopRange);
    for (const trackId of TRACK_IDS) {
      await this.#engine.setMute(trackId, mutedTrackIds.includes(trackId));
    }
    for (const trackId of TRACK_IDS) {
      await this.#engine.setSolo(trackId, soloTrackIds.includes(trackId));
    }
  }

  async #rollback(
    previousEntry: CacheEntry<Snapshot> | null,
    previousState: PlaybackRuntimeState,
  ): Promise<boolean> {
    if (previousEntry === null) {
      this.#activeEntry = null;
      try {
        await this.#engine.stop();
      } catch {
        // There is no earlier runtime to recover.
      }
      this.#publish({
        ...this.#state,
        activeSource: null,
        transport: 'stopped',
        positionTick: ZERO_TICK,
      });
      return false;
    }

    try {
      const positionTick = clampTick(
        previousState.positionTick,
        previousEntry.totalTicks,
      );
      const loopRange = clampLoop(
        previousState.loopRange,
        previousEntry.totalTicks,
      );
      await this.#loadAndRestore(
        previousEntry,
        positionTick,
        loopRange,
        previousState.mutedTrackIds,
        previousState.soloTrackIds,
      );
      this.#activeEntry = previousEntry;
      this.#publish({
        ...this.#state,
        activeSource: previousState.activeSource,
        transport: 'paused',
        positionTick,
        loopRange,
      });
      return true;
    } catch {
      this.#activeEntry = null;
      this.#publish({
        ...this.#state,
        activeSource: null,
        transport: 'stopped',
        positionTick: ZERO_TICK,
      });
      return false;
    }
  }

  async #send(command: PlaybackCommand): Promise<RuntimeOutcome> {
    try {
      switch (command.type) {
        case 'play':
          return await this.#withActive(async () => {
            if (this.#state.transport === 'playing') return UNCHANGED;
            await this.#engine.play();
            this.#publish({
              ...this.#state,
              transport: 'playing',
              lastFailure: null,
            });
            return APPLIED;
          });
        case 'pause':
          return await this.#withActive(async () => {
            if (this.#state.transport === 'paused') return UNCHANGED;
            await this.#engine.pause();
            this.#publish({
              ...this.#state,
              transport: 'paused',
              lastFailure: null,
            });
            return APPLIED;
          });
        case 'stop':
          return await this.#withActive(async () => {
            if (
              this.#state.transport === 'stopped' &&
              this.#state.positionTick === ZERO_TICK
            ) {
              return UNCHANGED;
            }
            await this.#engine.stop();
            this.#publish({
              ...this.#state,
              transport: 'stopped',
              positionTick: ZERO_TICK,
              lastFailure: null,
            });
            return APPLIED;
          });
        case 'seek':
          return await this.#withActive(async (entry) => {
            const positionTick = clampTick(command.tick, entry.totalTicks);
            if (positionTick === this.#state.positionTick) return UNCHANGED;
            await this.#engine.seek(positionTick);
            this.#publish({
              ...this.#state,
              positionTick,
              lastFailure: null,
            });
            return APPLIED;
          });
        case 'setLoop': {
          const loopRange =
            this.#activeEntry === null
              ? command.range
              : clampLoop(command.range, this.#activeEntry.totalTicks);
          if (
            JSON.stringify(loopRange) === JSON.stringify(this.#state.loopRange)
          ) {
            return UNCHANGED;
          }
          if (this.#activeEntry !== null) {
            await this.#engine.setLoop(loopRange);
          }
          this.#publish({ ...this.#state, loopRange, lastFailure: null });
          return APPLIED;
        }
        case 'setMute':
          return await this.#setMix('mute', command.trackId, command.muted);
        case 'setSolo':
          return await this.#setMix('solo', command.trackId, command.solo);
      }
    } catch {
      return this.#recordFailure(
        'engine-command-failed',
        'The playback engine could not apply the command.',
      );
    }
  }

  async #withActive(
    operation: (entry: CacheEntry<Snapshot>) => Promise<RuntimeOutcome>,
  ): Promise<RuntimeOutcome> {
    if (this.#activeEntry === null) {
      return this.#recordFailure(
        'no-active-source',
        'Activate a synchronized playback source before using Transport.',
      );
    }
    return operation(this.#activeEntry);
  }

  async #setMix(
    kind: 'mute' | 'solo',
    trackId: TrackId,
    enabled: boolean,
  ): Promise<RuntimeOutcome> {
    const key = kind === 'mute' ? 'mutedTrackIds' : 'soloTrackIds';
    const current = this.#state[key];
    if (current.includes(trackId) === enabled) return UNCHANGED;

    if (this.#activeEntry !== null) {
      if (kind === 'mute') await this.#engine.setMute(trackId, enabled);
      else await this.#engine.setSolo(trackId, enabled);
    }

    const next = TRACK_IDS.filter((candidate) =>
      candidate === trackId ? enabled : current.includes(candidate),
    );
    this.#publish({ ...this.#state, [key]: next, lastFailure: null });
    return APPLIED;
  }

  #recordFailure(
    code: PlaybackRuntimeFailureCode,
    message: string,
  ): RuntimeOutcome {
    const failure = createFailure(code, message, this.#activeEntry !== null);
    if (!this.#disposing) {
      this.#publish({ ...this.#state, lastFailure: failure });
    }
    return failed(failure);
  }

  #disposedOutcome(): RuntimeOutcome {
    return failed(
      createFailure(
        'disposed',
        'The playback runtime has been disposed.',
        false,
      ),
    );
  }

  #publish(state: PlaybackRuntimeState): void {
    this.#state = state;
    for (const subscription of [...this.#listeners]) {
      if (!this.#listeners.has(subscription)) continue;
      try {
        subscription.listener();
      } catch {
        continue;
      }
    }
  }
}

export interface InMemoryPlaybackRuntimeOptions {
  readonly beforeBuild?: (
    compilation: PlaybackCompilation,
    signal: AbortSignal,
  ) => void | Promise<void>;
  readonly beforeLoad?: (
    compilation: PlaybackCompilation,
  ) => void | Promise<void>;
  readonly failLoadAfterApply?: (compilation: PlaybackCompilation) => boolean;
  readonly beforePlay?: () => void | Promise<void>;
  readonly beforeDispose?: () => void | Promise<void>;
  readonly onObservePosition?: (emit: (tick: Tick) => void) => void;
}

interface InMemoryEngineSnapshot {
  readonly internalId: number;
  readonly compilation: PlaybackCompilation;
}

class InMemoryEngine implements PlaybackRuntimeEnginePort<InMemoryEngineSnapshot> {
  readonly #options: InMemoryPlaybackRuntimeOptions;
  #nextId = 1;
  #loaded: InMemoryEngineSnapshot | null = null;
  #mayLoad = false;
  #positionRestored = false;
  #loopRestored = false;
  readonly #muteRestored = new Set<TrackId>();
  readonly #soloRestored = new Set<TrackId>();
  readonly #positionListeners = new Set<(tick: Tick) => void>();
  readonly #mutedTrackIds = new Set<TrackId>();
  readonly #soloTrackIds = new Set<TrackId>();
  #disposed = false;

  constructor(options: InMemoryPlaybackRuntimeOptions) {
    this.#options = options;
  }

  async buildSnapshot(
    compilation: PlaybackCompilation,
    signal: AbortSignal,
  ): Promise<InMemoryEngineSnapshot> {
    this.#assertRunning();
    throwIfAborted(signal);
    await this.#options.beforeBuild?.(compilation, signal);
    throwIfAborted(signal);
    this.#assertRunning();
    return { internalId: this.#nextId++, compilation };
  }

  async loadSnapshot(snapshot: InMemoryEngineSnapshot): Promise<void> {
    this.#assertRunning();
    if (!this.#mayLoad) throw new Error('Engine load must follow stop.');
    await this.#options.beforeLoad?.(snapshot.compilation);
    this.#loaded = snapshot;
    this.#mayLoad = false;
    this.#positionRestored = false;
    this.#loopRestored = false;
    this.#muteRestored.clear();
    this.#soloRestored.clear();
    if (this.#options.failLoadAfterApply?.(snapshot.compilation) === true) {
      throw new Error('Injected partial load failure.');
    }
  }

  async play(): Promise<void> {
    this.#assertConfigured();
    await this.#options.beforePlay?.();
  }

  pause(): Promise<void> {
    this.#assertConfigured();
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.#assertRunning();
    this.#mayLoad = true;
    return Promise.resolve();
  }

  seek(tick: Tick): Promise<void> {
    this.#assertLoaded();
    if (!isTick(tick)) throw new Error('Position must be a valid Tick.');
    this.#positionRestored = true;
    return Promise.resolve();
  }

  setLoop(range: TickRange | null): Promise<void> {
    this.#assertLoaded();
    if (!this.#positionRestored) {
      throw new Error('Loop restore must follow position restore.');
    }
    if (range !== null && !isTickRange(range)) {
      throw new Error('Loop must be a valid Tick range.');
    }
    this.#loopRestored = true;
    return Promise.resolve();
  }

  setMute(trackId: TrackId, muted: boolean): Promise<void> {
    this.#assertLoaded();
    if (!this.#loopRestored) throw new Error('Mute restore must follow loop.');
    if (muted) this.#mutedTrackIds.add(trackId);
    else this.#mutedTrackIds.delete(trackId);
    this.#muteRestored.add(trackId);
    return Promise.resolve();
  }

  setSolo(trackId: TrackId, solo: boolean): Promise<void> {
    this.#assertLoaded();
    if (this.#muteRestored.size !== TRACK_IDS.length) {
      throw new Error('Solo restore must follow all mute state.');
    }
    if (solo) this.#soloTrackIds.add(trackId);
    else this.#soloTrackIds.delete(trackId);
    this.#soloRestored.add(trackId);
    return Promise.resolve();
  }

  observePosition(listener: (tick: Tick) => void): Unsubscribe {
    this.#positionListeners.add(listener);
    this.#options.onObservePosition?.((tick) => {
      for (const callback of [...this.#positionListeners]) callback(tick);
    });
    return () => {
      this.#positionListeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    try {
      await this.#options.beforeDispose?.();
    } finally {
      this.#disposed = true;
      this.#loaded = null;
      this.#positionListeners.clear();
      this.#mutedTrackIds.clear();
      this.#soloTrackIds.clear();
    }
  }

  #assertRunning(): void {
    if (this.#disposed) throw new Error('Engine is disposed.');
  }

  #assertLoaded(): void {
    this.#assertRunning();
    if (this.#loaded === null) throw new Error('No snapshot is loaded.');
  }

  #assertConfigured(): void {
    this.#assertLoaded();
    if (
      !this.#positionRestored ||
      !this.#loopRestored ||
      this.#muteRestored.size !== TRACK_IDS.length ||
      this.#soloRestored.size !== TRACK_IDS.length
    ) {
      throw new Error('Snapshot state has not been completely restored.');
    }
  }
}

/** @internal Coordinator injection seam; intentionally omitted from index.ts. */
export const createPlaybackRuntime = <Snapshot>(
  engine: PlaybackRuntimeEnginePort<Snapshot>,
): PlaybackRuntime => new PlaybackRuntimeCoordinator(engine);

/** @internal Test adapter; production creation is added with the openDAW adapter. */
export const createInMemoryPlaybackRuntime = (
  options: InMemoryPlaybackRuntimeOptions = {},
): PlaybackRuntime => createPlaybackRuntime(new InMemoryEngine(options));
