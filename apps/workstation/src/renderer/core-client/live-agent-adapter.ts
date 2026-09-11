import type {
  AgentCommandResult,
  AgentConversationMessage,
  AgentEvent,
  AgentExecutionId,
  AgentSessionId,
  AgentSessionSummary,
  CandidateId,
  ProjectId,
  TaskId,
} from '@agent-music/contracts';
import type { DesktopBridge } from '../../shared/desktop-bridge.js';

export interface LiveAgentState {
  readonly projectId: ProjectId;
  readonly activeSession: AgentSessionSummary | null;
  readonly sessions: readonly AgentSessionSummary[];
  readonly messages: readonly AgentConversationMessage[];
  readonly streamingText: string;
  readonly isExecuting: boolean;
  readonly activeExecutionId: AgentExecutionId | null;
  readonly error: Readonly<{ code: string; message: string }> | null;
}

export interface CreateLiveAgentAdapterOptions {
  readonly projectId: ProjectId;
  readonly bridge: DesktopBridge;
}

export interface LiveAgentAdapter {
  getState(): LiveAgentState;
  subscribe(listener: (state: LiveAgentState) => void): () => void;
  initialize(): Promise<void>;
  createSession(): Promise<AgentSessionSummary | null>;
  openSession(sessionId: AgentSessionId): Promise<void>;
  sendMessage(
    text: string,
    task?: { taskId: TaskId; candidateId: CandidateId },
  ): Promise<void>;
  cancel(): Promise<void>;
  dispose(): void;
}

