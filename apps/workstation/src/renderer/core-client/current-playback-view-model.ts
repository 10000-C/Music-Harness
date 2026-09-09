import {
  TRACK_IDS,
  type PlaybackCompilation,
  type TimelineViewModel as CoreTimelineViewModel,
} from '@agent-music/contracts';
import type {
  KeyMode,
  KeyTonic,
  MeterDenominator,
  RendererTimelineViewModel,
} from '../b-contracts/index.js';

const labels: Record<(typeof TRACK_IDS)[number], string> = {
  'track.drums': 'Drums',
  'track.bass': 'Bass',
  'track.keys': 'Keys',
  'track.guitar': 'Guitar',
  'track.strings': 'Strings',
  'track.winds': 'Winds',
};

const keyTonics = new Set<KeyTonic>([
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
]);
const meterDenominators = new Set<MeterDenominator>([1, 2, 4, 8, 16, 32]);

/**
 * Makes A2's compact TimelineViewModel renderable without fabricating music:
 * note markers and key data are projected from the same PlaybackCompilation.
 */
export const createCurrentPlaybackViewModel = (
  revision: string,
  timeline: CoreTimelineViewModel,
  compilation: PlaybackCompilation,
): RendererTimelineViewModel | null => {
  if (
    revision.length === 0 ||
    timeline.totalTicks !== compilation.totalTicks ||
    timeline.tracks.length !== TRACK_IDS.length ||
    compilation.midiDocument.tracks.length !== TRACK_IDS.length
  )
    return null;

  const tracks = TRACK_IDS.map((trackId, index) => {
    const coreTrack = timeline.tracks[index];
    const midiTrack = compilation.midiDocument.tracks[index];
    if (coreTrack?.trackId !== trackId || midiTrack?.trackId !== trackId)
      return null;
    return {
      trackId,
      label: labels[trackId],
      clips: coreTrack.clips.map((clip) => ({
        ...clip,
        label: labels[trackId],
        density: Math.min(
          1,
          midiTrack.notes.filter(
            (note) =>
              note.startTick >= clip.startTick && note.startTick < clip.endTick,
          ).length / 16,
        ),
        noteMarkers: midiTrack.notes
          .filter(
            (note) =>
              note.startTick >= clip.startTick &&
              note.startTick + note.durationTick <= clip.endTick,
          )
          .map((note) => ({
            startTick: note.startTick,
            endTick: (note.startTick +
              note.durationTick) as typeof note.startTick,
            pitch: note.pitch,
            velocity: note.velocity,
          })),
      })),
    };
  });
  if (tracks.some((track) => track === null)) return null;

  const keyMap = compilation.keyMap.map((key) => {
    const tonic = `${key.tonic}${key.accidental}`;
    if (!keyTonics.has(tonic as KeyTonic)) return null;
    const mode: KeyMode = key.mode.toLowerCase().startsWith('m')
      ? 'minor'
      : 'major';
    return { tick: key.tick, tonic: tonic as KeyTonic, mode };
  });
  if (keyMap.some((key) => key === null)) return null;
  if (
    compilation.meterMap.some(
      (meter) => !meterDenominators.has(meter.denominator as MeterDenominator),
    )
  )
    return null;

  return {
    schemaVersion: 1,
    revision,
    totalTicks: timeline.totalTicks,
    ticksPerQuarter: compilation.midiDocument.ppq,
    tempoMap: compilation.tempoMap,
    meterMap: compilation.meterMap.map((meter) => ({
      ...meter,
      denominator: meter.denominator as MeterDenominator,
    })),
    keyMap: keyMap as NonNullable<(typeof keyMap)[number]>[],
    tracks: tracks as NonNullable<(typeof tracks)[number]>[],
  };
};
