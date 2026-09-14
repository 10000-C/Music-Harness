import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, removeHandler, showOpenDialog, showSaveDialog } = vi.hoisted(
  () => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    removeHandler: vi.fn(),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  }),
);

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    removeHandler,
  },
  dialog: { showOpenDialog, showSaveDialog },
}));

import { channels, registerShellIpc } from '../src/main/register-shell-ipc.js';
import {
  chooseExportPath,
  chooseProjectDirectory,
} from '../src/main/desktop-dialogs.js';
import type { ServiceSupervisor } from '../src/main/service-supervisor/index.js';
import {
  compileComposition,
  createInitialCanonicalAbc,
} from '../src/core/composition/index.js';

const window = {
  isDestroyed: vi.fn(() => false),
  webContents: { isDestroyed: vi.fn(() => false), send: vi.fn() },
};
let snapshotListener: ((snapshot: unknown) => void) | undefined;
let agentEventListener: ((event: unknown) => void) | undefined;
let candidateEventListener: ((event: unknown) => void) | undefined;
const supervisor = {
  getSnapshot: vi.fn(() => ({ core: 'ready', agent: 'ready' })),
  restart: vi.fn(async () => undefined),
  dispatchProject: vi.fn(async () => ({
    type: 'project.closed',
    requestId: 'project-test',
    sequence: 1,
  })),
  dispatchCandidate: vi.fn(async () => []),
  readCandidateState: vi.fn(async () => ({
    projectId: '00000000-0000-4000-8000-000000000001',
    sequence: 0,
    candidate: null,
    task: null,
  })),
  dispatchAgent: vi.fn(async () => ({
    type: 'agent.session.created',
    requestId: 'agent-test',
    session: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      createdAt: '2026-09-11T00:00:00.000Z',
    },
  })),
  onAgentEvent: vi.fn((listener: (event: unknown) => void) => {
    agentEventListener = listener;
    return vi.fn();
  }),
  onCandidateEvent: vi.fn((listener: (event: unknown) => void) => {
    candidateEventListener = listener;
    return vi.fn();
  }),
  readCurrentPlayback: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  subscribe: vi.fn((listener: (snapshot: unknown) => void) => {
    snapshotListener = listener;
    return vi.fn();
  }),
} as unknown as ServiceSupervisor;

const invoke = async (channel: string, payload?: unknown) => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler({}, payload);
};

