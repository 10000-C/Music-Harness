import type { ProjectId } from '@agent-music/contracts';
import { describe, expect, it } from 'vitest';

import { createInitialComposition } from './initial-composition.js';
import {
  createProjectManifest,
  parseProjectManifest,
  serializeProjectManifest,
} from './project-manifest.js';

describe('project authority fixtures', () => {
  it('creates and round-trips the exact P0 manifest', () => {
    const manifest = createProjectManifest(
      'f31dd9a5-2f55-4bd0-8cf6-f684c41314cc' as ProjectId,
    );

    expect(parseProjectManifest(serializeProjectManifest(manifest))).toEqual(
      manifest,
    );
    expect(serializeProjectManifest(manifest).endsWith('\n')).toBe(true);
  });

  it('rejects invalid project manifests', () => {
    expect(() => parseProjectManifest('{')).toThrow();
    expect(() => parseProjectManifest('{}')).toThrow();
  });

  it('creates a deterministic non-empty six-voice ABC fixture', () => {
    const first = createInitialComposition();
    const second = createInitialComposition();

    expect(first).toBe(second);
    expect(first).toContain('V:track.drums');
    expect(first).toContain('V:track.winds');
    expect(first.trim().length).toBeGreaterThan(0);
  });
});
