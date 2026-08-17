import type {
  CandidateId,
  CandidateRecoveryReport,
} from '@agent-music/contracts';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  CandidateRepository,
  CandidateWorkspace,
} from './candidate-repository.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CandidateCleanupMarker {
  readonly version: 1;
  readonly candidateId: CandidateId;
  readonly cleanupAllowed: true;
}

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const markerDirectory = (projectPath: string): string =>
  join(projectPath, '.agent-music', 'candidate-cleanup');

const markerPath = (projectPath: string, candidateId: CandidateId): string =>
  join(markerDirectory(projectPath), `${candidateId}.json`);

const isValidMarker = (
  value: unknown,
  candidateId: string,
): value is CandidateCleanupMarker => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    record.cleanupAllowed === true &&
    record.candidateId === candidateId
  );
};

export class CandidateCleanupRegistry {
  public async authorize(
    projectPath: string,
    candidateId: CandidateId,
  ): Promise<void> {
    const path = markerPath(projectPath, candidateId);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    const marker: CandidateCleanupMarker = {
      version: 1,
      candidateId,
      cleanupAllowed: true,
    };
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(temporaryPath, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(marker)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  public async listAuthorized(
    projectPath: string,
  ): Promise<readonly CandidateId[]> {
    const directory = markerDirectory(projectPath);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const authorized: CandidateId[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const candidateId = entry.name.slice(0, -'.json'.length);
      if (!UUID_PATTERN.test(candidateId)) {
        continue;
      }
      try {
        const source = await readFile(join(directory, entry.name), 'utf8');
        const parsed: unknown = JSON.parse(source);
        if (isValidMarker(parsed, candidateId)) {
          authorized.push(candidateId as CandidateId);
        }
      } catch {
        // Invalid marker data is not cleanup authorization.
      }
    }
    return authorized.sort();
  }

  public async clear(
    projectPath: string,
    candidateId: CandidateId,
  ): Promise<void> {
    await rm(markerPath(projectPath, candidateId), { force: true });
  }
}

export interface CandidateCleanupManagerPort {
  authorizeAndAttempt(
    projectPath: string,
    workspace: CandidateWorkspace,
  ): Promise<void>;
  reconcile(projectPath: string): Promise<CandidateRecoveryReport>;
}

export class CandidateCleanupManager implements CandidateCleanupManagerPort {
  public constructor(
    private readonly repository: CandidateRepository,
    private readonly registry = new CandidateCleanupRegistry(),
  ) {}

  public async authorizeAndAttempt(
    projectPath: string,
    workspace: CandidateWorkspace,
  ): Promise<void> {
    await this.registry.authorize(projectPath, workspace.candidateId);
    await this.repository.remove(workspace);
    await this.registry.clear(projectPath, workspace.candidateId);
  }

  public async reconcile(
    projectPath: string,
  ): Promise<CandidateRecoveryReport> {
    const [authorizedIds, resourceIds] = await Promise.all([
      this.registry.listAuthorized(projectPath),
      this.repository.listCandidateResourceIds(projectPath),
    ]);
    const authorized = new Set(authorizedIds);
    const cleanedCandidateIds: CandidateId[] = [];
    const pendingCandidateIds: CandidateId[] = [];

    for (const candidateId of authorizedIds) {
      const workspace = this.workspaceForCleanup(projectPath, candidateId);
      try {
        await this.repository.remove(workspace);
        await this.registry.clear(projectPath, candidateId);
        cleanedCandidateIds.push(candidateId);
      } catch {
        pendingCandidateIds.push(candidateId);
      }
    }

    const orphanCandidateIds = resourceIds.filter(
      (candidateId) => !authorized.has(candidateId),
    );

    return {
      cleanedCandidateIds,
      pendingCandidateIds,
      orphanCandidateIds,
    };
  }

  private workspaceForCleanup(
    projectPath: string,
    candidateId: CandidateId,
  ): CandidateWorkspace {
    return {
      candidateId,
      branchName: `candidate/${candidateId}`,
      worktreePath: join(projectPath, '.agent-music', 'worktrees', candidateId),
      baseRevision: '',
    };
  }
}
