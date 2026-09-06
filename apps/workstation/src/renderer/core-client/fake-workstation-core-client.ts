import type {
  CoreBootstrapState,
  CoreEvent,
  PreviewSource,
  RendererCommand,
} from '../b-contracts/index.js';
import { readFakePlaybackBundle } from './fake-playback-fixtures.js';
import type {
  CoreEventListener,
  PlaybackBundle,
  WorkstationCoreClient,
} from './workstation-core-client.js';

/** Deterministic in-memory adapter used by Renderer development and tests. */
export class FakeWorkstationCoreClient implements WorkstationCoreClient {
  readonly #listeners = new Set<CoreEventListener>();
  readonly #receivedCommands: RendererCommand[] = [];
  #bootstrapState: CoreBootstrapState;

  public constructor(bootstrapState: CoreBootstrapState) {
    this.#bootstrapState = structuredClone(bootstrapState);
  }

  public getBootstrapState(): Promise<CoreBootstrapState> {
    return Promise.resolve(structuredClone(this.#bootstrapState));
  }

  public readPlayback(source: PreviewSource): Promise<PlaybackBundle | null> {
    return Promise.resolve(
      readFakePlaybackBundle(this.#bootstrapState, source),
    );
  }

  public dispatch(command: RendererCommand): Promise<void> {
    this.#receivedCommands.push(structuredClone(command));
    return Promise.resolve();
  }

  public subscribe(listener: CoreEventListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  public emit(event: CoreEvent): void {
    // Snapshot the delivery set so a listener added while an event is being
    // published starts with the next event. Re-check membership so disposing a
    // subscription from an earlier callback still prevents a later callback.
    for (const listener of [...this.#listeners]) {
      if (this.#listeners.has(listener)) {
        listener(structuredClone(event));
      }
    }
  }

  public replaceBootstrapState(state: CoreBootstrapState): void {
    this.#bootstrapState = structuredClone(state);
  }

  public getReceivedCommands(): readonly RendererCommand[] {
    return structuredClone(this.#receivedCommands);
  }
}
