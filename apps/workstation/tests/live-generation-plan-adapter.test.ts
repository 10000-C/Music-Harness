import {
  TRACK_IDS,
  type GenerationPlanOperationView,
  type OperationId,
  type ProjectId,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createFakeOperationBridge } from '../src/renderer/core-client/fake-operation-bridge.js';
import {
  createLiveGenerationPlanAdapter,
  generationPlanOperationId,
  generationPlanTask,
} from '../src/renderer/core-client/live-generation-plan-adapter.js';
import { operationList } from '../src/renderer/core-client/fake-operation-bridge.js';

const projectId = '00000000-0000-4000-8000-000000000201' as ProjectId;
const operationId = '00000000-0000-4000-8000-000000000202' as OperationId;
const pending: GenerationPlanOperationView = {
  operationId,
  type: 'generationPlan',
  state: 'pending',
  createdAt: '2026-09-14T00:00:00.000Z',
  summary: 'Make the chorus wider and more weightless.',
  scope: { type: 'wholeProject', trackIds: TRACK_IDS },
};

describe('live generation-plan adapter', () => {
  it('reads the Core snapshot, filters generation plans, and resolves approve/reject through the typed seam', async () => {
    const dispatchOperation = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, operation: { ...pending, state: 'succeeded', result: { task: {} } } as unknown as GenerationPlanOperationView })
      .mockResolvedValueOnce({ ok: true as const, operation: { ...pending, state: 'rejected' } as GenerationPlanOperationView });
    const bridge = createFakeOperationBridge(
      { projectId, sequence: 4, operations: operationList(pending) },
      dispatchOperation,
    );
    const adapter = createLiveGenerationPlanAdapter({
      projectId,
      bridge,
      createRequestId: () => 'resolve-1',
    });

    await adapter.ready();
    expect(adapter.getState().operation).toEqual(pending);
    await adapter.approve();
    expect(dispatchOperation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'operation.resolve',
        operationId,
        decision: 'approve',
      }),
    );
    adapter.applyOperation(pending);
    await adapter.reject();
    expect(dispatchOperation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ operationId, decision: 'reject' }),
    );
  });

  it('ignores another project, stale/duplicate events, and non-generation operations', async () => {
    const bridge = createFakeOperationBridge({
      projectId,
      sequence: 1,
      operations: operationList(pending),
    });
    const adapter = createLiveGenerationPlanAdapter({ projectId, bridge });
    await adapter.ready();
    const listener = vi.fn();
    adapter.subscribe(listener);

    bridge.emit({
      type: 'operationState.event',
      protocolVersion: 1,
      projectId: '00000000-0000-4000-8000-000000000299' as ProjectId,
      sequence: 2,
      operation: pending,
    });
    bridge.emit({
      type: 'operationState.event',
      protocolVersion: 1,
      projectId,
      sequence: 2,
      operation: pending,
    });
    bridge.emit({
      type: 'operationState.event',
      protocolVersion: 1,
      projectId,
      sequence: 3,
      operation: {
        operationId,
        type: 'scopeExtension',
        state: 'pending',
        createdAt: pending.createdAt,
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(adapter.getState().operation).toEqual(pending);
  });

  it('fails closed when no pending generation plan exists and exposes terminal task/error state', async () => {
    const succeeded = {
      ...pending,
      state: 'succeeded',
      result: { task: { taskId: 'task' } },
    } as unknown as GenerationPlanOperationView;
    const failed = {
      ...pending,
      state: 'failed',
      error: { code: 'PLAN_FAILED', message: 'Plan failed safely.' },
    } as GenerationPlanOperationView;
    const bridge = createFakeOperationBridge({
      projectId,
      sequence: 1,
      operations: operationList(succeeded),
    });
    const adapter = createLiveGenerationPlanAdapter({ projectId, bridge });
    await adapter.ready();
    await expect(adapter.approve()).rejects.toThrow('unavailable');
    expect(generationPlanOperationId(adapter.getState().operation)).toBe(
      operationId,
    );
    expect(generationPlanTask(succeeded)).toMatchObject({ taskId: 'task' });

    adapter.applyOperation(failed);
    expect(adapter.getState().error).toEqual({
      code: 'PLAN_FAILED',
      message: 'Plan failed safely.',
    });
  });
});
