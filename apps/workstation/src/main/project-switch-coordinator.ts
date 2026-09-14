import type { OpenedProject, ProjectId } from '@agent-music/contracts';

export interface ProjectSwitchSource {
  readonly projectId: ProjectId;
  readonly projectPath: string;
}

export interface ProjectSwitchTarget {
  readonly projectPath: string;
}

export interface ProjectSwitchRequest {
  readonly source: ProjectSwitchSource;
  readonly target: ProjectSwitchTarget;
  /** Confirmation supplied by the host after presenting the destructive warning. */
  readonly confirmed: boolean;
}

export interface ProjectSwitchAgentPort {
  hasRunningExecution(projectId: ProjectId): boolean | Promise<boolean>;
  hasActiveTask(projectId: ProjectId): boolean | Promise<boolean>;
  /** Cancels either activity kind and starts its rollback. */
  cancelCurrentExecution(projectId: ProjectId): Promise<void>;
  /** Resolves only after rollback and all in-flight tool work have settled. */
  waitForExecutionSettled(projectId: ProjectId): Promise<void>;
}

export interface ProjectSwitchCorePort {
  closeProject(projectId: ProjectId): Promise<void>;
  openProject(projectPath: string): Promise<OpenedProject>;
}

export type ProjectSwitchFailureStage =
  | 'coordination'
  | 'agentState'
  | 'agentCancel'
  | 'agentSettle'
  | 'coreClose'
  | 'coreOpen'
  | 'sourceRestore';

export type ProjectSwitchResult =
  | Readonly<{
      status: 'confirmationRequired';
      code: 'CONFIRMATION_REQUIRED';
      source: ProjectSwitchSource;
      target: ProjectSwitchTarget;
      activeExecution: boolean;
      activeTask: boolean;
    }>
  | Readonly<{
      status: 'switched';
      project: OpenedProject;
      activityCancelled: boolean;
    }>
  | Readonly<{
      status: 'failed';
      code: 'PROJECT_SWITCH_FAILED' | 'SWITCH_IN_PROGRESS';
      stage: ProjectSwitchFailureStage;
      /** True only after the source has been confirmed open again. */
      sourceRetained: boolean;
      message: string;
    }>;

/**
 * Owns the destructive Project A → B ordering behind a small host seam.
 *
 * The Agent port's cancellation pair is deliberately used for both a running
 * execution and an already-created Active Task. The host must implement that
 * pair as rollback plus tool settlement before this module closes A.
 */
export class ProjectSwitchCoordinator {
  #inFlight: Promise<ProjectSwitchResult> | undefined;

  public constructor(
    private readonly agent: ProjectSwitchAgentPort,
    private readonly core: ProjectSwitchCorePort,
  ) {}

  public switchProject(
    request: ProjectSwitchRequest,
  ): Promise<ProjectSwitchResult> {
    if (this.#inFlight !== undefined) {
      return Promise.resolve({
        status: 'failed',
        code: 'SWITCH_IN_PROGRESS',
        stage: 'coordination',
        sourceRetained: true,
        message: 'Another Project switch is already in progress.',
      });
    }

    const operation = this.execute(request);
    this.#inFlight = operation;
    return operation.finally(() => {
      if (this.#inFlight === operation) this.#inFlight = undefined;
    });
  }

  private async execute(
    request: ProjectSwitchRequest,
  ): Promise<ProjectSwitchResult> {
    let activeExecution: boolean;
    let activeTask: boolean;
    try {
      [activeExecution, activeTask] = await Promise.all([
        this.agent.hasRunningExecution(request.source.projectId),
        this.agent.hasActiveTask(request.source.projectId),
      ]);
    } catch {
      return this.failed('agentState', true);
    }

    const hasActivity = activeExecution || activeTask;
    if (hasActivity && !request.confirmed) {
      return {
        status: 'confirmationRequired',
        code: 'CONFIRMATION_REQUIRED',
        source: request.source,
        target: request.target,
        activeExecution,
        activeTask,
      };
    }

    if (hasActivity) {
      try {
        await this.agent.cancelCurrentExecution(request.source.projectId);
      } catch {
        return this.failed('agentCancel', true);
      }
      try {
        await this.agent.waitForExecutionSettled(request.source.projectId);
      } catch {
        return this.failed('agentSettle', true);
      }
    }

    try {
      await this.core.closeProject(request.source.projectId);
    } catch {
      return this.failed('coreClose', true);
    }

    try {
      const project = await this.core.openProject(request.target.projectPath);
      return {
        status: 'switched',
        project,
        activityCancelled: hasActivity,
      };
    } catch {
      try {
        await this.core.openProject(request.source.projectPath);
      } catch {
        return this.failed('sourceRestore', false);
      }
      return this.failed('coreOpen', true);
    }
  }

  private failed(
    stage: ProjectSwitchFailureStage,
    sourceRetained: boolean,
  ): ProjectSwitchResult {
    return {
      status: 'failed',
      code: 'PROJECT_SWITCH_FAILED',
      stage,
      sourceRetained,
      message: sourceRetained
        ? 'Project switch stopped; the source Project remains active.'
        : 'Project switch failed and the source Project could not be restored.',
    };
  }
}

export const createProjectSwitchCoordinator = (
  agent: ProjectSwitchAgentPort,
  core: ProjectSwitchCorePort,
): ProjectSwitchCoordinator => new ProjectSwitchCoordinator(agent, core);
