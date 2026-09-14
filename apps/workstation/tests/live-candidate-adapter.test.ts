import {
  TRACK_IDS,
  type CandidateEvent,
  type CandidateId,
  type CandidateView,
  type OperationId,
  type PendingScopeExtensionView,
  type ProjectId,
  type ScopeExtensionRequestId,
  type TaskContextView,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createLiveCandidateAdapter,
  reduceLiveCandidateState,
} from '../src/renderer/core-client/live-candidate-adapter.js';
import { createFakeCandidateBridge } from '../src/renderer/core-client/fake-candidate-bridge.js';

const projectId = '00000000-0000-4000-8000-000000000101' as ProjectId;
const candidateId = '00000000-0000-4000-8000-000000000102' as CandidateId;
const taskId = '00000000-0000-4000-8000-000000000103' as never;
const candidate: CandidateView = {
  candidateId,
  projectId,
  baseRevision: 'C0',
  state: 'ready',
};
const candidatePlaybackSnapshot = {
  candidateId,
  revision: 'candidate-snapshot-1',
} as const;
const updatedCandidatePlaybackSnapshot = {
  candidateId,
  revision: 'candidate-snapshot-2',
} as const;
const pendingScopeExtension: PendingScopeExtensionView = {
  operationId: '00000000-0000-4000-8000-000000000104' as OperationId,
  taskId,
  requestId: '00000000-0000-4000-8000-000000000105' as ScopeExtensionRequestId,
  fromScopeRevision: 0,
  requestedScope: { type: 'wholeProject', trackIds: TRACK_IDS },
  createdAt: '2026-09-09T00:00:01.000Z',
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
    const bridge = createFakeCandidateBridge({
      projectId,
      sequence: 0,
      candidate: null,
      task: null,
      candidatePlaybackSnapshot: null,
    });
    const initial = createLiveCandidateAdapter({
      projectId,
      bridge,
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
      bridge: createFakeCandidateBridge(
        {
          projectId,
          sequence: 0,
          candidate: null,
          task: null,
          candidatePlaybackSnapshot: null,
        },
        dispatchCandidate,
      ),
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

  it('reads one project snapshot, applies ordered notifications idempotently, and disposes cleanly', async () => {
    const bridge = createFakeCandidateBridge({
      projectId,
      sequence: 2,
      candidate,
      task,
      candidatePlaybackSnapshot,
    });
    const adapter = createLiveCandidateAdapter({ projectId, bridge });
    const listener = vi.fn();
    adapter.subscribe(listener);

    await adapter.ready();
    listener.mockClear();
    expect(adapter.getState()).toMatchObject({
      status: 'ready',
      candidate,
      task,
      candidatePlaybackSnapshot,
    });

    bridge.emit({
      type: 'candidateState.event',
      protocolVersion: 1,
      projectId: '00000000-0000-4000-8000-000000000199' as ProjectId,
      candidatePlaybackSnapshot: null,
      event: {
        type: 'candidate.changed',
        requestId: 'other-project',
        sequence: 3,
        candidate,
      },
    });
    expect(listener).not.toHaveBeenCalled();

    bridge.emit({
      type: 'candidateState.event',
      protocolVersion: 1,
      projectId,
      candidatePlaybackSnapshot: updatedCandidatePlaybackSnapshot,
      event: {
        type: 'candidate.changed',
        requestId: 'update-1',
        sequence: 3,
        candidate: { ...candidate, state: 'active' },
      },
    });
    bridge.emit({
      type: 'candidateState.event',
      protocolVersion: 1,
      projectId,
      candidatePlaybackSnapshot,
      event: {
        type: 'candidate.changed',
        requestId: 'duplicate-3',
        sequence: 3,
        candidate: { ...candidate, state: 'ready' },
      },
    });
    expect(adapter.getState().candidate?.state).toBe('active');
    expect(adapter.getState().candidatePlaybackSnapshot).toEqual(
      updatedCandidatePlaybackSnapshot,
    );
    expect(listener).toHaveBeenCalledTimes(1);

    adapter.dispose();
    bridge.emit({
      type: 'candidateState.event',
      protocolVersion: 1,
      projectId,
      candidatePlaybackSnapshot: null,
      event: {
        type: 'candidate.invalidated',
        requestId: 'reject-1',
        sequence: 4,
        candidateId,
      },
    });
    expect(adapter.getState().candidate?.state).toBe('active');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('projects Candidate creation, rejection, and acceptance notifications', async () => {
    const bridge = createFakeCandidateBridge({
      projectId,
      sequence: 0,
      candidate: null,
      task: null,
      candidatePlaybackSnapshot: null,
    });
    const adapter = createLiveCandidateAdapter({ projectId, bridge });
    await adapter.ready();

    adapter.applyEvents([
      event({
        type: 'candidate.changed',
        requestId: 'created-1',
        sequence: 1,
        candidate,
      }),
    ]);
    expect(adapter.getState()).toMatchObject({ status: 'ready', candidate });

    bridge.emit({
      type: 'candidateState.event',
      protocolVersion: 1,
      projectId,
      candidatePlaybackSnapshot: null,
      event: {
        type: 'candidate.invalidated',
        requestId: 'rejected-1',
        sequence: 2,
        candidateId,
      },
    });
    expect(adapter.getState()).toMatchObject({
      status: 'none',
      candidate: null,
      task: null,
      candidatePlaybackSnapshot: null,
    });

    bridge.emit({
      type: 'candidateState.event',
      protocolVersion: 1,
      projectId,
      candidatePlaybackSnapshot,
      event: {
        type: 'candidate.changed',
        requestId: 'created-2',
        sequence: 3,
        candidate,
      },
    });
    bridge.emit({
      type: 'candidateState.event',
      protocolVersion: 1,
      projectId,
      candidatePlaybackSnapshot: null,
      event: {
        type: 'candidate.currentCommitted',
        requestId: 'accepted-1',
        sequence: 4,
        result: {
          projectId,
          candidateId,
          currentRevision: 'C2',
        },
      },
    });
    expect(adapter.getState()).toMatchObject({
      status: 'none',
      candidate: null,
      committedRevision: 'C2',
    });
    adapter.dispose();
  });

  it('clears Candidate after an authoritative commit and preserves its revision', () => {
    const state = reduceLiveCandidateState(
      {
        status: 'ready',
        projectId,
        candidate,
        task,
        pendingScopeExtension,
        candidatePlaybackSnapshot,
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
      candidatePlaybackSnapshot: null,
      committedRevision: 'C1',
    });
  });

  it('projects a matching scope extension request and exposes typed approve/reject commands', async () => {
    const dispatchCandidate = vi.fn().mockResolvedValue({
      ok: true as const,
      events: [] as readonly CandidateEvent[],
    });
    const adapter = createLiveCandidateAdapter({
      projectId,
      bridge: createFakeCandidateBridge(
        {
          projectId,
          sequence: 1,
          candidate,
          task: { ...task, pendingScopeExtension },
          candidatePlaybackSnapshot,
        },
        dispatchCandidate,
      ),
      createRequestId: () => 'scope-command-1',
    });

    await adapter.ready();
    expect(adapter.getState().pendingScopeExtension).toEqual(
      pendingScopeExtension,
    );

    await adapter.approveScopeExtension();
    expect(dispatchCandidate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'candidate.approveScopeExtension',
        taskId,
        requestIdToApprove: pendingScopeExtension.requestId,
      }),
    );

    await adapter.rejectScopeExtension();
    expect(dispatchCandidate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'candidate.rejectScopeExtension',
        taskId,
        requestIdToReject: pendingScopeExtension.requestId,
      }),
    );
  });

  it('only accepts scope extension events for the active task and clears them authoritatively', () => {
    const initial = reduceLiveCandidateState(
      {
        status: 'building',
        projectId,
        candidate,
        task,
        pendingScopeExtension: null,
        candidatePlaybackSnapshot: null,
        error: null,
        committedRevision: null,
      },
      {
        type: 'events',
        events: [
          event({
            type: 'candidate.scopeExtensionRequested',
            requestId: 'scope-1',
            sequence: 1,
            request: pendingScopeExtension,
          }),
          event({
            type: 'candidate.scopeExtensionRequested',
            requestId: 'scope-other-task',
            sequence: 2,
            request: {
              ...pendingScopeExtension,
              taskId: '00000000-0000-4000-8000-000000000199' as never,
            },
          }),
        ],
      },
    );
    expect(initial.pendingScopeExtension).toEqual(pendingScopeExtension);
    expect(initial.error).toBeNull();

    const cleared = reduceLiveCandidateState(initial, {
      type: 'events',
      events: [
        event({
          type: 'task.changed',
          requestId: 'task-cleared',
          sequence: 3,
          task: { ...task },
        }),
      ],
    });
    expect(cleared.pendingScopeExtension).toBeNull();
  });

  it('fails closed when scope confirmation is requested without a pending request', async () => {
    const dispatchCandidate = vi.fn();
    const adapter = createLiveCandidateAdapter({
      projectId,
      bridge: createFakeCandidateBridge(
        {
          projectId,
          sequence: 0,
          candidate,
          task,
          candidatePlaybackSnapshot: null,
        },
        dispatchCandidate,
      ),
    });
    await adapter.ready();
    await expect(adapter.approveScopeExtension()).rejects.toThrow(
      'unavailable',
    );
    expect(dispatchCandidate).not.toHaveBeenCalled();
  });
});
