import { describe, expect, it } from 'vitest';

import { TRACK_IDS, type Tick } from './domain.js';
import {
  isPlaybackCompilation,
  isTimelineViewModel,
  type PlaybackCompilation,
  type TimelineViewModel,
} from './composition.js';

const tick = (value: number): Tick => value as Tick;

const playbackFixture = (): PlaybackCompilation => ({
  totalTicks: tick(3840),
  trackIds: TRACK_IDS,
  meterMap: [{ tick: tick(0), numerator: 4, denominator: 4 }],
  tempoMap: [{ tick: tick(0), bpm: 120 }],
  keyMap: [{ tick: tick(0), tonic: 'C', accidental: '', mode: '' }],
  midiDocument: {
    format: 1,
    ppq: 960,
    fileBytes: new Uint8Array([0x4d, 0x54, 0x68, 0x64]),
    tracks: TRACK_IDS.map((trackId, index) => ({
      trackId,
      channel: index,
      notes:
        index === 0
          ? [
              {
                startTick: tick(0),
                durationTick: tick(960),
                pitch: 60,
                velocity: 100,
              },
            ]
          : [],
    })),
  },
});

describe('playback compilation contract', () => {
  it('accepts an openDAW-independent six-track MIDI document', () => {
    expect(isPlaybackCompilation(playbackFixture())).toBe(true);
  });

  it('rejects invalid track order and notes beyond the composition', () => {
    const wrongOrder = playbackFixture();
    const reversedTracks = [...wrongOrder.midiDocument.tracks].reverse();

    expect(
      isPlaybackCompilation({
        ...wrongOrder,
        midiDocument: { ...wrongOrder.midiDocument, tracks: reversedTracks },
      }),
    ).toBe(false);

    const outOfBounds = playbackFixture();
    const tracks = [...outOfBounds.midiDocument.tracks];
    const firstTrack = tracks[0];
    if (firstTrack === undefined) {
      throw new Error('fixture must contain the fixed tracks');
    }
    tracks[0] = {
      ...firstTrack,
      notes: [
        {
          startTick: tick(3500),
          durationTick: tick(960),
          pitch: 60,
          velocity: 100,
        },
      ],
    };

    expect(
      isPlaybackCompilation({
        ...outOfBounds,
        midiDocument: { ...outOfBounds.midiDocument, tracks },
      }),
    ).toBe(false);
  });
});

describe('timeline view model contract', () => {
  it('accepts fixed tracks with clips on the shared tick timeline', () => {
    const timeline: TimelineViewModel = {
      totalTicks: tick(3840),
      meterMap: [{ tick: tick(0), numerator: 4, denominator: 4 }],
      tempoMap: [{ tick: tick(0), bpm: 120 }],
      tracks: TRACK_IDS.map((trackId) => ({
        trackId,
        clips: [{ startTick: tick(0), endTick: tick(960) }],
      })),
    };

    expect(isTimelineViewModel(timeline)).toBe(true);
  });

  it('rejects clips outside the project tick range', () => {
    const timeline: TimelineViewModel = {
      totalTicks: tick(3840),
      meterMap: [{ tick: tick(0), numerator: 4, denominator: 4 }],
      tempoMap: [{ tick: tick(0), bpm: 120 }],
      tracks: TRACK_IDS.map((trackId, index) => ({
        trackId,
        clips: index === 0 ? [{ startTick: tick(0), endTick: tick(4000) }] : [],
      })),
    };

    expect(isTimelineViewModel(timeline)).toBe(false);
  });
});
