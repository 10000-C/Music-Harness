import type { PlaybackCompilation } from '../b-contracts/index.js';
import type {
  PlaybackCommand,
  PlaybackRuntime,
  PlaybackRuntimeState,
  RuntimeOutcome,
} from './types.js';

export interface CurrentPlaybackSessionInput {
  readonly revision: string;
  readonly compilation: PlaybackCompilation;
}

export type CurrentPlaybackSessionOutcome =
  | Readonly<{ status: 'ready' }>
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'failed'; message: string }>;

/**
 * Owns one production playback runtime and its single Renderer subscription.
 * Replacement clears audio and listeners before a new Current can be loaded.
 */
export class CurrentPlaybackSession {
  #runtime: PlaybackRuntime | null = null;
  #unsubscribe: (() => void) | null = null;
  #generation = 0;

  constructor(
    private readonly createRuntime: () => PlaybackRuntime,
    private readonly onState: (state: PlaybackRuntimeState | null) => void,
  ) {}

  async load(
    input: CurrentPlaybackSessionInput,
  ): Promise<CurrentPlaybackSessionOutcome> {
    const generation = ++this.#generation;
    const previous = this.#runtime;
    if (previous === null) this.onState(null);
    else await this.#release(previous);
    if (generation !== this.#generation) return { status: 'stale' };

    let runtime: PlaybackRuntime;
    try {
      runtime = this.createRuntime();
    } catch {
      return { status: 'failed', message: 'Playback engine could not start.' };
    }
    this.#runtime = runtime;
    this.#unsubscribe = runtime.subscribe(() => {
      if (generation === this.#generation && this.#runtime === runtime)
        this.onState(runtime.getSnapshot());
    });

    const source = { kind: 'current' as const, revision: input.revision };
    try {
      const synchronized = await runtime.syncSource(source, input.compilation);
      if (generation !== this.#generation || this.#runtime !== runtime) {
        await this.#release(runtime);
        return { status: 'stale' };
      }
      if (synchronized.status === 'failed') {
        await this.#release(runtime);
        return { status: 'failed', message: synchronized.failure.message };
      }
      const activated = await runtime.activateSource(source);
      if (generation !== this.#generation || this.#runtime !== runtime) {
        await this.#release(runtime);
        return { status: 'stale' };
      }
      if (activated.status === 'failed') {
        await this.#release(runtime);
        return { status: 'failed', message: activated.failure.message };
      }
      this.onState(runtime.getSnapshot());
      return { status: 'ready' };
    } catch {
      await this.#release(runtime);
      return {
        status: 'failed',
        message: 'SoundFont or playback engine could not be loaded.',
      };
    }
  }

  async clear(): Promise<void> {
    ++this.#generation;
    const runtime = this.#runtime;
    if (runtime === null) {
      this.onState(null);
      return;
    }
    await this.#release(runtime);
  }

  async dispose(): Promise<void> {
    await this.clear();
  }

  async send(command: PlaybackCommand): Promise<RuntimeOutcome | null> {
    const runtime = this.#runtime;
    return runtime === null ? null : await runtime.send(command);
  }

  async #release(runtime: PlaybackRuntime): Promise<void> {
    if (this.#runtime !== runtime) return;
    this.#runtime = null;
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    unsubscribe?.();
    this.onState(null);
    await runtime.dispose();
  }
}
