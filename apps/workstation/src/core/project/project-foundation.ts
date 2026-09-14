import {
  type OpenedProject,
  type ProjectId,
  type ProjectManifest,
  type ProjectOpenState,
} from '@agent-music/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  CurrentAuthorityReader,
  type CurrentAuthoritySnapshot,
} from './current-authority.js';
import { GitAdapter } from './git-adapter.js';
import { createInitialComposition } from './initial-composition.js';
import type { ProjectAuthorityAccess } from './project-authority-access.js';
import {
  createProjectManifest,
  parseProjectManifest,
  serializeProjectManifest,
} from './project-manifest.js';
import { ProjectError } from './project-error.js';
import { ProjectWriteLock } from './project-lock.js';
import { ProjectWriteCoordinator } from './project-write-coordinator.js';

interface ProjectSession {
  readonly projectId: ProjectId;
  readonly projectPath: string;
  readonly lock: ProjectWriteLock;
  readonly writes: ProjectWriteCoordinator;
  state: ProjectOpenState;
}

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

export class ProjectFoundation implements ProjectAuthorityAccess {
  private readonly git: GitAdapter;
  private readonly authority: CurrentAuthorityReader;
  private session: ProjectSession | undefined;

  constructor(git = new GitAdapter(), authority?: CurrentAuthorityReader) {
    this.git = git;
    this.authority = authority ?? new CurrentAuthorityReader(git);
  }

  async createProject(projectPath: string): Promise<OpenedProject> {
    this.assertNoActiveProject();
    const absolutePath = resolve(projectPath);
    const createdDirectory = await this.prepareEmptyTarget(absolutePath);
    let lock: ProjectWriteLock | undefined;

    try {
      await Promise.all([
        mkdir(join(absolutePath, 'exports'), { recursive: true }),
        mkdir(join(absolutePath, '.agent-music', 'cache'), {
          recursive: true,
        }),
        mkdir(join(absolutePath, '.agent-music', 'locks'), {
          recursive: true,
        }),
      ]);

      const projectId = randomUUID() as ProjectId;
      lock = await ProjectWriteLock.acquire(absolutePath, projectId);
      await Promise.all([
        writeFile(
          join(absolutePath, 'project.json'),
          serializeProjectManifest(createProjectManifest(projectId)),
          { encoding: 'utf8', mode: 0o600 },
        ),
        writeFile(
          join(absolutePath, 'composition.abc'),
          this.createInitialComposition(),
          { encoding: 'utf8', mode: 0o600 },
        ),
      ]);
      await this.git.init(absolutePath);
      await this.git.commitAuthorityFiles(absolutePath, 'Initial Current');
      const snapshot = await this.authority.readCleanCurrent(absolutePath);
      this.activateSession(projectId, absolutePath, lock, 'ready');
      return this.toOpenedProject(absolutePath, snapshot, 'ready');
    } catch (error) {
      await lock?.release();
      await this.cleanFailedTarget(absolutePath, createdDirectory);
      throw error;
    }
  }

  async openProject(projectPath: string): Promise<OpenedProject> {
    this.assertNoActiveProject();
    const absolutePath = resolve(projectPath);
    let manifestSource: string;
    let currentRevision: string;

    try {
      await this.git.configureRepository(absolutePath);
      [manifestSource, currentRevision] = await Promise.all([
        this.git.readMainFile(absolutePath, 'project.json'),
        this.git.mainRevision(absolutePath),
      ]);
    } catch {
      throw new ProjectError(
        'PROJECT_INVALID',
        'Project directory is not a valid Current repository',
      );
    }

    const manifest = parseProjectManifest(manifestSource);
    const lock = await ProjectWriteLock.acquire(
      absolutePath,
      manifest.projectId,
    );

    try {
      const dirty = (await this.git.statusPorcelain(absolutePath)) !== '';
      if (dirty) {
        this.activateSession(
          manifest.projectId,
          absolutePath,
          lock,
          'recoveryRequired',
        );
        return {
          projectId: manifest.projectId,
          projectPath: absolutePath,
          currentRevision,
          state: 'recoveryRequired',
          manifest,
        };
      }

      const snapshot = await this.authority.readCleanCurrent(absolutePath);
      this.activateSession(manifest.projectId, absolutePath, lock, 'ready');
      return this.toOpenedProject(absolutePath, snapshot, 'ready');
    } catch (error) {
      await lock.release();
      throw error;
    }
  }

  async saveProjectAs(targetPath: string): Promise<OpenedProject> {
    const sourceSession = this.requireSession();
    const sourceSnapshot = await this.readCleanCurrent();
    const targetAbsolutePath = resolve(targetPath);
    const targetManifest = createProjectManifest(randomUUID() as ProjectId);
    const target = await this.createRepositoryFromAuthority(
      targetAbsolutePath,
      targetManifest,
      sourceSnapshot.compositionSource,
    );

    try {
      await sourceSession.lock.release();
    } catch (error) {
      await target.rollback();
      throw error;
    }

    this.session = target.session;
    return this.toOpenedProject(targetAbsolutePath, target.snapshot, 'ready');
  }

