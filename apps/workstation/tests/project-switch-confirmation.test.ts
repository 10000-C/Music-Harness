import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSwitchConfirmation } from '../src/renderer/workspace/project-switch-confirmation.js';

(globalThis as unknown as { React: typeof React }).React = React;

describe('ProjectSwitchConfirmation presentation', () => {
  it('displays standard confirmation when there is no active work', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSwitchConfirmation, {
        source: 'proj-1' as any,
        target: 'proj-2' as any,
        activeExecution: false,
        activeTask: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('Switch Project?');
    expect(html).toContain('Are you sure you want to open another project?');
    expect(html).toContain('primary-action');
    expect(html).not.toContain('destructive-action');
  });

  it('displays warning when there is an active execution', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSwitchConfirmation, {
        source: 'proj-1' as any,
        target: 'proj-2' as any,
        activeExecution: true,
        activeTask: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('Switch Project?');
    expect(html).toContain('active Agent or Task running');
    expect(html).toContain('destructive-action');
    expect(html).toContain('Switch &amp; Suspend');
  });

  it('displays warning when there is an active task', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSwitchConfirmation, {
        source: 'proj-1' as any,
        target: 'proj-2' as any,
        activeExecution: false,
        activeTask: true,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('active Agent or Task running');
    expect(html).toContain('destructive-action');
  });
});
