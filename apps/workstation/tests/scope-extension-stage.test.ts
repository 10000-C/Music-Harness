import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ScopeExtensionStage } from '../src/renderer/workspace/scope-extension-stage.js';
import type {
  OperationId,
  ScopeExtensionRequestId,
  TaskId,
  Tick,
} from '@agent-music/contracts';
import type { RendererTimelineViewModel as TimelineViewModel } from '../src/renderer/b-contracts/index.js';

(globalThis as unknown as { React: typeof React }).React = React;

describe('ScopeExtensionStage presentation', () => {
  const pendingScopeExtension = {
    operationId: 'op-1' as OperationId,
    taskId: 'task-1' as TaskId,
    requestId: 'req-1' as ScopeExtensionRequestId,
    fromScopeRevision: 42,
    requestedScope: { type: 'wholeProject' as const, trackIds: [] },
    createdAt: '2026-09-14T00:00:00Z',
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

  it('displays the scope extension request and handles approve and reject', () => {
    const html = renderToStaticMarkup(
      createElement(ScopeExtensionStage, {
        pendingScopeExtension,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('Allow broader access?');
    expect(html).toContain('Approve Scope</button>');
    expect(html).toContain('Reject</button>');
    expect(html).toContain('Scope Extension Requested');
    expect(html).not.toContain('disabled=""');
  });

  it('disables actions when busy to represent a pending terminal/transition state', () => {
    const html = renderToStaticMarkup(
      createElement(ScopeExtensionStage, {
        pendingScopeExtension,
        busy: true,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('Processing request...');
  });

  it('displays scope and revision information', () => {
    const html = renderToStaticMarkup(
      createElement(ScopeExtensionStage, {
        pendingScopeExtension,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('全工程');
    expect(html).toContain('All tracks');
    expect(html).toContain('From Revision:</strong> 42');
  });

  it('displays strong confirmation text', () => {
    const html = renderToStaticMarkup(
      createElement(ScopeExtensionStage, {
        pendingScopeExtension,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('Strong Confirmation:');
    expect(html).toContain('modify the requested areas');
  });

  it('displays safe tick range when timeline is null or omitted', () => {
    const html = renderToStaticMarkup(
      createElement(ScopeExtensionStage, {
        pendingScopeExtension: {
          ...pendingScopeExtension,
          requestedScope: {
            type: 'timeRange' as const,
            startTick: 960 as Tick,
            endTick: 2880 as Tick,
            trackIds: ['track.drums'],
          },
        },
        timeline: null,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('Ticks 960–2880');
    expect(html).toContain('track.drums');
  });

  it('displays bars range when timeline is provided', () => {
    const html = renderToStaticMarkup(
      createElement(ScopeExtensionStage, {
        pendingScopeExtension: {
          ...pendingScopeExtension,
          requestedScope: {
            type: 'timeRange' as const,
            startTick: 960 as Tick,
            endTick: 2880 as Tick,
            trackIds: ['track.drums'],
          },
        },
        timeline,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('Bars 1–3');
    expect(html).toContain('track.drums');
  });
});
