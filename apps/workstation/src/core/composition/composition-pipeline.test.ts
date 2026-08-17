import { parseMidi } from 'midi-file';
import { describe, expect, it } from 'vitest';

import {
  TRACK_IDS,
  isPlaybackCompilation,
  isTimelineViewModel,
} from '@agent-music/contracts';

import {
  CompositionValidationError,
  canonicalizeExternalAbc,
  compileComposition,
} from './index.js';

const composition = (body: string): string => `X:1
T:Playback fixture
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map((trackId) => `[V:${trackId}] ${body}`).join('\n')}
`;

describe('Composition Pipeline derived outputs', () => {
  it('builds a real format-1 Standard MIDI document and playback metadata', () => {
    const source = canonicalizeExternalAbc(
      composition('C2 [Q:1/4=90] [K:G] [CEG]2 | z4 |'),
    );
    const result = compileComposition(source);

    expect(isPlaybackCompilation(result.playback)).toBe(true);
    expect(result.playback.totalTicks).toBe(7680);
    expect(result.playback.midiDocument.tracks).toHaveLength(6);
    expect(result.playback.midiDocument.tracks[0]?.notes).toEqual([
      { startTick: 0, durationTick: 1920, pitch: 60, velocity: 100 },
      { startTick: 1920, durationTick: 1920, pitch: 60, velocity: 100 },
      { startTick: 1920, durationTick: 1920, pitch: 64, velocity: 100 },
      { startTick: 1920, durationTick: 1920, pitch: 67, velocity: 100 },
    ]);

    const midi = parseMidi(result.playback.midiDocument.fileBytes);
    expect(midi.header).toMatchObject({
      format: 1,
      numTracks: 7,
      ticksPerBeat: 960,
    });
    expect(midi.tracks).toHaveLength(7);
    expect(
      midi.tracks[0]?.filter((event) => event.type === 'setTempo'),
    ).toHaveLength(2);
    expect(
      midi.tracks[1]?.filter((event) => event.type === 'noteOn'),
    ).toHaveLength(4);
  });

  it('builds openDAW-independent timeline clips and preserves trailing rests', () => {
    const source = canonicalizeExternalAbc(
      composition('C D z2 | E F G A | z4 |'),
    );
    const result = compileComposition(source);

    expect(isTimelineViewModel(result.timelineViewModel)).toBe(true);
    expect(result.timelineViewModel.totalTicks).toBe(11_520);
    expect(result.timelineViewModel.tracks[0]?.clips).toEqual([
      { startTick: 0, endTick: 1920 },
      { startTick: 3840, endTick: 7680 },
    ]);
    expect(result.playback.midiDocument.tracks[0]?.notes.at(-1)).toMatchObject({
      startTick: 6720,
      durationTick: 960,
    });
  });

  it('rejects tempos that cannot fit the Standard MIDI 24-bit field', () => {
    const supported = canonicalizeExternalAbc(
      composition('C4 |').replace('Q:1/4=120', 'Q:1/4=4'),
    );
    const midi = parseMidi(
      compileComposition(supported).playback.midiDocument.fileBytes,
    );

    expect(
      midi.tracks[0]?.find((event) => event.type === 'setTempo'),
    ).toMatchObject({ type: 'setTempo', microsecondsPerBeat: 15_000_000 });

    const unsupported = canonicalizeExternalAbc(
      composition('C4 |').replace('Q:1/4=120', 'Q:1/4=3'),
    );
    expect(() => compileComposition(unsupported)).toThrow(
      CompositionValidationError,
    );
  });

  it('writes canonical event velocity into semantic and binary MIDI', () => {
    const source = canonicalizeExternalAbc(composition('[I:MIDI vol 41]C4 |'));
    const result = compileComposition(source);
    const midi = parseMidi(result.playback.midiDocument.fileBytes);

    expect(result.playback.midiDocument.tracks[0]?.notes[0]?.velocity).toBe(41);
    expect(
      midi.tracks[1]?.find((event) => event.type === 'noteOn'),
    ).toMatchObject({ type: 'noteOn', velocity: 41 });
  });
});
