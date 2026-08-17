import type { ProjectId } from '@agent-music/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { ProjectError } from './project-error.js';

interface ProjectLockRecord {
  readonly version: 1;
  readonly projectId: ProjectId;
  readonly instanceId: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

export type ProcessState = 'alive' | 'dead';
export type ProcessProbe = (pid: number) => ProcessState;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const defaultProcessProbe: ProcessProbe = (pid) => {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (isNodeError(error) && error.code === 'ESRCH') {
      return 'dead';
    }
    return 'alive';
  }
};

const parseRecord = (source: string): ProjectLockRecord | undefined => {
  try {
    const value = JSON.parse(source) as Partial<ProjectLockRecord>;
    if (
      value.version === 1 &&
      typeof value.projectId === 'string' &&
      typeof value.instanceId === 'string' &&
      typeof value.pid === 'number' &&
      Number.isInteger(value.pid) &&
      typeof value.acquiredAt === 'string'
    ) {
      return value as ProjectLockRecord;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export class ProjectWriteLock {
  private constructor(
    private readonly lockPath: string,
    private readonly record: ProjectLockRecord,
  ) {}

  static async acquire(
    projectPath: string,
    projectId: ProjectId,
    processProbe: ProcessProbe = defaultProcessProbe,
  ): Promise<ProjectWriteLock> {
    const locksDirectory = join(projectPath, '.agent-music', 'locks');
    const lockPath = join(locksDirectory, 'project-write.lock');
    await mkdir(locksDirectory, { recursive: true });

    const record: ProjectLockRecord = {
      version: 1,
      projectId,
      instanceId: randomUUID(),
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    };

    const writeNewLock = async (): Promise<ProjectWriteLock> => {
      const handle = await open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      } finally {
        await handle.close();
      }
      return new ProjectWriteLock(lockPath, record);
    };

    try {
      return await writeNewLock();
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw error;
      }
    }

    let existing: ProjectLockRecord | undefined;
    try {
      existing = parseRecord(await readFile(lockPath, 'utf8'));
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (existing && processProbe(existing.pid) === 'alive') {
      throw new ProjectError(
        'PROJECT_WRITE_LOCKED',
        `Project is already open by process ${String(existing.pid)}`,
      );
    }

    try {
      await unlink(lockPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    try {
      return await writeNewLock();
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        throw new ProjectError(
          'PROJECT_WRITE_LOCKED',
          'Project lock was acquired by another process',
        );
      }
      throw error;
    }
  }

  async assertOwned(): Promise<void> {
    let current: ProjectLockRecord | undefined;
    try {
      current = parseRecord(await readFile(this.lockPath, 'utf8'));
    } catch {
      current = undefined;
    }

    const ownsLock =
      current?.projectId === this.record.projectId &&
      current.instanceId === this.record.instanceId &&
      current.pid === this.record.pid;

    if (!ownsLock) {
      throw new ProjectError(
        'PROJECT_WRITE_LOCK_LOST',
        'Project write lock ownership was lost',
      );
    }
  }

  async release(): Promise<void> {
    try {
      await this.assertOwned();
    } catch (error) {
      if (
        error instanceof ProjectError &&
        error.code === 'PROJECT_WRITE_LOCK_LOST'
      ) {
        return;
      }
      throw error;
    }

    try {
      await unlink(this.lockPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
