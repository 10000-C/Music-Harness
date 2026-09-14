import { parseMidi } from 'midi-file';
import { describe, expect, it } from 'vitest';

import {
  TRACK_IDS,
  isPlaybackCompilation,
  type CandidateId,
  type CoreBootstrapState,
} from '../src/renderer/b-contracts/index.js';
import {
  FAKE_CANDIDATE_ID,
  FAKE_CANDIDATE_PLAYBACK_REVISION,
  FAKE_CURRENT_PLAYBACK_REVISION,
  FakeWorkstationCoreClient,
  getFakeCoreFixture,
} from '../src/renderer/core-client/index.js';

const requireOpenCurrent = (
  state: CoreBootstrapState,
): Extract<CoreBootstrapState['current'], { status: 'ready' }> => {
  if (state.current.status !== 'ready') {
    throw new Error('Test fixture needs a ready Current.');
  }
  return state.current;
};

describe('Fake Workstation Core playback seam', () => {
  it('reads a revision-bearing, formal six-track Current compilation', async () => {
    const state = getFakeCoreFixture('stable');
    const client = new FakeWorkstationCoreClient(state);
    const bundle = await client.readPlayback({ kind: 'current' });

    expect(bundle).not.toBeNull();
    if (bundle === null || state.timeline === null) return;

    expect(bundle.source).toEqual({ kind: 'current' });
    expect(bundle.revision).toBe(FAKE_CURRENT_PLAYBACK_REVISION);
    expect(isPlaybackCompilation(bundle.compilation)).toBe(true);
    expect(bundle.compilation).toMatchObject({
      totalTicks: 122_880,
      trackIds: TRACK_IDS,
      meterMap: [{ tick: 0, numerator: 4, denominator: 4 }],
      tempoMap: [
        { tick: 0, bpm: 120 },
        { tick: 61_440, bpm: 90 },
      ],
      keyMap: [{ tick: 0, tonic: 'D', accidental: '', mode: 'minor' }],
      midiDocument: { format: 1, ppq: 960 },
    });
    expect(bundle.compilation.midiDocument.fileBytes).toBeInstanceOf(
      Uint8Array,
    );
    expect(bundle.compilation.midiDocument.tracks).toHaveLength(6);

    const parsed = parseMidi(bundle.compilation.midiDocument.fileBytes);
    expect(parsed.header).toMatchObject({
      format: 1,
      numTracks: 7,
      ticksPerBeat: 960,
    });

    for (const [
      index,
      playbackTrack,
    ] of bundle.compilation.midiDocument.tracks.entries()) {
      const timelineTrack = state.timeline.tracks[index];
      expect(playbackTrack.trackId).toBe(TRACK_IDS[index]);
      expect(playbackTrack.notes).toEqual(
        timelineTrack?.clips.flatMap((clip) =>
          clip.noteMarkers.map((note) => ({
            startTick: note.startTick,
            durationTick: note.endTick - note.startTick,
            pitch: note.pitch,
            velocity: note.velocity,
          })),
        ),
      );
    }
  });

  it('returns null for an empty Current or a missing Candidate', async () => {
    const blank = new FakeWorkstationCoreClient(getFakeCoreFixture('blank'));
    const stable = new FakeWorkstationCoreClient(getFakeCoreFixture('stable'));

    await expect(blank.readPlayback({ kind: 'current' })).resolves.toBeNull();
    await expect(
      stable.readPlayback({
        kind: 'candidate',
        candidateId: FAKE_CANDIDATE_ID,
      }),
    ).resolves.toBeNull();
  });

  it('serves only the ready Candidate with the requested identity', async () => {
    const candidate = new FakeWorkstationCoreClient(
      getFakeCoreFixture('candidate'),
    );
    const running = new FakeWorkstationCoreClient(
      getFakeCoreFixture('running'),
    );
    const wrongCandidateId = 'candidate.arrangement-stale' as CandidateId;

    const bundle = await candidate.readPlayback({
      kind: 'candidate',
      candidateId: FAKE_CANDIDATE_ID,
    });
    expect(bundle).toMatchObject({
      source: { kind: 'candidate', candidateId: FAKE_CANDIDATE_ID },
      revision: FAKE_CANDIDATE_PLAYBACK_REVISION,
    });
    expect(isPlaybackCompilation(bundle?.compilation)).toBe(true);

    await expect(
      candidate.readPlayback({
        kind: 'candidate',
        candidateId: wrongCandidateId,
      }),
    ).resolves.toBeNull();
    await expect(
      running.readPlayback({
        kind: 'candidate',
        candidateId: FAKE_CANDIDATE_ID,
      }),
    ).resolves.toBeNull();
  });

  it('fails closed instead of returning playback for an unknown revision', async () => {
    const stable = getFakeCoreFixture('stable');
    const client = new FakeWorkstationCoreClient(stable);
    client.replaceBootstrapState({
      ...stable,
      current: {
        ...requireOpenCurrent(stable),
        revision: 'current-0043',
      },
    });

    await expect(client.readPlayback({ kind: 'current' })).resolves.toBeNull();

    const candidate = getFakeCoreFixture('candidate');
    if (candidate.candidate.status !== 'ready') {
      throw new Error('Test fixture needs a ready Candidate.');
    }
    const unknownCandidateId = 'candidate.arrangement-unknown' as CandidateId;
    client.replaceBootstrapState({
      ...candidate,
      candidate: {
        ...candidate.candidate,
        candidateId: unknownCandidateId,
      },
    });
    await expect(
      client.readPlayback({
        kind: 'candidate',
        candidateId: unknownCandidateId,
      }),
    ).resolves.toBeNull();
  });

  it('does not infer playback from the UI Timeline or leak fixture references', async () => {
    const stable = getFakeCoreFixture('stable');
    const blankTimeline = getFakeCoreFixture('blank').timeline;
    const client = new FakeWorkstationCoreClient({
      ...stable,
      timeline: blankTimeline,
    });

    const first = await client.readPlayback({ kind: 'current' });
    expect(
      first?.compilation.midiDocument.tracks[0]?.notes.length,
    ).toBeGreaterThan(0);
    if (first === null) return;

    const pristine = structuredClone(first);
    const originalHeaderByte = first.compilation.midiDocument.fileBytes[0];
    const firstNote = first.compilation.midiDocument.tracks[0]?.notes[0];
    if (firstNote === undefined) {
      throw new Error('Test fixture needs a note to verify deep cloning.');
    }
    first.compilation.midiDocument.fileBytes[0] = 0;
    Reflect.set(firstNote, 'velocity', 1);
    const second = await client.readPlayback({ kind: 'current' });

    expect(second).toEqual(pristine);
    expect(second).not.toBeNull();
    if (second === null) return;
    expect(second.compilation.midiDocument.fileBytes[0]).toBe(
      originalHeaderByte,
    );
    expect(second).not.toBe(first);
    expect(second.compilation).not.toBe(first.compilation);
    expect(second.compilation.midiDocument.tracks[0]?.notes).not.toBe(
      first.compilation.midiDocument.tracks[0]?.notes,
    );
  });
});
