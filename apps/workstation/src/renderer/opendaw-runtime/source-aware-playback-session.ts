import type { PlaybackCompilation } from '../b-contracts/index.js';
import type {
  PlaybackCommand,
  PlaybackRuntime,
  PlaybackRuntimeState,
  RuntimeOutcome,
  RuntimeSource,
} from './types.js';

export interface SourcePlaybackInput {
  readonly source: RuntimeSource;
  readonly compilation: PlaybackCompilation;
}

export type SourcePlaybackStateListener = (
  state: PlaybackRuntimeState | null,
) => void;

/**
 * Owns one runtime for both Current and Candidate slots. Runtime activation
 * stops the existing engine, loads the selected snapshot, and restores the
 * transport preferences through the PlaybackRuntime interface.
 */
export class SourceAwarePlaybackSession {
  #runtime: PlaybackRuntime | null = null;
  #unsubscribe: (() => void) | null = null;
  #generation = 0;
  #disposed = false;

  public constructor(
    private readonly createRuntime: () => PlaybackRuntime,
    private readonly onState: SourcePlaybackStateListener = () => undefined,
  ) {}

  public async sync(input: SourcePlaybackInput): Promise<RuntimeOutcome> {
    if (this.#disposed) return this.disposedOutcome();
    const generation = ++this.#generation;
    let runtime: PlaybackRuntime;
    try {
      runtime = this.ensureRuntime();
    } catch {
      return this.failedOutcome(
        'snapshot-load-failed',
        'Playback engine could not start.',
        false,
      );
    }
    const outcome = await runtime.syncSource(input.source, input.compilation);
    if (generation !== this.#generation || this.#runtime !== runtime) {
      return { status: 'stale' };
    }
    this.onState(runtime.getSnapshot());
    return outcome;
  }

  public async activate(source: RuntimeSource): Promise<RuntimeOutcome> {
    if (this.#disposed) return this.disposedOutcome();
    if (this.#runtime === null) {
      return this.failedOutcome(
        'no-active-source',
        'Playback runtime has not been initialized.',
        false,
      );
    }
    const generation = ++this.#generation;
    const runtime = this.#runtime;
    const outcome = await runtime.activateSource(source);
    if (generation !== this.#generation || this.#runtime !== runtime) {
      return { status: 'stale' };
    }
    this.onState(runtime.getSnapshot());
    return outcome;
  }

  public async load(input: SourcePlaybackInput): Promise<RuntimeOutcome> {
    const synchronized = await this.sync(input);
    if (synchronized.status === 'failed' || synchronized.status === 'stale') {
      return synchronized;
    }
    return this.activate(input.source);
  }

  public send(command: PlaybackCommand): Promise<RuntimeOutcome> {
    if (this.#disposed) return Promise.resolve(this.disposedOutcome());
    if (this.#runtime === null)
      return Promise.resolve(
        this.failedOutcome(
          'no-active-source',
          'Playback runtime has not been initialized.',
          false,
        ),
      );
    return this.#runtime.send(command);
  }

  public getSnapshot(): PlaybackRuntimeState | null {
    return this.#runtime?.getSnapshot() ?? null;
  }

  public dispose(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#disposed = true;
    ++this.#generation;
    const runtime = this.#runtime;
    this.#runtime = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.onState(null);
    return runtime?.dispose() ?? Promise.resolve();
  }

  private ensureRuntime(): PlaybackRuntime {
    if (this.#runtime !== null) return this.#runtime;
    const runtime = this.createRuntime();
    this.#runtime = runtime;
    this.#unsubscribe = runtime.subscribe(() => {
      if (this.#runtime === runtime && !this.#disposed) {
        this.onState(runtime.getSnapshot());
      }
    });
    this.onState(runtime.getSnapshot());
    return runtime;
  }

  private disposedOutcome(): RuntimeOutcome {
    return this.failedOutcome(
      'disposed',
      'Playback session has been disposed.',
      false,
    );
  }

  private failedOutcome(
    code: 'disposed' | 'no-active-source' | 'snapshot-load-failed',
    message: string,
    activeSourcePreserved: boolean,
  ): RuntimeOutcome {
    return {
      status: 'failed',
      failure: { code, message, activeSourcePreserved },
    };
  }
}
