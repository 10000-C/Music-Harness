import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSidebar } from './project-sidebar.js';

(globalThis as unknown as { React: typeof React }).React = React;

describe('ProjectSidebar presentation', () => {
  it('displays project card with name, label, and switch indicator when project is open', () => {
    const onViewChange = vi.fn();
    const onSwitchProject = vi.fn();

    const html = renderToStaticMarkup(
      createElement(ProjectSidebar, {
        activeView: 'studio',
        projectName: 'Midnight Sketch',
        currentLabel: 'Current · 78c9df41',
        projectOpen: true,
        busy: false,
        onViewChange,
        onSwitchProject,
      }),
    );

    expect(html).toContain('Midnight Sketch');
    expect(html).toContain('Current · 78c9df41');
    expect(html).toContain('project-card');
    expect(html).toContain('project-card__info');
    expect(html).toContain('project-card__action');
    expect(html).toContain('title="Switch or open project"');
    expect(html).toContain('aria-label="Switch project: Midnight Sketch"');
    expect(html).not.toContain('disabled=""');
  });

  it('disables the project switch card when busy is true', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSidebar, {
        activeView: 'studio',
        projectName: 'Midnight Sketch',
        currentLabel: 'Current · 78c9df41',
        projectOpen: true,
        busy: true,
        onViewChange: vi.fn(),
      }),
    );

    expect(html).toContain('disabled=""');
  });

  it('omits the project card section when projectOpen is false', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSidebar, {
        activeView: 'studio',
        projectName: 'No project open',
        currentLabel: 'Choose a project folder to begin',
        projectOpen: false,
        onViewChange: vi.fn(),
      }),
    );

    expect(html).not.toContain('project-card');
    expect(html).not.toContain('Midnight Sketch');
  });

  it('renders navigation items and marks activeView as current page', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSidebar, {
        activeView: 'export',
        projectName: 'Midnight Sketch',
        currentLabel: 'Current · 78c9df41',
        projectOpen: true,
        onViewChange: vi.fn(),
      }),
    );

    expect(html).toContain('Export Current');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-active="true"');
  });

  it('filters navigation items based on availableViews prop', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSidebar, {
        activeView: 'studio',
        projectName: 'No project open',
        currentLabel: 'Choose a project folder to begin',
        projectOpen: false,
        onViewChange: vi.fn(),
        availableViews: ['studio'],
      }),
    );

    expect(html).toContain('Studio');
    expect(html).not.toContain('Export Current');
    expect(html).not.toContain('Recovery');
  });

  it('renders settings trigger reflecting configured state', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSidebar, {
        activeView: 'studio',
        projectName: 'Midnight Sketch',
        currentLabel: 'Current · 78c9df41',
        projectOpen: true,
        isSettingsConfigured: true,
        onViewChange: vi.fn(),
      }),
    );

    expect(html).toContain('Settings');
    expect(html).toContain('workspace-settings-trigger');
    expect(html).toContain('workspace-settings-trigger__status--ready');
    expect(html).toContain('Agent configured');
  });

  it('renders settings trigger reflecting unconfigured state', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectSidebar, {
        activeView: 'studio',
        projectName: 'Midnight Sketch',
        currentLabel: 'Current · 78c9df41',
        projectOpen: true,
        isSettingsConfigured: false,
        onViewChange: vi.fn(),
      }),
    );

    expect(html).toContain('Settings');
    expect(html).toContain('workspace-settings-trigger');
    expect(html).toContain('workspace-settings-trigger__status--missing');
    expect(html).toContain('API Key required');
  });
});
