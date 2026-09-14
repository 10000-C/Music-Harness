import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ScopeExtensionStage } from '../src/renderer/workspace/scope-extension-stage.js';

(globalThis as unknown as { React: typeof React }).React = React;

describe('ScopeExtensionStage presentation', () => {
  const pendingScopeExtension = {
    operationId: 'op-1' as any,
    taskId: 'task-1' as any,
    requestId: 'req-1' as any,
    fromScopeRevision: 42,
    requestedScope: { type: 'wholeProject' as const, trackIds: [] },
    createdAt: '2026-09-14T00:00:00Z',
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
});
