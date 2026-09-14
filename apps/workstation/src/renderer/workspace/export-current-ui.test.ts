import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExportCurrentView } from './export-current.js';

(globalThis as unknown as { React: typeof React }).React = React;

describe('ExportCurrentView presentation', () => {
  it('displays only MIDI and WAV formats, excluding ABC', () => {
    const html = renderToStaticMarkup(
      createElement(ExportCurrentView, {
        projectName: 'My Project',
        currentRevision: 'rev123',
        currentReady: true,
        playbackInputReady: true,
        selectedPaths: {},
        onChoosePath: vi.fn(),
      }),
    );

    expect(html).toContain('Standard MIDI');
    expect(html).toContain('Full mix WAV');
    expect(html).not.toContain('Canonical ABC');
  });

  it('displays export statuses and disables buttons when busy', () => {
    const html = renderToStaticMarkup(
      createElement(ExportCurrentView, {
        projectName: 'My Project',
        currentRevision: 'rev123',
        currentReady: true,
        playbackInputReady: true,
        selectedPaths: { midi: '/path/to/export.mid' },
        exportStates: { midi: 'exporting' },
        onChoosePath: vi.fn(),
        onStartExport: vi.fn(),
      }),
    );

    expect(html).toContain('export-status--exporting');
    expect(html).toContain('Status: Exporting');
    expect(html).toContain('disabled=""');
  });
});
