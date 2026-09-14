import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GenerationPlanStage } from '../src/renderer/workspace/generation-plan-stage.js';
import type {
  GenerationPlanOperationView,
  OperationId,
  Tick,
} from '@agent-music/contracts';
import type { RendererTimelineViewModel as TimelineViewModel } from '../src/renderer/b-contracts/index.js';

(globalThis as unknown as { React: typeof React }).React = React;

describe('GenerationPlanStage presentation', () => {
  const operation: Extract<GenerationPlanOperationView, { state: 'pending' }> =
    {
      type: 'generationPlan',
      state: 'pending',
      operationId: 'op-1' as OperationId,
      createdAt: '2026-09-14T00:00:00Z',
      summary: 'Generate a funky bassline',
      scope: { type: 'wholeProject', trackIds: [] },
    };

  const timeline: TimelineViewModel = {
    schemaVersion: 1,
    revision: 'rev-1',
    ticksPerQuarter: 480,
    totalTicks: 7680 as Tick,
    tempoMap: [{ tick: 0 as Tick, bpm: 120 }],
    meterMap: [{ tick: 0 as Tick, numerator: 4, denominator: 4 }],
    keyMap: [{ tick: 0 as Tick, tonic: 'C', mode: 'major' }],
    tracks: [],
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

  it('displays whole project scope with no track limits', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationPlanStage, {
        operation,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('全工程');
    expect(html).toContain('All tracks');
  });

  it('displays tick range when timeline is null or omitted', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationPlanStage, {
        operation: {
          ...operation,
          scope: {
            type: 'timeRange',
            startTick: 0 as Tick,
            endTick: 1920 as Tick,
            trackIds: ['track.guitar', 'track.bass'],
          },
        },
        timeline: null,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('Ticks 0–1920');
    expect(html).toContain('track.guitar, track.bass');
  });

  it('displays musical bar range when timeline is provided', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationPlanStage, {
        operation: {
          ...operation,
          scope: {
            type: 'timeRange',
            startTick: 0 as Tick,
            endTick: 1920 as Tick,
            trackIds: ['track.bass'],
          },
        },
        timeline,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('Bars 1–2');
    expect(html).toContain('track.bass');
  });
});
