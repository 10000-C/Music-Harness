import { describe, expect, it } from 'vitest';

import {
  PROJECT_FORMAT_VERSION,
  PROJECT_PPQ,
  TRACK_IDS,
  isProjectManifest,
} from './index.js';

describe('ProjectManifest', () => {
  const validManifest = {
    formatVersion: PROJECT_FORMAT_VERSION,
    projectId: 'f31dd9a5-2f55-4bd0-8cf6-f684c41314cc',
    timebase: { ppq: PROJECT_PPQ },
    tracks: TRACK_IDS,
  };

  it('accepts the exact P0 manifest shape', () => {
    expect(isProjectManifest(validManifest)).toBe(true);
  });

  it('rejects a Current SHA, changed PPQ, and reordered tracks', () => {
    expect(
      isProjectManifest({ ...validManifest, currentRevision: 'abc' }),
    ).toBe(false);
    expect(
      isProjectManifest({ ...validManifest, timebase: { ppq: 480 } }),
    ).toBe(false);
    expect(
      isProjectManifest({
        ...validManifest,
        tracks: [...TRACK_IDS].reverse(),
      }),
    ).toBe(false);
  });
});
