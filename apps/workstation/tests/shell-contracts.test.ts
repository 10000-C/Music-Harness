import { describe, expect, it } from 'vitest';
import {
  isExportPathRequest,
  isProjectDirectoryPurpose,
} from '../src/shared/shell-contracts.js';
import {
  isCoreCandidateEventNotification,
  isCoreCandidateStateResponse,
} from '../src/shared/candidate-bridge.js';
import { isMainToServiceMessage } from '../src/shared/service-lifecycle.js';
import {
  isCoreOperationEventNotification,
  isOperationControlCommand,
  isOperationControlResult,
  isOperationStateResult,
} from '../src/shared/operation-bridge.js';

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

  it('accepts playback.readSnapshot as a valid main-to-service message', () => {
    expect(
      isMainToServiceMessage({
        type: 'playback.readSnapshot',
        protocolVersion: 1,
        requestId: 'snapshot-req-1',
        projectId,
        source: {
          kind: 'current',
          revision: 'current-rev-1',
        },
      }),
    ).toBe(true);
    expect(
      isMainToServiceMessage({
        type: 'playback.readSnapshot',
        protocolVersion: 1,
        requestId: 'snapshot-req-2',
        projectId,
        source: {
          kind: 'candidate',
          candidateId,
          revision: 'candidate-rev-1',
        },
      }),
    ).toBe(true);
  });

  it('validates Operation state and control payloads before exposing them to Renderer', () => {
    const operation = {
      operationId: 'operation-1',
      type: 'generationPlan' as const,
      state: 'pending' as const,
      createdAt: '2026-09-14T00:00:00.000Z',
      summary: 'Generate a new chorus',
      scope: {
        type: 'wholeProject' as const,
        trackIds: ['track.drums'] as const,
      },
    };
    const state = {
      projectId,
      sequence: 6,
      operations: [operation],
    };
    expect(isOperationStateResult({ ok: true, state })).toBe(true);
    expect(
      isOperationControlCommand({
        type: 'operation.resolve',
        protocolVersion: 1,
        requestId: 'resolve-1',
        operationId: operation.operationId,
        decision: 'approve',
      }),
    ).toBe(true);
    expect(isOperationControlResult({ ok: true, operation })).toBe(true);
    expect(
      isCoreOperationEventNotification({
        type: 'operationState.event',
        protocolVersion: 1,
        projectId,
        sequence: 7,
        operation,
      }),
    ).toBe(true);
    expect(
      isOperationStateResult({
        ok: true,
        state: { ...state, operations: [{ operationId: 'bad' }] },
      }),
    ).toBe(false);
    expect(
      isOperationControlResult({
        ok: true,
        operation: { ...operation, state: 'pending', summary: 42 },
      }),
    ).toBe(false);
  });
});
