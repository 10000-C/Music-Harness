import type {
  OperationId,
  ProjectId,
  ScopeExtensionRequestId,
  TaskId,
} from '@agent-music/contracts';
import { describe, expect, it } from 'vitest';

import { createFailClosedConfirmation } from './fail-closed-confirmation.js';

const operationId = '11111111-1111-4111-8111-111111111111' as OperationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const taskId = '33333333-3333-4333-8333-333333333333' as TaskId;

describe('createFailClosedConfirmation', () => {
  it('rejects every generation-plan confirmation immediately', async () => {
    const { generationPlan } = createFailClosedConfirmation();
    await expect(
      generationPlan.request({
        operationId,
        projectId,
        summary: 'plan',
        scope: { type: 'wholeProject', trackIds: ['track.drums'] },
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('rejected');
  });

  it('rejects every scope-extension confirmation immediately', async () => {
    const { scopeExtension } = createFailClosedConfirmation();
    await expect(
      scopeExtension.request({
        operationId,
        request: {
          operationId,
          taskId,
          requestId: 'request-1' as ScopeExtensionRequestId,
          fromScopeRevision: 0,
          requestedScope: {
            type: 'wholeProject',
            trackIds: ['track.drums'],
          },
          createdAt: '2026-09-15T00:00:00.000Z',
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('rejected');
  });
});
