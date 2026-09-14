import {
  TRACK_IDS,
  type CandidateEvent,
  type CandidateId,
  type CandidateView,
  type ProjectId,
  type TaskContextView,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createLiveCandidateAdapter,
  reduceLiveCandidateState,
} from '../src/renderer/core-client/live-candidate-adapter.js';

const projectId = '00000000-0000-4000-8000-000000000101' as ProjectId;
const candidateId = '00000000-0000-4000-8000-000000000102' as CandidateId;
const taskId = '00000000-0000-4000-8000-000000000103' as never;
const candidate: CandidateView = {
  candidateId,
  projectId,
  baseRevision: 'C0',
  state: 'ready',
};
const task: TaskContextView = {
  taskId,
  projectId,
  candidateId,
  baseRevision: 'C0',
  scope: { type: 'wholeProject', trackIds: TRACK_IDS },
  scopeRevision: 0,
  state: 'editing',
  candidateState: 'ready',
  allowedOperations: ['replaceScopedMusic', 'updateMusicalProperties'],
  trackIds: TRACK_IDS,
  createdAt: '2026-09-09T00:00:00.000Z',
};

const event = (value: CandidateEvent): CandidateEvent => value;

describe('live Candidate adapter', () => {
  it('projects only genuine Candidate events and ignores another project', () => {
    const initial = createLiveCandidateAdapter({
      projectId,
      bridge: { dispatchCandidate: vi.fn() },
    }).getState();
    const next = reduceLiveCandidateState(initial, {
      type: 'events',
      events: [
        event({
          type: 'candidate.changed',
          requestId: 'request-1',
          sequence: 1,
          candidate: {
            ...candidate,
            projectId: '00000000-0000-4000-8000-000000000199' as ProjectId,
          },
        }),
        event({
          type: 'task.changed',
          requestId: 'request-1',
          sequence: 2,
          task,
        }),
        event({
          type: 'candidate.changed',
          requestId: 'request-1',
          sequence: 3,
          candidate,
        }),
      ],
    });
    expect(next.status).toBe('ready');
    expect(next.candidate).toEqual(candidate);
    expect(next.task).toEqual(task);
  });

  it('keeps review controls unavailable until ready, then applies real events', async () => {
    const dispatchCandidate = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        events: [
          event({
            type: 'task.changed',
            requestId: 'start-1',
            sequence: 1,
            task: { ...task, candidateState: 'active' },
          }),
          event({
            type: 'candidate.changed',
            requestId: 'start-1',
            sequence: 2,
            candidate: { ...candidate, state: 'active' },
          }),
        ],
      })
      .mockResolvedValueOnce({
        ok: true as const,
        events: [
          event({
            type: 'candidate.currentCommitted',
            requestId: 'accept-1',
            sequence: 4,
            result: {
              projectId,
              candidateId,
              currentRevision: 'C1',
            },
          }),
        ],
      });
    const adapter = createLiveCandidateAdapter({
      projectId,
      bridge: { dispatchCandidate },
      createRequestId: (() => {
        let index = 0;
        return () => `request-${++index}`;
      })(),
    });

    await expect(adapter.accept()).rejects.toThrow('unavailable');
    await adapter.startTask({ type: 'wholeProject', trackIds: TRACK_IDS });
    expect(adapter.getState().status).toBe('building');
    await expect(adapter.accept()).rejects.toThrow('unavailable');
    // The test bridge's second batch is deliberately consumed through a
    // ready event to model A4 completion without fabricating playback data.
    adapter.applyEvents([
      event({
        type: 'candidate.changed',
        requestId: 'ready-1',
        sequence: 3,
        candidate,
      }),
    ]);
    expect(adapter.getState().status).toBe('ready');

    await adapter.accept();
    expect(dispatchCandidate).toHaveBeenCalledTimes(2);
  });

  it('clears Candidate after an authoritative commit and preserves its revision', () => {
    const state = reduceLiveCandidateState(
      {
        status: 'ready',
        projectId,
        candidate,
        task,
        error: null,
        committedRevision: null,
      },
      {
        type: 'events',
        events: [
          event({
            type: 'candidate.currentCommitted',
            requestId: 'accept-1',
            sequence: 1,
            result: { projectId, candidateId, currentRevision: 'C1' },
          }),
        ],
      },
    );
    expect(state).toMatchObject({
      status: 'none',
      candidate: null,
      task: null,
      committedRevision: 'C1',
    });
  });
});
