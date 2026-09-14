import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSwitchConfirmation } from '../src/renderer/workspace/project-switch-confirmation.js';
import type { ProjectId } from '@agent-music/contracts';

(globalThis as unknown as { React: typeof React }).React = React;

describe('ProjectSwitchConfirmation presentation', () => {
  const sourceId = 'proj-1' as ProjectId;
  const targetPath = '/path/to/second-project';

  it('displays standard confirmation when there is no active work', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSwitchConfirmation, {
        source: sourceId,
        target: targetPath,
        sourceName: 'First Song',
        targetName: 'Second Song',
        activeExecution: false,
        activeTask: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('Switch Project?');
    expect(html).toContain('Are you sure you want to open another project?');
    expect(html).toContain('First Song');
    expect(html).toContain('Second Song');
    expect(html).toContain('primary-action');
    expect(html).not.toContain('destructive-action');
    expect(html).toContain('Switch Project</button>');
  });

  it('displays warning with cancellation copy when there is active execution and canSuspend is false', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSwitchConfirmation, {
        source: sourceId,
        target: targetPath,
        activeExecution: true,
        activeTask: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('Switch Project?');
    expect(html).toContain('Switching projects will cancel the active work in progress.');
    expect(html).toContain('destructive-action');
    expect(html).toContain('Switch &amp; Cancel Work');
    expect(html).not.toContain('Switch &amp; Suspend');
  });

  it('displays warning with suspend copy only when canSuspend is explicitly true', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSwitchConfirmation, {
        source: sourceId,
        target: targetPath,
        canSuspend: true,
        activeExecution: true,
        activeTask: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('Switching projects will suspend the active work.');
    expect(html).toContain('destructive-action');
    expect(html).toContain('Switch &amp; Suspend');
  });

  it('displays warning when there is an active task', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSwitchConfirmation, {
        source: sourceId,
        target: targetPath,
        activeExecution: false,
        activeTask: true,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('Switching projects will cancel the active work in progress.');
    expect(html).toContain('destructive-action');
    expect(html).toContain('Switch &amp; Cancel Work');
  });

  it('renders source and target names accurately in the details section', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSwitchConfirmation, {
        source: sourceId,
        target: targetPath,
        sourceName: 'Midnight Sketch',
        targetName: 'Morning Echoes',
        activeExecution: false,
        activeTask: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('confirmation-dialog__details');
    expect(html).toContain('From:');
    expect(html).toContain('Midnight Sketch');
    expect(html).toContain('To:');
    expect(html).toContain('Morning Echoes');
  });
});
