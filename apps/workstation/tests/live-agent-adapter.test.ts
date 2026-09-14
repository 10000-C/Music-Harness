import { describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentExecutionId,
  AgentSessionId,
  ProjectId,
} from '@agent-music/contracts';
import { createLiveAgentAdapter } from '../src/renderer/core-client/live-agent-adapter.js';
import type { DesktopBridge } from '../src/shared/desktop-bridge.js';

const projectId = '00000000-0000-4000-8000-000000000002' as ProjectId;
const sessionId = '00000000-0000-4000-8000-000000000001' as AgentSessionId;
const executionId = '00000000-0000-4000-8000-000000000003' as AgentExecutionId;

const createFakeBridge = () => {
  let eventListener: ((event: AgentEvent) => void) | undefined;
  const dispatchAgent = vi.fn();
  const onAgentEvent = vi.fn((listener: (event: AgentEvent) => void) => {
    eventListener = listener;
    return () => {
      eventListener = undefined;
    };
  });

  const emit = (event: AgentEvent) => {
    eventListener?.(event);
  };

  const bridge = {
    dispatchAgent,
    onAgentEvent,
  } as unknown as DesktopBridge;

  return { bridge, dispatchAgent, onAgentEvent, emit };
};

describe('LiveAgentAdapter', () => {
  it('initializes by opening active session and recovering conversation messages', async () => {
    const { bridge, dispatchAgent } = createFakeBridge();
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.active',
        requestId: 'req-active',
        session: {
          sessionId,
          projectId,
          createdAt: '2026-09-11T00:00:00.000Z',
        },
        messages: [{ role: 'assistant', text: 'Hello from previous session' }],
      },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.listed',
        requestId: 'req-list',
        sessions: [
          { sessionId, projectId, createdAt: '2026-09-11T00:00:00.000Z' },
        ],
      },
    });

    const adapter = createLiveAgentAdapter({ projectId, bridge });
    await adapter.initialize();

    const state = adapter.getState();
    expect(state.activeSession?.sessionId).toBe(sessionId);
    expect(state.messages).toEqual([
      { role: 'assistant', text: 'Hello from previous session' },
    ]);
  });

  it('creates a new session if no active session or listed session exists', async () => {
    const { bridge, dispatchAgent } = createFakeBridge();
    // getActive returns no session
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.active',
        requestId: 'req-active',
      },
    });
    // list returns empty
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.listed',
        requestId: 'req-list',
        sessions: [],
      },
    });
    // create returns new session
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.created',
        requestId: 'req-create',
        session: {
          sessionId,
          projectId,
          createdAt: '2026-09-11T00:00:00.000Z',
        },
      },
    });

    const adapter = createLiveAgentAdapter({ projectId, bridge });
    await adapter.initialize();

    const state = adapter.getState();
    expect(state.activeSession?.sessionId).toBe(sessionId);
    expect(state.messages).toEqual([]);
  });

  it('streams text deltas and finalizes message on execution completion', async () => {
    const { bridge, dispatchAgent, emit } = createFakeBridge();
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.active',
        requestId: 'req-active',
        session: { sessionId, projectId, createdAt: '2026-09-11T00:00:00.000Z' },
        messages: [],
      },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: { type: 'agent.session.listed', requestId: 'req-list', sessions: [] },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.message.accepted',
        requestId: 'req-send',
        executionId,
      },
    });

    const adapter = createLiveAgentAdapter({ projectId, bridge });
    await adapter.initialize();

    await adapter.sendMessage('Add a drum groove');
    expect(adapter.getState().isExecuting).toBe(true);
    expect(adapter.getState().messages).toEqual([
      { role: 'user', text: 'Add a drum groove' },
    ]);

    emit({
      type: 'agent.textDelta',
      projectId,
      sessionId,
      executionId,
      text: 'Creating drum pattern… ',
    });
    expect(adapter.getState().streamingText).toBe('Creating drum pattern… ');

    emit({
      type: 'agent.textDelta',
      projectId,
      sessionId,
      executionId,
      text: 'Adding hi-hats.',
    });
    expect(adapter.getState().streamingText).toBe(
      'Creating drum pattern… Adding hi-hats.',
    );

    emit({
      type: 'agent.executionCompleted',
      projectId,
      sessionId,
      executionId,
    });

    const finalState = adapter.getState();
    expect(finalState.isExecuting).toBe(false);
    expect(finalState.streamingText).toBe('');
    expect(finalState.messages).toEqual([
      { role: 'user', text: 'Add a drum groove' },
      {
        role: 'assistant',
        text: 'Creating drum pattern… Adding hi-hats.',
      },
    ]);
  });

  it('handles execution failure and records error state', async () => {
    const { bridge, dispatchAgent, emit } = createFakeBridge();
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.active',
        requestId: 'req-active',
        session: { sessionId, projectId, createdAt: '2026-09-11T00:00:00.000Z' },
        messages: [],
      },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: { type: 'agent.session.listed', requestId: 'req-list', sessions: [] },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.message.accepted',
        requestId: 'req-send',
        executionId,
      },
    });

    const adapter = createLiveAgentAdapter({ projectId, bridge });
    await adapter.initialize();

    await adapter.sendMessage('Shape chords');
    emit({
      type: 'agent.textDelta',
      projectId,
      sessionId,
      executionId,
      text: 'Starting analysis…',
    });

    emit({
      type: 'agent.executionFailed',
      projectId,
      sessionId,
      executionId,
      code: 'PROVIDER_ERROR',
      message: 'Rate limit exceeded.',
    });

    const state = adapter.getState();
    expect(state.isExecuting).toBe(false);
    expect(state.error).toEqual({
      code: 'PROVIDER_ERROR',
      message: 'Rate limit exceeded.',
    });
    expect(state.messages).toEqual([
      { role: 'user', text: 'Shape chords' },
      { role: 'assistant', text: 'Starting analysis…' },
    ]);
  });

  it('ignores late events from another execution or session', async () => {
    const { bridge, dispatchAgent, emit } = createFakeBridge();
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.active',
        requestId: 'req-active',
        session: { sessionId, projectId, createdAt: '2026-09-11T00:00:00.000Z' },
        messages: [],
      },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: { type: 'agent.session.listed', requestId: 'req-list', sessions: [] },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.message.accepted',
        requestId: 'req-send',
        executionId,
      },
    });

    const adapter = createLiveAgentAdapter({ projectId, bridge });
    await adapter.initialize();
    await adapter.sendMessage('Keep this execution isolated');

    emit({
      type: 'agent.textDelta',
      projectId,
      sessionId,
      executionId: '00000000-0000-4000-8000-000000000099' as AgentExecutionId,
      text: 'late text',
    });
    emit({
      type: 'agent.executionFailed',
      projectId,
      sessionId: '00000000-0000-4000-8000-000000000098' as AgentSessionId,
      executionId,
      code: 'LATE',
      message: 'late failure',
    });

    expect(adapter.getState().streamingText).toBe('');
    expect(adapter.getState().error).toBeNull();
    expect(adapter.getState().isExecuting).toBe(true);
  });

  it('marks message as cancelled when execution is cancelled', async () => {
    const { bridge, dispatchAgent, emit } = createFakeBridge();
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.session.active',
        requestId: 'req-active',
        session: { sessionId, projectId, createdAt: '2026-09-11T00:00:00.000Z' },
        messages: [],
      },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: { type: 'agent.session.listed', requestId: 'req-list', sessions: [] },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.message.accepted',
        requestId: 'req-send',
        executionId,
      },
    });
    dispatchAgent.mockResolvedValueOnce({
      ok: true,
      result: {
        type: 'agent.execution.cancelAccepted',
        requestId: 'req-cancel',
      },
    });

    const adapter = createLiveAgentAdapter({ projectId, bridge });
    await adapter.initialize();

    await adapter.sendMessage('Reharmonize verse');
    emit({
      type: 'agent.textDelta',
      projectId,
      sessionId,
      executionId,
      text: 'Partial thought',
    });

    await adapter.cancel();
    emit({
      type: 'agent.executionCancelled',
      projectId,
      sessionId,
      executionId,
    });

    const state = adapter.getState();
    expect(state.isExecuting).toBe(false);
    expect(state.messages).toEqual([
      { role: 'user', text: 'Reharmonize verse' },
      { role: 'assistant', text: 'Partial thought [Cancelled]' },
    ]);
  });
});
