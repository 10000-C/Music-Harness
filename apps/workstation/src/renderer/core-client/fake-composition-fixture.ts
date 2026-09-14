import {
  TRACK_IDS,
  createMidiNoteNumber,
  type RendererKeyEvent,
  type MeterEvent,
  type MidiNoteEvent,
  type TempoEvent,
  type Tick,
  type TrackId,
} from '../b-contracts/index.js';

export const FAKE_TICKS_PER_BAR = 3_840;
export const FAKE_TOTAL_BARS = 32;
export const FAKE_TOTAL_TICKS = FAKE_TICKS_PER_BAR * FAKE_TOTAL_BARS;
export const FAKE_CURRENT_PLAYBACK_REVISION = 'current-0042';
export const FAKE_CANDIDATE_PLAYBACK_REVISION =
  'candidate.arrangement-001@generation-0001';

export const fakeTick = (value: number): Tick => value as Tick;

export const fakeBarStart = (bar: number): Tick =>
  fakeTick((bar - 1) * FAKE_TICKS_PER_BAR);

export const FAKE_TEMPO_MAP = [
  { tick: fakeTick(0), bpm: 120 },
  { tick: fakeBarStart(17), bpm: 90 },
] as const satisfies readonly TempoEvent[];

export const FAKE_METER_MAP = [
  { tick: fakeTick(0), numerator: 4, denominator: 4 },
] as const satisfies readonly MeterEvent[];

export const FAKE_KEY_MAP = [
  {
    tick: fakeTick(0),
    tonic: 'D',
    mode: 'minor',
  },
] as const satisfies readonly RendererKeyEvent[];

export interface FakeArrangementClip {
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly label: string;
  readonly density: number;
  readonly notes: readonly MidiNoteEvent[];
}

const arrangementClip = (
  startBar: number,
  endBar: number,
  label: string,
  density: number,
  pitches: readonly number[],
  stepTicks = 1_920,
  noteDuration: number | readonly number[] = 720,
  noteOffset = 0,
): FakeArrangementClip => {
  const startTick = fakeBarStart(startBar);
  const endTick = fakeBarStart(endBar);
  const notes: MidiNoteEvent[] = [];

  for (
    let noteTick: number = startTick + noteOffset, index = 0;
    noteTick < endTick;
    noteTick += stepTicks, index += 1
  ) {
    const duration =
      typeof noteDuration === 'number'
        ? noteDuration
        : (noteDuration[index % noteDuration.length] ?? 720);
    if (noteTick + duration > endTick) break;
    notes.push({
      startTick: fakeTick(noteTick),
      durationTick: fakeTick(duration),
      pitch: createMidiNoteNumber(
        pitches[index % pitches.length] ?? pitches[0] ?? 60,
      ),
      velocity: 72 + ((index * 7) % 39),
    });
  }

  return { startTick, endTick, label, density, notes };
};

/**
 * Neutral composition data shared by the fake Timeline and playback fixtures.
 * Neither representation is reconstructed from the other.
 */
export const FAKE_STABLE_CLIPS: Readonly<
  Record<TrackId, readonly FakeArrangementClip[]>
> = {
  'track.drums': [
    arrangementClip(1, 9, 'Intro groove', 0.72, [36, 42, 38, 42], 960, 240),
    arrangementClip(9, 17, 'Verse groove', 0.78, [36, 42, 38, 46], 960, 240),
    arrangementClip(17, 25, 'Lift groove', 0.88, [36, 46, 38, 42], 960, 240),
    arrangementClip(25, 33, 'Final groove', 0.92, [36, 42, 38, 49], 960, 240),
  ],
  'track.bass': [
    arrangementClip(1, 9, 'D pedal', 0.46, [38, 38, 41, 36]),
    arrangementClip(9, 17, 'Low motion', 0.52, [38, 41, 43, 36]),
    arrangementClip(17, 25, 'Rising bass', 0.58, [38, 41, 43, 45]),
    arrangementClip(25, 33, 'Root and fifth', 0.62, [38, 45, 41, 43]),
  ],
  'track.guitar': [
    arrangementClip(3, 9, 'Muted pulse', 0.4, [62, 65, 69, 65], 960, 480),
    arrangementClip(9, 17, 'Dry rhythm', 0.46, [62, 67, 69, 65], 960, 480),
    arrangementClip(17, 25, 'Open voicings', 0.55, [62, 65, 69, 72]),
    arrangementClip(25, 33, 'Wide voicings', 0.6, [65, 69, 72, 74]),
  ],
  'track.keys': [
    arrangementClip(
      1,
      4.7,
      'Verse keys',
      0.35,
      [74, 70, 67, 64, 60, 57, 53],
      1_920,
      [1_680, 2_400, 1_440, 2_640],
      1_920,
    ),
    arrangementClip(
      4.7,
      7.5,
      'CHORUS',
      0.44,
      [71, 68, 65, 61, 58, 55, 52, 60],
      1_920,
      [2_160, 1_440, 2_400],
      960,
    ),
    arrangementClip(
      7.5,
      9,
      'Chorus tail',
      0.38,
      [58, 64, 69],
      1_920,
      [1_680, 2_160],
      960,
    ),
    arrangementClip(9, 17, 'Chord echoes', 0.4, [62, 67, 70], 3_840, 1_680),
    arrangementClip(
      17,
      25,
      'Wide chords',
      0.48,
      [62, 67, 70, 74],
      3_840,
      1_680,
    ),
    arrangementClip(25, 33, 'High release', 0.44, [65, 69, 72], 3_840, 1_680),
  ],
  'track.strings': [
    arrangementClip(5, 17, 'Low sustain', 0.2, [62, 65, 69], 7_680, 3_600),
    arrangementClip(17, 25, 'Long arc', 0.28, [74, 77, 81], 7_680, 3_600),
    arrangementClip(25, 33, 'Upper lift', 0.34, [77, 81, 86], 7_680, 3_600),
  ],
  'track.winds': [
    arrangementClip(7, 13, 'Answer phrase', 0.2, [81, 79, 77], 1_920, 720),
    arrangementClip(15, 21, 'Second answer', 0.22, [79, 81, 84], 1_920, 720),
    arrangementClip(23, 29, 'Closing phrase', 0.24, [81, 84, 86], 1_920, 720),
    arrangementClip(29, 33, 'Final breath', 0.18, [84, 81, 77], 1_920, 720),
  ],
} satisfies Readonly<
  Record<(typeof TRACK_IDS)[number], readonly FakeArrangementClip[]>
>;

const transposeClip = (
  clip: FakeArrangementClip,
  semitones: number,
  label = clip.label,
): FakeArrangementClip => ({
  ...clip,
  label,
  notes: clip.notes.map((note) => ({
    ...note,
    pitch: createMidiNoteNumber(note.pitch + semitones),
  })),
});

/** Explicit candidate input used by the renderer demo and its playback bundle. */
export const FAKE_CANDIDATE_CLIPS: Readonly<
  Record<TrackId, readonly FakeArrangementClip[]>
> = {
  ...FAKE_STABLE_CLIPS,
  'track.keys': FAKE_STABLE_CLIPS['track.keys'].map((clip) =>
    clip.label === 'CHORUS'
      ? transposeClip(clip, -12, 'CHORUS · Candidate')
      : clip,
  ),
  'track.guitar': FAKE_STABLE_CLIPS['track.guitar'].map((clip) => ({
    ...clip,
    label: `${clip.label} · Candidate`,
    notes: clip.notes.map((note) => ({
      ...note,
      velocity: Math.min(127, note.velocity + 8),
    })),
  })),
};
