import type {
  CandidateId,
  ProjectId,
  ScopeExtensionRequestId,
  TaskExecutionEnvelope,
  TaskId,
  TaskScope,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { TrackReplacement } from '../composition/index.js';
import type {
  CandidateAgentPort,
  CandidateControlPort,
} from '../candidate/index.js';
import {
  MusicCoreToolHost,
  P0_MCP_TOOL_NAMES,
  type GenerationPlanConfirmationPort,
} from './music-core-tool-host.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const taskId = '22222222-2222-4222-8222-222222222222' as TaskId;
const candidateId = '33333333-3333-4333-8333-333333333333' as CandidateId;
const scope: TaskScope = {
  type: 'wholeProject',
  trackIds: [
    'track.drums',
    'track.bass',
    'track.guitar',
    'track.keys',
    'track.strings',
    'track.winds',
  ],
};
const taskContext = {
  taskId,
  projectId,
  candidateId,
  baseRevision: 'abc123',
  scope,
  scopeRevision: 0,
  state: 'editing' as const,
  candidateState: 'active' as const,
  allowedOperations: [
    'replaceScopedMusic',
    'updateMusicalProperties',
    'resizeComposition',
  ] as const,
  trackIds: scope.trackIds,
  createdAt: '2026-09-09T00:00:00.000Z',
};
const envelope: TaskExecutionEnvelope = {
  taskId,
  projectId,
  candidateId,
  baseRevision: 'abc123',
  expectedScopeRevision: 0,
};

const makeHarness = () => {
  const getTaskContext = vi.fn().mockResolvedValue(taskContext);
  const getScopedComposition = vi.fn().mockResolvedValue({});
  const requestScopeExtension = vi.fn().mockResolvedValue({
    taskId,
    requestId:
      '44444444-4444-4444-8444-444444444444' as ScopeExtensionRequestId,
    fromScopeRevision: 0,
    requestedScope: scope,
  });
  const applyScopedMusicChange = vi.fn().mockResolvedValue({});
  const updateMusicalProperties = vi.fn().mockResolvedValue({});
  const resizeComposition = vi.fn().mockResolvedValue({});
  const finishTask = vi.fn().mockResolvedValue({
    candidate: {
      candidateId,
      projectId,
      baseRevision: 'abc123',
      state: 'ready',
    },
    validation: { valid: true, issues: [] },
  });
  const startTask = vi.fn().mockResolvedValue(taskContext);
  const confirmationRequest = vi.fn().mockResolvedValue('approved');

  const agent: CandidateAgentPort = {
    getTaskContext,
    getScopedComposition,
    requestScopeExtension,
    applyScopedMusicChange,
    updateMusicalProperties,
    resizeComposition,
    finishTask,
  };
  const control: CandidateControlPort = {
    startTask,
    cancelTask: vi.fn(),
    cancelActiveTaskForAgentLoss: vi.fn(),
    approveScopeExtension: vi.fn(),
    rejectScopeExtension: vi.fn(),
    acceptCandidate: vi.fn(),
    rejectCandidate: vi.fn(),
    reconcileProjectResources: vi.fn(),
  };
  const confirmation: GenerationPlanConfirmationPort = {
    request: confirmationRequest,
  };

  return {
    host: new MusicCoreToolHost({ agent, control, confirmation }),
    mocks: {
      getTaskContext,
      getScopedComposition,
      requestScopeExtension,
      applyScopedMusicChange,
      updateMusicalProperties,
      resizeComposition,
      finishTask,
      startTask,
      confirmationRequest,
    },
  };
};

describe('MusicCoreToolHost', () => {
  it('exposes exactly the eight P0 Agent tools', () => {
    const { host } = makeHarness();
    expect(host.listTools()).toEqual(P0_MCP_TOOL_NAMES);
  });

  it('keeps submitGenerationPlan pending until confirmation and only then starts a Task', async () => {
    let resolveDecision: ((value: 'approved') => void) | undefined;
    const { host, mocks } = makeHarness();
    mocks.confirmationRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveDecision = resolve;
      }),
    );

    const pending = host.call('submitGenerationPlan', {
      projectId,
      summary: 'Build a six-track groove.',
      scope,
    });
    await Promise.resolve();

    expect(mocks.startTask).not.toHaveBeenCalled();
    resolveDecision?.('approved');
    await expect(pending).resolves.toEqual({
      approved: true,
      task: taskContext,
    });
    expect(mocks.startTask).toHaveBeenCalledWith({ projectId, scope });
  });

  it('cancels a pending generation plan without creating a Task even if approval arrives later', async () => {
    let resolveDecision: ((value: 'approved') => void) | undefined;
    const { host, mocks } = makeHarness();
    const abortController = new AbortController();
    mocks.confirmationRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveDecision = resolve;
      }),
    );

    const pending = host.call(
      'submitGenerationPlan',
      {
        projectId,
        summary: 'Build a six-track groove.',
        scope,
      },
      { signal: abortController.signal },
    );
    await Promise.resolve();
    abortController.abort();

    await expect(pending).resolves.toEqual({
      approved: false,
      decision: 'cancelled',
    });
    expect(mocks.startTask).not.toHaveBeenCalled();

    resolveDecision?.('approved');
    await Promise.resolve();
    expect(mocks.startTask).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'cancelled'] as const)(
    'does not create a Task when generation plan is %s',
    async (decision) => {
      const { host, mocks } = makeHarness();
      mocks.confirmationRequest.mockResolvedValue(decision);

      await expect(
        host.call('submitGenerationPlan', {
          projectId,
          summary: 'Build a six-track groove.',
          scope,
        }),
      ).resolves.toEqual({ approved: false, decision });
      expect(mocks.startTask).not.toHaveBeenCalled();
    },
  );

  it('delegates Task-bound reads and writes to the A3 Agent port', async () => {
    const { host, mocks } = makeHarness();
    const replacements: readonly TrackReplacement[] = [
      { trackId: 'track.bass', abc: 'C2' },
    ];

    await host.call('getTaskContext', { taskId });
    await host.call('getScopedComposition', envelope);
    await host.call('requestScopeExtension', {
      envelope,
      requestedScope: scope,
    });
    await host.call('replaceScopedMusic', { envelope, replacements });
    await host.call('updateMusicalProperties', {
      envelope,
      meter: { numerator: 3, denominator: 4 },
      tempo: { bpm: 100 },
    });
    await host.call('resizeComposition', { envelope, targetMeasureCount: 64 });
    await host.call('finishTask', envelope);

    expect(mocks.getTaskContext).toHaveBeenCalledWith(taskId);
    expect(mocks.getScopedComposition).toHaveBeenCalledWith(envelope);
    expect(mocks.requestScopeExtension).toHaveBeenCalledWith({
      envelope,
      requestedScope: scope,
    });
    expect(mocks.applyScopedMusicChange).toHaveBeenCalledWith({
      envelope,
      replacements,
    });
    expect(mocks.updateMusicalProperties).toHaveBeenCalledWith({
      envelope,
      meter: { numerator: 3, denominator: 4 },
      tempo: { bpm: 100 },
    });
    expect(mocks.resizeComposition).toHaveBeenCalledWith({
      envelope,
      targetMeasureCount: 64,
    });
    expect(mocks.finishTask).toHaveBeenCalledWith(envelope);
  });
});