  async recoverCurrent(): Promise<OpenedProject> {
    const session = this.requireSession();
    return session.writes.run(async () => {
      await this.authority.restoreCurrent(session.projectPath);
      const snapshot = await this.authority.readCleanCurrent(
        session.projectPath,
      );
      session.state = 'ready';
      return this.toOpenedProject(session.projectPath, snapshot, 'ready');
    });
  }

  async closeProject(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    await session?.lock.release();
  }

  async readCleanCurrent(): Promise<CurrentAuthoritySnapshot> {
    const session = this.requireSession();
    return this.authority.readCleanCurrent(session.projectPath);
  }

  getProjectPath(): string {
    return this.requireSession().projectPath;
  }

  /**
   * The currently open Project's ID, or undefined when no Project is open.
   * The Core-process-scoped MCP server uses this to resolve the active
   * Project per request instead of capturing one at construction time.
   */
  getProjectId(): ProjectId | undefined {
    return this.session?.projectId;
  }

  runSerializedWrite<T>(operation: () => Promise<T>): Promise<T> {
    const session = this.requireSession();
    if (session.state !== 'ready') {
      throw new ProjectError(
        'CURRENT_WORKTREE_DIRTY',
        'Current must be recovered before writing',
      );
    }
    return session.writes.run(operation);
  }

  private createInitialComposition(): string {
    return createInitialComposition();
  }

  private assertNoActiveProject(): void {
    if (this.session) {
      throw new ProjectError(
        'PROJECT_ALREADY_OPEN',
        'A project is already open in this Core instance',
      );
    }
  }

  private requireSession(): ProjectSession {
    if (!this.session) {
      throw new ProjectError('PROJECT_NOT_OPEN', 'No project is open');
    }
    return this.session;
  }

  private activateSession(
    projectId: ProjectId,
    projectPath: string,
    lock: ProjectWriteLock,
    state: ProjectOpenState,
  ): void {
    this.session = this.createSession(projectId, projectPath, lock, state);
  }

  private createSession(
    projectId: ProjectId,
    projectPath: string,
    lock: ProjectWriteLock,
    state: ProjectOpenState,
  ): ProjectSession {
    return {
      projectId,
      projectPath,
      lock,
      writes: new ProjectWriteCoordinator(lock),
      state,
    };
  }

  private async createRepositoryFromAuthority(
    projectPath: string,
    manifest: ProjectManifest,
    compositionSource: string,
  ): Promise<{
    readonly session: ProjectSession;
    readonly snapshot: CurrentAuthoritySnapshot;
    readonly rollback: () => Promise<void>;
  }> {
    const createdDirectory = await this.prepareEmptyTarget(projectPath);
    let lock: ProjectWriteLock | undefined;

    try {
      await Promise.all([
        mkdir(join(projectPath, 'exports'), { recursive: true }),
        mkdir(join(projectPath, '.agent-music', 'cache'), { recursive: true }),
        mkdir(join(projectPath, '.agent-music', 'locks'), { recursive: true }),
      ]);
      const acquiredLock = await ProjectWriteLock.acquire(
        projectPath,
        manifest.projectId,
      );
      lock = acquiredLock;
      await Promise.all([
        writeFile(
          join(projectPath, 'project.json'),
          serializeProjectManifest(manifest),
          { encoding: 'utf8', mode: 0o600 },
        ),
        writeFile(join(projectPath, 'composition.abc'), compositionSource, {
          encoding: 'utf8',
          mode: 0o600,
        }),
      ]);
      await this.git.init(projectPath);
      await this.git.commitAuthorityFiles(projectPath, 'Initial Current');
      const snapshot = await this.authority.readCleanCurrent(projectPath);
      const session = this.createSession(
        manifest.projectId,
        projectPath,
        acquiredLock,
        'ready',
      );
      return {
        session,
        snapshot,
        rollback: async () => {
          await acquiredLock.release();
          await this.cleanFailedTarget(projectPath, createdDirectory);
        },
      };
    } catch (error) {
      await lock?.release();
      await this.cleanFailedTarget(projectPath, createdDirectory);
      throw error;
    }
  }

  private toOpenedProject(
    projectPath: string,
    snapshot: CurrentAuthoritySnapshot,
    state: ProjectOpenState,
  ): OpenedProject {
    return {
      projectId: snapshot.manifest.projectId,
      projectPath,
      currentRevision: snapshot.currentRevision,
      state,
      manifest: snapshot.manifest,
    };
  }

  private async prepareEmptyTarget(projectPath: string): Promise<boolean> {
    try {
      const target = await stat(projectPath);
      if (!target.isDirectory() || (await readdir(projectPath)).length !== 0) {
        throw new ProjectError(
          'PROJECT_DIRECTORY_NOT_EMPTY',
          'Project target must be an empty directory',
        );
      }
      return false;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        await mkdir(projectPath, { recursive: true });
        return true;
      }
      throw error;
    }
  }

  private async cleanFailedTarget(
    projectPath: string,
    createdDirectory: boolean,
  ): Promise<void> {
    if (createdDirectory) {
      await rm(projectPath, { recursive: true, force: true });
      return;
    }

    try {
      const entries = await readdir(projectPath);
      await Promise.all(
        entries.map((entry) =>
          rm(join(projectPath, entry), { recursive: true, force: true }),
        ),
      );
    } catch {
      // Preserve the original creation failure.
    }
  }
}
