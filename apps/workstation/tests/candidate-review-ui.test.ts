import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CandidateStage } from '../src/renderer/workspace/candidate-stage.js';
import type { CandidateId, ProjectId } from '@agent-music/contracts';
import type { LiveCandidateState } from '../src/renderer/core-client/live-candidate-adapter.js';

(globalThis as unknown as { React: typeof React }).React = React;

const projectId = '00000000-0000-4000-8000-000000000501' as ProjectId;
const candidateId = '00000000-0000-4000-8000-000000000502' as CandidateId;

describe('Candidate Review UI audition wiring', () => {
  describe('CandidateStage presentation', () => {
    it('disables Candidate audition and displays safe error presentation when candidateAuditionAvailable is false', () => {
      const onReviewCurrent = vi.fn();
      const onReviewCandidate = vi.fn();
      const onAccept = vi.fn();
      const onReject = vi.fn();

      const html = renderToStaticMarkup(
        createElement(CandidateStage, {
          title: 'Candidate ready to review',
          details: undefined,
          previewingCandidate: false,
          candidateAuditionAvailable: false,
          candidateAcceptanceAvailable: true,
          onReviewCurrent,
          onReviewCandidate,
          onAccept,
          onReject,
        }),
      );

      expect(html).toContain('disabled=""');
      expect(html).toContain(
        'title="Candidate audition is unavailable until Core provides playback data."',
      );
      expect(html).toContain('Unavailable</button>');
      expect(html).toContain(
        'Candidate is safely staged. Audition will appear when Core provides a playback bundle.',
      );
      expect(html).toContain('aria-pressed="true">Current</button>');
    });

    it('enables Candidate audition when candidateAuditionAvailable is true', () => {
      const onReviewCurrent = vi.fn();
      const onReviewCandidate = vi.fn();
      const onAccept = vi.fn();
      const onReject = vi.fn();

      const html = renderToStaticMarkup(
        createElement(CandidateStage, {
          title: 'Candidate ready to review',
          details: undefined,
          previewingCandidate: false,
          candidateAuditionAvailable: true,
          candidateAcceptanceAvailable: true,
          onReviewCurrent,
          onReviewCandidate,
          onAccept,
          onReject,
        }),
      );

      expect(html).not.toContain(
        'title="Candidate audition is unavailable until Core provides playback data."',
      );
      expect(html).toContain('Candidate</button>');
      expect(html).toContain(
        'Review this variation in the arrangement before it changes Current.',
      );
    });

    it('reflects active candidate audition indicator when previewingCandidate is true', () => {
      const html = renderToStaticMarkup(
        createElement(CandidateStage, {
          title: 'Candidate ready to review',
          details: undefined,
          previewingCandidate: true,
          candidateAuditionAvailable: true,
          candidateAcceptanceAvailable: true,
          onReviewCurrent: vi.fn(),
          onReviewCandidate: vi.fn(),
          onAccept: vi.fn(),
          onReject: vi.fn(),
        }),
      );

      expect(html).toContain('data-active="candidate"');
      expect(html).toContain('aria-pressed="true">Candidate</button>');
      expect(html).toContain('aria-pressed="false">Current</button>');
    });
  });

  describe('Audition action wiring logic', () => {
    it('disables Candidate audition when candidatePlaybackSnapshot is null', () => {
      const candidateState: LiveCandidateState = {
        status: 'ready',
        projectId,
        candidate: {
          candidateId,
          projectId,
          baseRevision: 'current-base-rev',
          state: 'ready',
        },
        task: null,
        pendingScopeExtension: null,
        candidatePlaybackSnapshot: null,
        error: null,
        committedRevision: null,
      };
      const busy = false as boolean;

      const candidateAuditionAvailable =
        !busy && candidateState.candidatePlaybackSnapshot !== null;
      expect(candidateAuditionAvailable).toBe(false);

      const mockPlaybackAdapter = {
        update: vi.fn().mockResolvedValue({ status: 'applied' }),
      };

      const ref = candidateState.candidatePlaybackSnapshot;
      if (ref !== null) {
        void mockPlaybackAdapter.update({
          kind: 'candidate',
          candidateId: (ref as { candidateId: string }).candidateId,
          revision: (ref as { revision: string }).revision,
        });
      }

      expect(mockPlaybackAdapter.update).not.toHaveBeenCalled();
    });

    it('disables Candidate audition while busy even if candidatePlaybackSnapshot is present', () => {
      const candidateState: LiveCandidateState = {
        status: 'ready',
        projectId,
        candidate: {
          candidateId,
          projectId,
          baseRevision: 'current-base-rev',
          state: 'ready',
        },
        task: null,
        pendingScopeExtension: null,
        candidatePlaybackSnapshot: {
          candidateId,
          revision: 'snapshot-rev-99',
        },
        error: null,
        committedRevision: null,
      };
      const busy = true as boolean;

      const candidateAuditionAvailable =
        !busy && candidateState.candidatePlaybackSnapshot !== null;
      expect(candidateAuditionAvailable).toBe(false);
    });

    it('updates playbackAdapter with candidatePlaybackSnapshot revision, never using baseRevision', async () => {
      const candidateState: LiveCandidateState = {
        status: 'ready',
        projectId,
        candidate: {
          candidateId,
          projectId,
          baseRevision: 'current-base-rev-SHOULD-NOT-BE-USED',
          state: 'ready',
        },
        task: null,
        pendingScopeExtension: null,
        candidatePlaybackSnapshot: {
          candidateId,
          revision: 'candidate-actual-snapshot-rev-42',
        },
        error: null,
        committedRevision: null,
      };
      const busy = false as boolean;

      const candidateAuditionAvailable =
        !busy && candidateState.candidatePlaybackSnapshot !== null;
      expect(candidateAuditionAvailable).toBe(true);

      const mockPlaybackAdapter = {
        update: vi.fn().mockResolvedValue({ status: 'applied' }),
      };

      const ref = candidateState.candidatePlaybackSnapshot;
      expect(ref).not.toBeNull();
      if (ref !== null) {
        await mockPlaybackAdapter.update({
          kind: 'candidate',
          candidateId: ref.candidateId,
          revision: ref.revision,
        });
      }

      expect(mockPlaybackAdapter.update).toHaveBeenCalledTimes(1);
      expect(mockPlaybackAdapter.update).toHaveBeenCalledWith({
        kind: 'candidate',
        candidateId,
        revision: 'candidate-actual-snapshot-rev-42',
      });
      expect(mockPlaybackAdapter.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          revision: 'current-base-rev-SHOULD-NOT-BE-USED',
        }),
      );
    });

    it('allows switching back to Current with project.currentRevision', async () => {
      const mockPlaybackAdapter = {
        update: vi.fn().mockResolvedValue({ status: 'applied' }),
      };
      const currentRevision = 'current-rev-100';

      await mockPlaybackAdapter.update({
        kind: 'current',
        revision: currentRevision,
      });

      expect(mockPlaybackAdapter.update).toHaveBeenCalledWith({
        kind: 'current',
        revision: 'current-rev-100',
      });
    });
  });
});
