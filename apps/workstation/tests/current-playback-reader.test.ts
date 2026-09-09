import { describe, expect, it } from 'vitest';
import type { CurrentAuthoritySnapshot } from '../src/core/project/current-authority.js';
import { CurrentPlaybackReader } from '../src/core/project/current-playback-reader.js';
import type { ProjectAuthorityAccess } from '../src/core/project/project-authority-access.js';
import { PROJECT_PPQ, TRACK_IDS } from '@agent-music/contracts';

const source = `X:1
T:B3 Current
M:3/4
L:1/4
Q:1/4=108
K:Dm
V:track.drums
V:track.bass
V:track.guitar
V:track.keys
V:track.strings
V:track.winds
[V:track.drums] z3 |
[V:track.bass] D,2 D, |
[V:track.guitar] A2 A |
[V:track.keys] D F A |
[V:track.strings] d2 d |
[V:track.winds] f2 f |`;

const snapshot: CurrentAuthoritySnapshot = {
  currentRevision: 'current-sha-1',
  compositionSource: source,
  manifest: {
    formatVersion: 1,
    projectId: 'project-test' as never,
    timebase: { ppq: PROJECT_PPQ },
    tracks: TRACK_IDS,
  },
};

const authority: ProjectAuthorityAccess = {
  readCleanCurrent: async () => snapshot,
  getProjectPath: () => 'C:/project',
  runSerializedWrite: async (operation) => await operation(),
};

describe('CurrentPlaybackReader', () => {
  it('compiles only the authoritative Current into ordered six-track playback', async () => {
    const result = await new CurrentPlaybackReader(authority).read();

    expect(result.revision).toBe(snapshot.currentRevision);
    expect(
      result.compilation.midiDocument.tracks.map((track) => track.trackId),
    ).toEqual([
      'track.drums',
      'track.bass',
      'track.guitar',
      'track.keys',
      'track.strings',
      'track.winds',
    ]);
    expect(result.compilation.midiDocument.tracks[3]?.notes[0]).toMatchObject({
      startTick: 0,
      durationTick: 960,
      pitch: 62,
      velocity: 100,
    });
    expect(result.compilation.tempoMap).toEqual([{ tick: 0, bpm: 108 }]);
    expect(result.compilation.meterMap).toEqual([
      { tick: 0, numerator: 3, denominator: 4 },
    ]);
    expect(result.compilation.keyMap).toEqual([
      { tick: 0, tonic: 'D', accidental: '', mode: 'm' },
    ]);
    expect(result.timeline.tracks.map((track) => track.trackId)).toEqual(
      result.compilation.trackIds,
    );
  });
});
