import { describe, expect, it } from 'vitest';
import {
  isExportPathRequest,
  isProjectDirectoryPurpose,
} from '../src/shared/shell-contracts.js';
import {
  isCoreCandidateEventNotification,
  isCoreCandidateStateResponse,
} from '../src/shared/candidate-bridge.js';

const projectId = '00000000-0000-4000-8000-000000000301';
const candidateId = '00000000-0000-4000-8000-000000000302';

describe('shell contracts', () => {
  it.each(['create', 'open', 'saveAs'])(
    'allows directory purpose %s',
    (value) => {
      expect(isProjectDirectoryPurpose(value)).toBe(true);
    },
  );
  it.each(['delete', '', null])(
    'rejects non-semantic directory purpose %s',
    (value) => {
      expect(isProjectDirectoryPurpose(value)).toBe(false);
    },
  );
  it.each(['abc', 'midi', 'wav'])(
    'allows export format %s with a safe filename',
    (format) => {
      expect(
        isExportPathRequest({ format, suggestedName: 'song-01.abc' }),
      ).toBe(true);
    },
  );
  it('allows Unicode and spaces in a safe Windows filename', () => {
    expect(
      isExportPathRequest({
        format: 'wav',
        suggestedName: '午夜 草图.wav',
      }),
    ).toBe(true);
  });
  it.each([
    { format: 'mp3', suggestedName: 'song' },
    { format: 'wav', suggestedName: '../song.wav' },
    { format: 'wav', suggestedName: '' },
    { format: 'wav', suggestedName: 'CON.wav' },
    { format: 'wav', suggestedName: 'song. ' },
  ])('rejects unsafe export request', (value) => {
    expect(isExportPathRequest(value)).toBe(false);
  });

  it('requires a separate Candidate playback snapshot revision on Core state', () => {
    const state = {
      type: 'candidateState.readResult',
      protocolVersion: 1,
      requestId: 'state-1',
      state: {
        projectId,
        sequence: 4,
        candidate: {
          candidateId,
          projectId,
          baseRevision: 'current-1',
          state: 'ready',
        },
        task: null,
        candidatePlaybackSnapshot: {
          candidateId,
          revision: 'candidate-snapshot-7',
        },
      },
    };
    expect(isCoreCandidateStateResponse(state)).toBe(true);
    expect(
      isCoreCandidateStateResponse({
        ...state,
        state: { ...state.state, candidatePlaybackSnapshot: null },
      }),
    ).toBe(true);
    expect(
      isCoreCandidateStateResponse({
        ...state,
        state: {
          ...state.state,
          candidatePlaybackSnapshot: {
            candidateId,
            revision: 'current-1',
          },
        },
      }),
    ).toBe(true);
    expect(
      isCoreCandidateStateResponse({
        ...state,
        state: {
          ...state.state,
          candidatePlaybackSnapshot: {
            candidateId,
            revision: '',
          },
        },
      }),
    ).toBe(false);
  });

  it('carries the updated Candidate playback revision on each Core notification', () => {
    const notification = {
      type: 'candidateState.event',
      protocolVersion: 1,
      projectId,
      candidatePlaybackSnapshot: {
        candidateId,
        revision: 'candidate-snapshot-8',
      },
      event: {
        type: 'candidate.changed',
        requestId: 'event-1',
        sequence: 5,
        candidate: {
          candidateId,
          projectId,
          baseRevision: 'current-1',
          state: 'ready',
        },
      },
    };
    expect(isCoreCandidateEventNotification(notification)).toBe(true);
    expect(
      isCoreCandidateEventNotification({
        ...notification,
        candidatePlaybackSnapshot: {
          candidateId: '00000000-0000-4000-8000-000000000399',
          revision: 'candidate-snapshot-8',
        },
      }),
    ).toBe(false);
  });
});
