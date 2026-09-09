import { describe, expect, it } from 'vitest';
import {
  exportCurrentSuggestedName,
  getExportCurrentReadiness,
} from './export-current-model.js';

describe('Export Current model', () => {
  it('keeps export unavailable until an authoritative playback input is loaded', () => {
    expect(
      getExportCurrentReadiness({
        currentReady: false,
        playbackInputReady: false,
      }),
    ).toBe('unavailable');
    expect(
      getExportCurrentReadiness({
        currentReady: true,
        playbackInputReady: false,
      }),
    ).toBe('unavailable');
  });

  it('shows preparation while the A5 payload seam is absent', () => {
    expect(
      getExportCurrentReadiness({
        currentReady: true,
        playbackInputReady: true,
      }),
    ).toBe('preparing');
  });

  it('makes a safe Windows filename for the native save dialog', () => {
    expect(exportCurrentSuggestedName('Midnight: Sketch?', 'wav')).toBe(
      'Midnight Sketch.wav',
    );
    expect(exportCurrentSuggestedName('  ', 'abc')).toBe('untitled.abc');
  });
});
