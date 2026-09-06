import type {
  CoreBootstrapState,
  CoreEvent,
  PlaybackCompilation,
  PreviewSource,
  RendererCommand,
} from '../b-contracts/index.js';

export type CoreEventListener = (event: CoreEvent) => void;

/**
 * Revision-bearing playback input read independently from the lightweight UI
 * timeline. The source identity and revision let the Runtime reject an async
 * build that completed after its authoritative input changed.
 */
export interface PlaybackBundle {
  readonly source: PreviewSource;
  readonly revision: string;
  readonly compilation: PlaybackCompilation;
}

/**
 * The Renderer-facing seam for Music Core state and commands.
 *
 * Implementations guarantee that bootstrap resolves to one coherent snapshot,
 * subscribed events are delivered in arrival order, and disposing a
 * subscription prevents any later callback.
 */
export interface WorkstationCoreClient {
  getBootstrapState(): Promise<CoreBootstrapState>;
  readPlayback(source: PreviewSource): Promise<PlaybackBundle | null>;
  dispatch(command: RendererCommand): Promise<void>;
  subscribe(listener: CoreEventListener): () => void;
}
