import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type {
  AgentSessionId,
  AgentSessionSummary,
  ProjectId,
} from '@agent-music/contracts';

export type SessionRegistryErrorCode =
  'SESSION_NOT_FOUND' | 'SESSION_INDEX_INVALID' | 'SESSION_INDEX_IO_FAILED';

export class SessionRegistryError extends Error {
  public constructor(
    public readonly code: SessionRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionRegistryError';
  }
}

export interface SessionRegistryDependencies {
  readonly indexPath: string;
  readonly createId: () => AgentSessionId;
  readonly now: () => string;
}

interface ProjectSessionRecord {
  readonly sessions: readonly AgentSessionSummary[];
  readonly activeSessionId?: AgentSessionId;
}

interface SessionIndexDocument {
  readonly formatVersion: 1;
  readonly projects: Readonly<Record<string, ProjectSessionRecord>>;
}

const EMPTY_INDEX: SessionIndexDocument = {
  formatVersion: 1,
  projects: {},
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isSessionSummary = (value: unknown): value is AgentSessionSummary =>
  isRecord(value) &&
  isUuid(value.sessionId) &&
  isUuid(value.projectId) &&
  typeof value.createdAt === 'string' &&
  value.createdAt.length > 0;

const isProjectSessionRecord = (
  value: unknown,
  projectId: string,
): value is ProjectSessionRecord => {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    return false;
  }

  const sessions: readonly unknown[] = value.sessions;
  const sessionIds: AgentSessionId[] = [];
  for (const session of sessions) {
    if (!isSessionSummary(session) || session.projectId !== projectId) {
      return false;
    }
    sessionIds.push(session.sessionId);
  }

  if (new Set(sessionIds).size !== sessionIds.length) {
    return false;
  }

  if (value.activeSessionId === undefined) {
    return true;
  }

  return (
    isUuid(value.activeSessionId) &&
    sessionIds.some((sessionId) => sessionId === value.activeSessionId)
  );
};

const parseSessionIndex = (value: unknown): SessionIndexDocument => {
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    !isRecord(value.projects)
  ) {
    throw new SessionRegistryError(
      'SESSION_INDEX_INVALID',
      'Agent Session index is invalid',
    );
  }

  for (const [projectId, project] of Object.entries(value.projects)) {
    if (!isUuid(projectId) || !isProjectSessionRecord(project, projectId)) {
      throw new SessionRegistryError(
        'SESSION_INDEX_INVALID',
        'Agent Session index is invalid',
      );
    }
  }

  return {
    formatVersion: 1,
    projects: value.projects as Readonly<Record<string, ProjectSessionRecord>>,
  };
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

export class SessionRegistry {
  public constructor(
    private readonly dependencies: SessionRegistryDependencies,
  ) {}

  public async list(
    projectId: ProjectId,
  ): Promise<readonly AgentSessionSummary[]> {
    const index = await this.readIndex();
    return index.projects[projectId]?.sessions ?? [];
  }

  public async create(projectId: ProjectId): Promise<AgentSessionSummary> {
    const index = await this.readIndex();
    const existing = index.projects[projectId];
    const session: AgentSessionSummary = {
      sessionId: this.dependencies.createId(),
      projectId,
      createdAt: this.dependencies.now(),
    };
    const sessions = [...(existing?.sessions ?? []), session];
    await this.writeIndex({
      formatVersion: 1,
      projects: {
        ...index.projects,
        [projectId]: {
          sessions,
          activeSessionId: session.sessionId,
        },
      },
    });
    return session;
  }

  public async open(
    projectId: ProjectId,
    sessionId: AgentSessionId,
  ): Promise<AgentSessionSummary> {
    const index = await this.readIndex();
    const project = index.projects[projectId];
    const session = project?.sessions.find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (project === undefined || session === undefined) {
      throw new SessionRegistryError(
        'SESSION_NOT_FOUND',
        'Agent Session does not belong to this Project',
      );
    }

    await this.writeIndex({
      formatVersion: 1,
      projects: {
        ...index.projects,
        [projectId]: {
          sessions: project.sessions,
          activeSessionId: sessionId,
        },
      },
    });
    return session;
  }

  public async getActive(
    projectId: ProjectId,
  ): Promise<AgentSessionSummary | undefined> {
    const index = await this.readIndex();
    const project = index.projects[projectId];
    if (project?.activeSessionId === undefined) {
      return undefined;
    }
    return project.sessions.find(
      (session) => session.sessionId === project.activeSessionId,
    );
  }

  public async close(projectId: ProjectId): Promise<void> {
    const index = await this.readIndex();
    const project = index.projects[projectId];
    if (project?.activeSessionId === undefined) {
      return;
    }

    await this.writeIndex({
      formatVersion: 1,
      projects: {
        ...index.projects,
        [projectId]: {
          sessions: project.sessions,
        },
      },
    });
  }

  private async readIndex(): Promise<SessionIndexDocument> {
    let raw: string;
    try {
      raw = await readFile(this.dependencies.indexPath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return EMPTY_INDEX;
      }
      throw new SessionRegistryError(
        'SESSION_INDEX_IO_FAILED',
        'Unable to read Agent Session index',
      );
    }

    try {
      return parseSessionIndex(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof SessionRegistryError) {
        throw error;
      }
      throw new SessionRegistryError(
        'SESSION_INDEX_INVALID',
        'Agent Session index is invalid JSON',
      );
    }
  }

  private async writeIndex(index: SessionIndexDocument): Promise<void> {
    const directory = dirname(this.dependencies.indexPath);
    const temporaryPath = join(
      directory,
      `.${basename(this.dependencies.indexPath)}.${String(process.pid)}.${randomUUID()}.tmp`,
    );

    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.dependencies.indexPath);
      await chmod(this.dependencies.indexPath, 0o600);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new SessionRegistryError(
        'SESSION_INDEX_IO_FAILED',
        'Unable to write Agent Session index',
      );
    }
  }
}
