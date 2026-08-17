import type { CandidateId } from '@agent-music/contracts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from '../project/test-support.js';
import {
  CandidateCleanupManager,
  CandidateCleanupRegistry,
} from './candidate-cleanup.js';
import type {
  CandidateRepository,
  CandidateWorkspace,
} from './candidate-repository.js';

const candidateA = '00000000-0000-4000-8000-000000000041' as CandidateId;
const candidateB = '00000000-0000-4000-8000-000000000042' as CandidateId;
const candidateC = '00000000-0000-4000-8000-000000000043' as CandidateId;

let projectPath: string;

beforeEach(async () => {
  projectPath = await createTemporaryDirectory('a3-cleanup-');
});

afterEach(async () => {
  await removeTemporaryDirectory(projectPath);
});

describe('CandidateCleanupRegistry', () => {
  it('persists only valid version-1 cleanup authorizations', async () => {
    const registry = new CandidateCleanupRegistry();
    await registry.authorize(projectPath, candidateA);

    const markerDirectory = join(
      projectPath,
      '.agent-music',
      'candidate-cleanup',
    );
    await mkdir(markerDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(markerDirectory, `${candidateB}.json`), '{bad json'),
      writeFile(
        join(markerDirectory, '00000000-0000-4000-8000-000000000043.json'),
        JSON.stringify({
          version: 2,
          candidateId: '00000000-0000-4000-8000-000000000043',
          cleanupAllowed: true,
        }),
      ),
      writeFile(
        join(markerDirectory, '00000000-0000-4000-8000-000000000044.json'),
        JSON.stringify({
          version: 1,
          candidateId: '00000000-0000-4000-8000-000000000044',
          cleanupAllowed: false,
        }),
      ),
      writeFile(
        join(markerDirectory, 'not-a-uuid.json'),
        JSON.stringify({
          version: 1,
          candidateId: 'not-a-uuid',
          cleanupAllowed: true,
        }),
      ),
    ]);

    expect(await registry.listAuthorized(projectPath)).toEqual([candidateA]);
  });
});

describe('CandidateCleanupManager', () => {
  it('cleans only marker-authorized resources and preserves pending/orphan resources', async () => {
    const registry = new CandidateCleanupRegistry();
    await registry.authorize(projectPath, candidateA);
    await registry.authorize(projectPath, candidateB);
    const removed: CandidateId[] = [];
    const unsupported = (): never => {
      throw new Error('unsupported in cleanup test');
    };
    const repository = {
      create: async () => unsupported(),
      readAuthority: async () => unsupported(),
      writeComposition: async () => unsupported(),
      inspectChanges: async () => unsupported(),
      createCheckpoint: async () => unsupported(),
      resetTo: async () => unsupported(),
      commitCompositionToCurrent: async () => unsupported(),
      remove: async (workspace: CandidateWorkspace) => {
        removed.push(workspace.candidateId);
        if (workspace.candidateId === candidateB) {
          throw new Error('simulated cleanup failure');
        }
      },
      listCandidateResourceIds: async () => [
        candidateA,
        candidateB,
        candidateC,
      ],
    } satisfies CandidateRepository;
    const manager = new CandidateCleanupManager(repository, registry);

    await expect(manager.reconcile(projectPath)).resolves.toEqual({
      cleanedCandidateIds: [candidateA],
      pendingCandidateIds: [candidateB],
      orphanCandidateIds: [candidateC],
    });
    expect(removed).toEqual([candidateA, candidateB]);
    expect(await registry.listAuthorized(projectPath)).toEqual([candidateB]);
  });
});