const createRequestId = (action: string): string =>
  `agent-${action}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

export const createLiveAgentAdapter = ({
  projectId,
  bridge,
}: CreateLiveAgentAdapterOptions): LiveAgentAdapter => {
  let state: LiveAgentState = {
    projectId,
    activeSession: null,
    sessions: [],
    messages: [],
    streamingText: '',
    isExecuting: false,
    activeExecutionId: null,
    error: null,
  };

  const listeners = new Set<(current: LiveAgentState) => void>();

  const setState = (patch: Partial<LiveAgentState>): void => {
    state = Object.freeze({ ...state, ...patch });
    listeners.forEach((listener) => listener(state));
  };

  const handleAgentEvent = (event: AgentEvent): void => {
    if (event.projectId !== state.projectId) return;
    if (
      state.activeSession !== null &&
      event.sessionId !== state.activeSession.sessionId
    ) {
      return;
    }

    switch (event.type) {
      case 'agent.textDelta':
        setState({
          streamingText: state.streamingText + event.text,
        });
        break;

      case 'agent.executionCompleted': {
        const finishedText = state.streamingText.trim();
        const updatedMessages = finishedText.length > 0
          ? [...state.messages, { role: 'assistant' as const, text: finishedText }]
          : state.messages;
        setState({
          isExecuting: false,
          activeExecutionId: null,
          streamingText: '',
          messages: updatedMessages,
          error: null,
        });
        break;
      }

      case 'agent.executionFailed': {
        const finishedText = state.streamingText.trim();
        const updatedMessages = finishedText.length > 0
          ? [...state.messages, { role: 'assistant' as const, text: finishedText }]
          : state.messages;
        setState({
          isExecuting: false,
          activeExecutionId: null,
          streamingText: '',
          messages: updatedMessages,
          error: { code: event.code, message: event.message },
        });
        break;
      }

      case 'agent.executionCancelled': {
        const finishedText = state.streamingText.trim();
        const updatedMessages = finishedText.length > 0
          ? [
              ...state.messages,
              {
                role: 'assistant' as const,
                text: `${finishedText} [Cancelled]`,
              },
            ]
          : state.messages;
        setState({
          isExecuting: false,
          activeExecutionId: null,
          streamingText: '',
          messages: updatedMessages,
          error: null,
        });
        break;
      }
    }
  };

  const unsubscribeEvent = bridge.onAgentEvent(handleAgentEvent);

  const listSessions = async (): Promise<readonly AgentSessionSummary[]> => {
    const outcome = await bridge.dispatchAgent({
      type: 'agent.session.list',
      requestId: createRequestId('list'),
      projectId: state.projectId,
    });
    if (outcome.ok && outcome.result.type === 'agent.session.listed') {
      setState({ sessions: outcome.result.sessions });
      return outcome.result.sessions;
    }
    return [];
  };

  const initialize = async (): Promise<void> => {
    try {
      const activeOutcome = await bridge.dispatchAgent({
        type: 'agent.session.getActive',
        requestId: createRequestId('get-active'),
        projectId: state.projectId,
      });

      if (activeOutcome.ok && activeOutcome.result.type === 'agent.session.active') {
        const session = activeOutcome.result.session;
        const messages = activeOutcome.result.messages ?? [];
        if (session !== undefined) {
          setState({
            activeSession: session,
            messages,
            error: null,
          });
          void listSessions();
          return;
        }
      }

      const sessions = await listSessions();
      if (sessions.length > 0 && sessions[0] !== undefined) {
        await openSession(sessions[0].sessionId);
      } else {
        await createSession();
      }
    } catch (error: unknown) {
      setState({
        error: {
          code: 'AGENT_INIT_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Could not initialize Agent session.',
        },
      });
    }
  };

  const createSession = async (): Promise<AgentSessionSummary | null> => {
    try {
      const outcome = await bridge.dispatchAgent({
        type: 'agent.session.create',
        requestId: createRequestId('create'),
        projectId: state.projectId,
      });
      if (outcome.ok && outcome.result.type === 'agent.session.created') {
        const session = outcome.result.session;
        setState({
          activeSession: session,
          sessions: [...state.sessions, session],
          messages: [],
          streamingText: '',
          error: null,
        });
        return session;
      }
      if (!outcome.ok) {
        setState({
          error: { code: outcome.code, message: outcome.userMessage },
        });
      }
      return null;
    } catch (error: unknown) {
      setState({
        error: {
          code: 'SESSION_CREATE_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to create agent session.',
        },
      });
      return null;
    }
  };

  const openSession = async (sessionId: AgentSessionId): Promise<void> => {
    try {
      const outcome = await bridge.dispatchAgent({
        type: 'agent.session.open',
        requestId: createRequestId('open'),
        projectId: state.projectId,
        sessionId,
      });
      if (outcome.ok && outcome.result.type === 'agent.session.opened') {
        setState({
          activeSession: outcome.result.session,
          messages: outcome.result.messages,
          streamingText: '',
          error: null,
        });
      } else if (!outcome.ok) {
        setState({
          error: { code: outcome.code, message: outcome.userMessage },
        });
      }
    } catch (error: unknown) {
      setState({
        error: {
          code: 'SESSION_OPEN_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to open agent session.',
        },
      });
    }
  };

  const sendMessage = async (
    text: string,
    task?: { taskId: TaskId; candidateId: CandidateId },
  ): Promise<void> => {
    if (state.activeSession === null) {
      setState({
        error: {
          code: 'NO_ACTIVE_SESSION',
          message: 'Cannot send message without an active session.',
        },
      });
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    setState({
      messages: [...state.messages, { role: 'user', text: trimmed }],
      isExecuting: true,
      streamingText: '',
      error: null,
    });

    try {
      const outcome = await bridge.dispatchAgent({
        type: 'agent.message.send',
        requestId: createRequestId('send-message'),
        projectId: state.projectId,
        sessionId: state.activeSession.sessionId,
        text: trimmed,
        ...(task !== undefined ? { task } : {}),
      });

      if (outcome.ok && outcome.result.type === 'agent.message.accepted') {
        setState({ activeExecutionId: outcome.result.executionId });
      } else if (!outcome.ok) {
        setState({
          isExecuting: false,
          error: { code: outcome.code, message: outcome.userMessage },
        });
      }
    } catch (error: unknown) {
      setState({
        isExecuting: false,
        error: {
          code: 'MESSAGE_SEND_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to dispatch message to agent.',
        },
      });
    }
  };

  const cancel = async (): Promise<void> => {
    if (!state.isExecuting) return;
    try {
      await bridge.dispatchAgent({
        type: 'agent.execution.cancel',
        requestId: createRequestId('cancel'),
        projectId: state.projectId,
      });
    } catch {
      // Best-effort cancellation dispatch
    }
  };

  const dispose = (): void => {
    listeners.clear();
    unsubscribeEvent();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    initialize,
    createSession,
    openSession,
    sendMessage,
    cancel,
    dispose,
  };
};
