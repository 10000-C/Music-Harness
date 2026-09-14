import {
  TRACK_IDS,
  type OpenedProject,
  type ProjectId,
} from '@agent-music/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createProjectSwitchCoordinator,
  type ProjectSwitchAgentPort,
  type ProjectSwitchCorePort,
} from '../src/main/project-switch-coordinator.js';

const sourceId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const targetId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const sourcePath = 'D:/projects/source';
const targetPath = 'D:/projects/target';

const project = (projectId: ProjectId, projectPath: string): OpenedProject => ({
  projectId,
  projectPath,
  currentRevision: 'C0',
  state: 'ready',
  manifest: {
    formatVersion: 1,
    projectId,
    timebase: { ppq: 960 },
    tracks: TRACK_IDS,
  },
});

const request = (confirmed: boolean) => ({
  source: { projectId: sourceId, projectPath: sourcePath },
  target: { projectPath: targetPath },
  confirmed,
});

const createHarness = (
  options: {
    running?: boolean;
    activeTask?: boolean;
    stateFailure?: boolean;
    cancel?: () => Promise<void>;
    settle?: () => Promise<void>;
    close?: () => Promise<void>;
    open?: (projectPath: string) => Promise<OpenedProject>;
  } = {},
) => {
  const calls: string[] = [];
  const agent: ProjectSwitchAgentPort = {
    hasRunningExecution: vi.fn(async () => {
      if (options.stateFailure) throw new Error('agent unavailable');
      return options.running ?? false;
    }),
    hasActiveTask: vi.fn(async () => options.activeTask ?? false),
    cancelCurrentExecution: vi.fn(async (projectId: ProjectId) => {
      calls.push(`cancel:${String(projectId)}`);
      await options.cancel?.();
    }),
    waitForExecutionSettled: vi.fn(async (projectId: ProjectId) => {
      calls.push(`settle:${String(projectId)}`);
      await options.settle?.();
    }),
  };
  const core: ProjectSwitchCorePort = {
    closeProject: vi.fn(async (projectId: ProjectId) => {
      calls.push(`close:${String(projectId)}`);
      await options.close?.();
    }),
    openProject: vi.fn(async (projectPath: string) => {
      calls.push(`open:${projectPath}`);
      return options.open?.(projectPath) ?? project(targetId, projectPath);
    }),
  };
  return {
    coordinator: createProjectSwitchCoordinator(agent, core),
    agent,
    core,
    calls,
  };
};

describe('ProjectSwitchCoordinator', () => {
  it('requires confirmation for execution or task activity without side effects', async () => {
    for (const activity of [
      { running: true, activeTask: false },
      { running: false, activeTask: true },
      { running: true, activeTask: true },
    ]) {
      const harness = createHarness(activity);

      await expect(
        harness.coordinator.switchProject(request(false)),
      ).resolves.toMatchObject({
        status: 'confirmationRequired',
        code: 'CONFIRMATION_REQUIRED',
        activeExecution: activity.running,
        activeTask: activity.activeTask,
      });
      expect(harness.calls).toEqual([]);
    }
  });

  it('closes A and opens B when there is no active work', async () => {
    const harness = createHarness();

    await expect(
      harness.coordinator.switchProject(request(false)),
    ).resolves.toMatchObject({
      status: 'switched',
      project: project(targetId, targetPath),
      activityCancelled: false,
    });
    expect(harness.calls).toEqual([`close:${sourceId}`, `open:${targetPath}`]);
    expect(harness.agent.cancelCurrentExecution).not.toHaveBeenCalled();
    expect(harness.agent.waitForExecutionSettled).not.toHaveBeenCalled();
  });

  it('fails closed when Agent activity cannot be read', async () => {
    const harness = createHarness({ stateFailure: true });

    await expect(
      harness.coordinator.switchProject(request(true)),
    ).resolves.toMatchObject({
      status: 'failed',
      stage: 'agentState',
      sourceRetained: true,
    });
    expect(harness.calls).toEqual([]);
  });

  it('cancels and settles an Active Task before closing A', async () => {
    const harness = createHarness({ activeTask: true });

    await expect(
      harness.coordinator.switchProject(request(true)),
    ).resolves.toMatchObject({
      status: 'switched',
      activityCancelled: true,
    });
    expect(harness.calls).toEqual([
      `cancel:${sourceId}`,
      `settle:${sourceId}`,
      `close:${sourceId}`,
      `open:${targetPath}`,
    ]);
  });

  it.each([
    [
      'cancel',
      'agentCancel',
      { cancel: async () => Promise.reject(new Error('cancel')) },
    ],
    [
      'settle',
      'agentSettle',
      { settle: async () => Promise.reject(new Error('settle')) },
    ],
    [
      'close',
      'coreClose',
      { close: async () => Promise.reject(new Error('close')) },
    ],
  ] as const)(
    'stops without opening B when %s fails',
    async (_name, stage, options) => {
      const harness = createHarness({ running: true, ...options });

      await expect(
        harness.coordinator.switchProject(request(true)),
      ).resolves.toMatchObject({
        status: 'failed',
        stage,
        sourceRetained: true,
      });
      expect(harness.calls.some((call) => call.startsWith('open:'))).toBe(
        false,
      );
    },
  );

  it('restores A when opening B fails and reports source retained', async () => {
    const harness = createHarness({
      open: async (path) => {
        if (path === targetPath) throw new Error('target unavailable');
        return project(sourceId, path);
      },
    });

    await expect(
      harness.coordinator.switchProject(request(false)),
    ).resolves.toMatchObject({
      status: 'failed',
      stage: 'coreOpen',
      sourceRetained: true,
    });
    expect(harness.calls).toEqual([
      `close:${sourceId}`,
      `open:${targetPath}`,
      `open:${sourcePath}`,
    ]);
  });

  it('reports restore failure when A cannot be reopened', async () => {
    const harness = createHarness({
      open: async () => Promise.reject(new Error('open failed')),
    });

    await expect(
      harness.coordinator.switchProject(request(false)),
    ).resolves.toMatchObject({
      status: 'failed',
      stage: 'sourceRestore',
      sourceRetained: false,
    });
  });

  it('rejects a concurrent switch while the first switch is in flight', async () => {
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    const harness = createHarness({
      open: async (path) => {
        if (path === targetPath) await openGate;
        return project(targetId, path);
      },
    });
    const first = harness.coordinator.switchProject(request(false));
    await Promise.resolve();
    await Promise.resolve();

    await expect(
      harness.coordinator.switchProject(request(true)),
    ).resolves.toMatchObject({
      status: 'failed',
      code: 'SWITCH_IN_PROGRESS',
      stage: 'coordination',
      sourceRetained: true,
    });
    expect(harness.calls).toEqual([`close:${sourceId}`, `open:${targetPath}`]);

    releaseOpen();
    await expect(first).resolves.toMatchObject({ status: 'switched' });
  });
});
