import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { createBundledP0SoundFont } from './builtin-soundfont.js';
import { createPlaybackRuntime } from './playback-runtime.js';
import { SpessaSynthRuntimeAdapter } from './spessasynth-runtime-adapter.js';
import type { PlaybackRuntime } from './types.js';

let soundFont: ArrayBuffer | null = null;

/** Production B3 factory. The SoundFont is created once and copied per engine. */
export const createSpessaSynthPlaybackRuntime = (): PlaybackRuntime => {
  soundFont ??= createBundledP0SoundFont();
  return createPlaybackRuntime(
    new SpessaSynthRuntimeAdapter({
      processorUrl,
      soundFontBuffer: soundFont.slice(0),
    }),
  );
};