describe('shell Main IPC and dialogs', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    snapshotListener = undefined;
    agentEventListener = undefined;
    candidateEventListener = undefined;
    registerShellIpc(window as never, supervisor);
  });

  it('registers the Main request handlers and rejects an invalid restart before the supervisor', async () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        channels.directory,
        channels.exportPath,
        channels.candidate,
        channels.candidateState,
        channels.playback,
        channels.project,
        channels.restart,
        channels.snapshot,
        channels.agent,
      ].sort(),
    );

    await expect(
      invoke(channels.restart, 'not-a-service'),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_SERVICE' });
    expect(supervisor.restart).not.toHaveBeenCalled();

    await expect(invoke(channels.restart, 'agent')).resolves.toEqual({
      ok: true,
    });
    expect(supervisor.restart).toHaveBeenCalledWith('agent');
  });

  it('forwards only valid Project Commands to the Utility Process', async () => {
    await expect(
      invoke(channels.project, { type: 'project.create' }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_PROJECT_COMMAND',
    });
    expect(supervisor.dispatchProject).not.toHaveBeenCalled();

    const command = {
      type: 'project.close' as const,
      requestId: 'project-test',
    };
    await expect(invoke(channels.project, command)).resolves.toEqual({
      ok: true,
      event: { type: 'project.closed', requestId: 'project-test', sequence: 1 },
    });
    expect(supervisor.dispatchProject).toHaveBeenCalledWith(command);
  });

  it('forwards Candidate control commands without exposing Core internals', async () => {
    const command = {
      type: 'candidate.reject' as const,
      requestId: 'candidate-test',
      projectId: '00000000-0000-4000-8000-000000000001',
      candidateId: '00000000-0000-4000-8000-000000000002',
    };
    await expect(invoke(channels.candidate, command)).resolves.toEqual({
      ok: true,
      events: [],
    });
    expect(supervisor.dispatchCandidate).toHaveBeenCalledWith(command);
  });

  it('reads Candidate state and forwards only project-scoped Candidate notifications', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    await expect(invoke(channels.candidateState, projectId)).resolves.toEqual({
      ok: true,
      state: {
        projectId,
        sequence: 0,
        candidate: null,
        task: null,
      },
    });
    expect(supervisor.readCandidateState).toHaveBeenCalledWith(projectId);

    await expect(
      invoke(channels.candidateState, 'not-a-project'),
    ).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_PROJECT_ID',
    });

    const notification = {
      type: 'candidateState.event' as const,
      protocolVersion: 1 as const,
      projectId,
      event: {
        type: 'candidate.changed' as const,
        requestId: 'candidate-event-1',
        sequence: 1,
      },
    };
    candidateEventListener?.(notification);
    candidateEventListener?.({ type: 'invalid.event' });
    expect(window.webContents.send).toHaveBeenCalledWith(
      channels.candidateEvent,
      notification,
    );
  });

  it('forwards a validated Current playback bundle and fails closed otherwise', async () => {
    const compiled = compileComposition(createInitialCanonicalAbc());
    const bundle = {
      type: 'playback.current' as const,
      protocolVersion: 1 as const,
      requestId: 'playback-test',
      revision: 'revision-1',
      compilation: compiled.playback,
      timeline: compiled.timelineViewModel,
    };
    vi.mocked(supervisor.readCurrentPlayback).mockResolvedValueOnce(bundle);
    await expect(invoke(channels.playback)).resolves.toEqual(bundle);

    vi.mocked(supervisor.readCurrentPlayback).mockResolvedValueOnce({
      type: 'playback.current',
      protocolVersion: 1,
      requestId: 'broken',
      revision: 'revision-2',
    } as never);
    await expect(invoke(channels.playback)).resolves.toBeNull();

    vi.mocked(supervisor.readCurrentPlayback).mockRejectedValueOnce(
      new Error('internal Core error'),
    );
    await expect(invoke(channels.playback)).resolves.toBeNull();
  });

  it('rejects invalid dialog arguments without opening a native dialog', async () => {
    await expect(invoke(channels.directory, 'delete')).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_DIRECTORY_PURPOSE',
    });
    await expect(
      invoke(channels.exportPath, { format: 'mp3', suggestedName: 'song.mp3' }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_EXPORT_REQUEST' });
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('normalizes Main boundary failures without exposing raw errors', async () => {
    vi.mocked(supervisor.restart).mockRejectedValueOnce(
      new Error('secret restart error'),
    );
    showOpenDialog.mockRejectedValueOnce(new Error('secret dialog error'));
    showSaveDialog.mockRejectedValueOnce(new Error('secret dialog error'));

    await expect(invoke(channels.restart, 'core')).resolves.toEqual({
      ok: false,
      code: 'SERVICE_RESTART_FAILED',
      userMessage: 'The service could not be restarted.',
    });
    await expect(invoke(channels.directory, 'open')).resolves.toEqual({
      ok: false,
      code: 'DIRECTORY_DIALOG_FAILED',
      userMessage: 'The directory picker could not be opened.',
    });
    await expect(
      invoke(channels.exportPath, {
        format: 'wav',
        suggestedName: 'song.wav',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'EXPORT_DIALOG_FAILED',
      userMessage: 'The export picker could not be opened.',
    });
  });

  it('keeps dialog cancellation distinct from a dialog that returns no path', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(
      chooseProjectDirectory(window as never, 'open'),
    ).resolves.toEqual({ ok: true, cancelled: true });
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    await expect(
      chooseProjectDirectory(window as never, 'open'),
    ).resolves.toMatchObject({ ok: false, code: 'DIALOG_NO_PATH' });

    showSaveDialog.mockResolvedValueOnce({ canceled: true });
    await expect(
      chooseExportPath(window as never, {
        format: 'wav',
        suggestedName: 'song.wav',
      }),
    ).resolves.toEqual({ ok: true, cancelled: true });
    showSaveDialog.mockResolvedValueOnce({ canceled: false });
    await expect(
      chooseExportPath(window as never, {
        format: 'wav',
        suggestedName: 'song.wav',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'DIALOG_NO_PATH' });
  });

  it('forwards only validated service fleet snapshots to the Renderer', () => {
    snapshotListener?.({ core: 'ready', agent: 'failed' });
    snapshotListener?.({ core: 'ready', agent: 'unknown' });
    snapshotListener?.({ core: 'ready' });

    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(channels.subscribe, {
      core: 'ready',
      agent: 'failed',
    });
  });

  it('forwards valid Agent commands and rejects invalid commands before supervisor', async () => {
    await expect(invoke(channels.agent, { invalid: true })).resolves.toEqual({
      ok: false,
      code: 'INVALID_AGENT_COMMAND',
      userMessage: 'Invalid Agent command.',
    });

    const validCommand = {
      type: 'agent.session.create',
      requestId: 'req-session-create',
      projectId: '00000000-0000-4000-8000-000000000002',
    };
    await expect(invoke(channels.agent, validCommand)).resolves.toEqual({
      ok: true,
      result: {
        type: 'agent.session.created',
        requestId: 'agent-test',
        session: {
          sessionId: '00000000-0000-4000-8000-000000000001',
          projectId: '00000000-0000-4000-8000-000000000002',
          createdAt: '2026-09-11T00:00:00.000Z',
        },
      },
    });
    expect(supervisor.dispatchAgent).toHaveBeenCalledWith(validCommand);
  });

  it('forwards validated Agent events to the Renderer window', () => {
    const validEvent = {
      type: 'agent.textDelta',
      projectId: '00000000-0000-4000-8000-000000000002',
      sessionId: '00000000-0000-4000-8000-000000000001',
      executionId: '00000000-0000-4000-8000-000000000003',
      text: 'Adding bass line…',
    };
    agentEventListener?.(validEvent);
    agentEventListener?.({ type: 'invalid.event' });

    expect(window.webContents.send).toHaveBeenCalledWith(
      channels.agentEvent,
      validEvent,
    );
  });
});
