import {
  TRACK_IDS,
  type PlaybackCompilation,
  type TimelineViewModel,
} from '@agent-music/contracts';

import { compileCanonicalAbc } from './canonical-abc.js';
import type { CanonicalAbcCompilation } from './composition-types.js';
import { createStandardMidiDocument } from './midi-document.js';
import {
  createScopeMappingCache,
  type ScopeMappingCache,
} from './scope-mapping.js';
import { createTimelineViewModel } from './timeline-view-model.js';

export interface CompositionCompilation extends CanonicalAbcCompilation {
  readonly playback: PlaybackCompilation;
  readonly scopeMapping: ScopeMappingCache;
  readonly timelineViewModel: TimelineViewModel;
}

export const compileComposition = (source: string): CompositionCompilation => {
  const canonical = compileCanonicalAbc(source);
  return {
    ...canonical,
    playback: {
      midiDocument: createStandardMidiDocument(canonical),
      totalTicks: canonical.totalTicks,
      trackIds: TRACK_IDS,
      meterMap: canonical.meterMap,
      tempoMap: canonical.tempoMap,
      keyMap: canonical.keyMap,
    },
    scopeMapping: createScopeMappingCache(canonical),
    timelineViewModel: createTimelineViewModel(canonical),
  };
};
