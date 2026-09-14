import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GenerationPlanStage } from '../src/renderer/workspace/generation-plan-stage.js';
import type { GenerationPlanOperationView } from '@agent-music/contracts';

(globalThis as unknown as { React: typeof React }).React = React;

describe('GenerationPlanStage presentation', () => {
  const operation: Extract<GenerationPlanOperationView, { state: 'pending' }> = {
    type: 'generationPlan',
    state: 'pending',
    operationId: 'op-1' as any,
    createdAt: '2026-09-14T00:00:00Z',
    summary: 'Generate a funky bassline',
    scope: { type: 'wholeProject', trackIds: [] },
  };

  it('displays the generation plan summary and handles approve and reject', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationPlanStage, {
        operation,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('Generate a funky bassline');
    expect(html).toContain('Approve Plan</button>');
    expect(html).toContain('Reject</button>');
    expect(html).toContain('Generation Plan Ready');
    expect(html).not.toContain('disabled=""');
  });

  it('disables actions when busy to represent a pending terminal/transition state', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationPlanStage, {
        operation,
        busy: true,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('Processing request...');
  });
});
