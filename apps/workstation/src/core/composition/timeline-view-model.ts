import type {
  Tick,
  TimelineClip,
  TimelineTrack,
  TimelineViewModel,
} from '@agent-music/contracts';

import type { CanonicalAbcCompilation } from './composition-types.js';

const tick = (value: number): Tick => value as Tick;

const clipsForTrack = (
  track: CanonicalAbcCompilation['tracks'][number],
): readonly TimelineClip[] => {
  const clips: TimelineClip[] = [];

  for (const event of track.events) {
    if (event.type !== 'note') {
      continue;
    }
    const endTick = event.startTick + event.durationTick;
    const previous = clips.at(-1);
    if (previous !== undefined && event.startTick <= previous.endTick) {
      clips[clips.length - 1] = {
        startTick: previous.startTick,
        endTick: tick(Math.max(previous.endTick, endTick)),
      };
    } else {
      clips.push({ startTick: event.startTick, endTick: tick(endTick) });
    }
  }

  return clips;
};

export const createTimelineViewModel = (
  compilation: CanonicalAbcCompilation,
): TimelineViewModel => ({
  totalTicks: compilation.totalTicks,
  meterMap: compilation.meterMap,
  tempoMap: compilation.tempoMap,
  tracks: compilation.tracks.map((track): TimelineTrack => ({
    trackId: track.trackId,
    clips: clipsForTrack(track),
  })),
});
