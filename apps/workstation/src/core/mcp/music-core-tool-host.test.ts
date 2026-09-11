import type {
  CandidateId,
  OperationId,
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
  type ScopeExtensionConfirmationPort,
} from './music-core-tool-host.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const taskId = '22222222-2222-4222-8222-222222222222' as TaskId;
const candidateId = '33333333-3333-4333-8333-333333333333' as CandidateId;
const generationOperationId =
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OperationId;
const scopeOperationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OperationId;
const scopeRequestId =
  '44444444-4444-4444-8444-444444444444' as ScopeExtensionRequestId;
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
    operationId: scopeOperationId,
    taskId,
    requestId: scopeRequestId,
    fromScopeRevision: 0,
    requestedScope: scope,
    createdAt: '2026-09-09T00:00:01.000Z',
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
  const approveScopeExtension = vi.fn().mockResolvedValue({
    ...taskContext,
    scopeRevision: 1,
  });
  const rejectScopeExtension = vi.fn().mockResolvedValue(taskContext);
  const generationPlanRequest = vi.fn().mockResolvedValue('approved');
  const scopeExtensionRequest = vi.fn().mockResolvedValue('approved');

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
    approveScopeExtension,
    rejectScopeExtension,
    acceptCandidate: vi.fn(),
    rejectCandidate: vi.fn(),
    reconcileProjectResources: vi.fn(),
  };
  const generationPlanConfirmation: GenerationPlanConfirmationPort = {
    request: generationPlanRequest,
  };
  const scopeExtensionConfirmation: ScopeExtensionConfirmationPort = {
    request: scopeExtensionRequest,
  };

  return {
    host: new MusicCoreToolHost({
      agent,
      control,
      generationPlanConfirmation,
      scopeExtensionConfirmation,
      now: () => '2026-09-09T00:00:02.000Z',
    }),
    mocks: {
      getTaskContext,
      getScopedComposition,
      requestScopeExtension,
      applyScopedMusicChange,
      updateMusicalProperties,
      resizeComposition,
      finishTask,
      startTask,
      approveScopeExtension,
      rejectScopeExtension,
      generationPlanRequest,
      scopeExtensionRequest,
    },
  };
};

describe('MusicCoreToolHost operations', () => {
  it('exposes exactly the ten P0 Agent tools', () => {
    const { host } = makeHarness();
    expect(host.listTools()).toEqual(P0_MCP_TOOL_NAMES);
  });

  it('returns a generation-plan operation immediately and preserves its Task result for later recovery', async () => {
    let resolveDecision: ((value: 'approved') => void) | undefined;
    const { host, mocks } = makeHarness();
    mocks.generationPlanRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveDecision = resolve;
      }),
    );

    await expect(
      host.call('submitGenerationPlan', {
        operationId: generationOperationId,
        projectId,
        summary: 'Build a six-track groove.',
        scope,
      }),
    ).resolves.toMatchObject({
      operationId: generationOperationId,
      type: 'generationPlan',
      state: 'pending',
    });
    expect(mocks.startTask).not.toHaveBeenCalled();

    resolveDecision?.('approved');
    await vi.waitFor(async () => {
      await expect(
        host.call('getOperation', { operationId: generationOperationId }),
      ).resolves.toMatchObject({
        state: 'succeeded',
        result: { task: taskContext },
      });
    });
    expect(mocks.startTask).toHaveBeenCalledTimes(1);

    await expect(
      host.call('submitGenerationPlan', {
        operationId: generationOperationId,
        projectId,
        summary: 'Build a six-track groove.',
        scope,
      }),
    ).resolves.toMatchObject({
      state: 'succeeded',
      result: { task: taskContext },
    });
    expect(mocks.startTask).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending generation-plan operation without relying on transport abort', async () => {
    const { host, mocks } = makeHarness();
    mocks.generationPlanRequest.mockImplementation(
      ({ signal }: Parameters<GenerationPlanConfirmationPort['request']>[0]) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve('cancelled');
            },
            { once: true },
          );
        }),
    );

    await host.call('submitGenerationPlan', {
      operationId: generationOperationId,
      projectId,
      summary: 'Build a six-track groove.',
      scope,
    });
    await expect(
      host.call('cancelOperation', { operationId: generationOperationId }),
    ).resolves.toMatchObject({ state: 'cancelled' });
    expect(mocks.startTask).not.toHaveBeenCalled();
  });

  it('creates a recoverable Scope Extension operation and generic cancellation retracts A3 pending state', async () => {
    const { host, mocks } = makeHarness();
    mocks.scopeExtensionRequest.mockImplementation(
      ({ signal }: Parameters<ScopeExtensionConfirmationPort['request']>[0]) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve('cancelled');
            },
            { once: true },
          );
        }),
    );

    await expect(
      host.call('requestScopeExtension', {
        operationId: scopeOperationId,
        envelope,
        requestedScope: scope,
      }),
    ).resolves.toMatchObject({
      operationId: scopeOperationId,
      type: 'scopeExtension',
      state: 'pending',
      request: { operationId: scopeOperationId, requestId: scopeRequestId },
    });
    expect(mocks.requestScopeExtension).toHaveBeenCalledWith({
      operationId: scopeOperationId,
      envelope,
      requestedScope: scope,
    });

    await expect(
      host.call('cancelOperation', { operationId: scopeOperationId }),
    ).resolves.toMatchObject({ state: 'cancelled' });
    expect(mocks.rejectScopeExtension).toHaveBeenCalledWith({
      taskId,
      requestId: scopeRequestId,
    });
  });

  it('rejects reusing an operationId for different input', async () => {
    const { host } = makeHarness();
    await host.call('submitGenerationPlan', {
      operationId: generationOperationId,
      projectId,
      summary: 'First plan',
      scope,
    });
    await expect(
      host.call('submitGenerationPlan', {
        operationId: generationOperationId,
        projectId,
        summary: 'Different plan',
        scope,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  });

  it('delegates synchronous Task-bound reads and writes directly to A3', async () => {
    const { host, mocks } = makeHarness();
    const replacements: readonly TrackReplacement[] = [
      { trackId: 'track.bass', abc: 'C2' },
    ];

    await host.call('getTaskContext', { taskId });
    await host.call('getScopedComposition', envelope);
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
