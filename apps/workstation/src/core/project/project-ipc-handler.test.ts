import {
  PROJECT_FORMAT_VERSION,
  PROJECT_PPQ,
  TRACK_IDS,
  type OpenedProject,
  type ProjectId,
} from '@agent-music/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectError } from './project-error.js';
import {
  ProjectIpcHandler,
  type ProjectFoundationPort,
} from './project-ipc-handler.js';

const projectId = 'f31dd9a5-2f55-4bd0-8cf6-f684c41314cc' as ProjectId;
const opened: OpenedProject = {
  projectId,
  projectPath: 'C:/music/demo',
  currentRevision: 'a'.repeat(40),
  state: 'ready',
  manifest: {
    formatVersion: PROJECT_FORMAT_VERSION,
    projectId,
    timebase: { ppq: PROJECT_PPQ },
    tracks: TRACK_IDS,
  },
};

let fake: {
  [K in keyof ProjectFoundationPort]: ReturnType<typeof vi.fn>;
};
let handler: ProjectIpcHandler;

beforeEach(() => {
  fake = {
    createProject: vi.fn(() => Promise.resolve(opened)),
    openProject: vi.fn(() => Promise.resolve(opened)),
    recoverCurrent: vi.fn(() => Promise.resolve(opened)),
    saveProjectAs: vi.fn(() => Promise.resolve(opened)),
    closeProject: vi.fn(() => Promise.resolve()),
  };
  handler = new ProjectIpcHandler(fake as ProjectFoundationPort);
});

describe('ProjectIpcHandler', () => {
  it('routes the five approved project commands', async () => {
    const commands = [
      {
        type: 'project.create' as const,
        requestId: 'request-1',
        projectPath: 'C:/music/demo',
      },
      {
        type: 'project.open' as const,
        requestId: 'request-2',
        projectPath: 'C:/music/demo',
      },
      { type: 'project.recoverCurrent' as const, requestId: 'request-3' },
      {
        type: 'project.saveAs' as const,
        requestId: 'request-4',
        targetPath: 'C:/music/copy',
      },
      { type: 'project.close' as const, requestId: 'request-5' },
    ];

    const events = [];
    for (const command of commands) {
      events.push(await handler.handle(command));
    }

    expect(fake.createProject).toHaveBeenCalledWith('C:/music/demo');
    expect(fake.openProject).toHaveBeenCalledWith('C:/music/demo');
    expect(fake.recoverCurrent).toHaveBeenCalledOnce();
    expect(fake.saveProjectAs).toHaveBeenCalledWith('C:/music/copy');
    expect(fake.closeProject).toHaveBeenCalledOnce();
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(events.at(-1)).toMatchObject({
      type: 'project.closed',
      requestId: 'request-5',
    });
  });

  it('preserves structured errors and normalizes unknown failures', async () => {
    fake.openProject.mockRejectedValueOnce(
      new ProjectError(
        'PROJECT_WRITE_LOCKED',
        'Project is already writable elsewhere',
      ),
    );
    fake.openProject.mockRejectedValueOnce(new Error('secret details'));

    await expect(
      handler.handle({
        type: 'project.open',
        requestId: 'request-1',
        projectPath: 'C:/music/demo',
      }),
    ).resolves.toEqual({
      type: 'project.failed',
      requestId: 'request-1',
      sequence: 1,
      code: 'PROJECT_WRITE_LOCKED',
      message: 'Project is already writable elsewhere',
    });

    await expect(
      handler.handle({
        type: 'project.open',
        requestId: 'request-2',
        projectPath: 'C:/music/demo',
      }),
    ).resolves.toEqual({
      type: 'project.failed',
      requestId: 'request-2',
      sequence: 2,
      code: 'PROJECT_INTERNAL_ERROR',
      message: 'Unexpected project failure',
    });
  });
});
