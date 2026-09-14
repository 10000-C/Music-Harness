import { describe, expect, it } from 'vitest';
import type { CandidateEvent, ProjectId } from '@agent-music/contracts';
import { getFakeCoreFixture } from '../src/renderer/core-client/fake-core-fixtures.js';
import { projectCandidateEvents } from '../src/renderer/core-client/candidate-event-projection.js';

const projectId = '00000000-0000-4000-8000-000000000001' as ProjectId;
const candidateId = '00000000-0000-4000-8000-000000000002' as never;
const taskId = '00000000-0000-4000-8000-000000000003' as never;

describe('Candidate event projection', () => {
  it('projects A3 start events into the B2 store shape without exposing worktree data', () => {
    const events = [
      {
        type: 'task.changed',
        requestId: 'start-1',
        sequence: 1,
        task: {
          taskId,
          projectId,
          candidateId,
          baseRevision: 'revision-1',
          scope: { type: 'wholeProject', trackIds: ['track.guitar'] },
          scopeRevision: 0,
          state: 'editing',
          candidateState: 'active',
          allowedOperations: ['replaceScopedMusic'],
          trackIds: [
            'track.drums',
            'track.bass',
            'track.guitar',
            'track.keys',
            'track.strings',
            'track.winds',
          ],
          createdAt: '2026-09-09T00:00:00.000Z',
        },
      },
      {
        type: 'candidate.changed',
        requestId: 'start-1',
        sequence: 2,
        candidate: {
          candidateId,
          projectId,
          baseRevision: 'revision-1',
          state: 'active',
        },
      },
    ] satisfies readonly CandidateEvent[];

    const projection = projectCandidateEvents(
      projectId,
      getFakeCoreFixture('stable'),
      events,
    );

    expect(projection.currentReloadRequired).toBe(false);
    expect(projection.events).toMatchObject([
      { type: 'taskChanged', task: { status: 'active', taskId } },
      {
        type: 'candidateChanged',
        candidate: { status: 'building', candidateId, taskId },
      },
    ]);
  });

  it('clears Candidate review after A3 accepts but requires a real Current reload', () => {
    const projection = projectCandidateEvents(
      projectId,
      getFakeCoreFixture('candidate'),
      [
        {
          type: 'candidate.currentCommitted',
          requestId: 'accept-1',
          sequence: 1,
          result: { projectId, candidateId, currentRevision: 'revision-2' },
        },
      ],
    );

    expect(projection.currentReloadRequired).toBe(true);
    expect(projection.events).toMatchObject([
      { type: 'taskChanged', task: { status: 'idle' } },
      { type: 'candidateChanged', candidate: { status: 'none' } },
    ]);
  });
});
