import type { CandidateId, ProjectId, TaskId } from './domain.js';

declare const agentSessionIdBrand: unique symbol;
declare const agentExecutionIdBrand: unique symbol;

export type AgentSessionId = string & {
  readonly [agentSessionIdBrand]: true;
};

export type AgentExecutionId = string & {
  readonly [agentExecutionIdBrand]: true;
};

export interface AgentSessionSummary {
  readonly sessionId: AgentSessionId;
  readonly projectId: ProjectId;
  readonly createdAt: string;
}

export interface AgentConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

interface AgentCommandBase {
  readonly requestId: string;
  readonly projectId: ProjectId;
}

export type AgentCommand =
  | (AgentCommandBase & {
      readonly type: 'agent.session.list';
    })
  | (AgentCommandBase & {
      readonly type: 'agent.session.create';
    })
  | (AgentCommandBase & {
      readonly type: 'agent.session.open';
      readonly sessionId: AgentSessionId;
    })
  | (AgentCommandBase & {
      readonly type: 'agent.session.getActive';
    })
  | (AgentCommandBase & {
      readonly type: 'agent.message.send';
      readonly sessionId: AgentSessionId;
      readonly task?: {
        readonly taskId: TaskId;
        readonly candidateId: CandidateId;
      };
      readonly text: string;
    })
  | (AgentCommandBase & {
      readonly type: 'agent.execution.cancel';
    });

export type AgentCommandResult =
  | {
      readonly type: 'agent.session.listed';
      readonly requestId: string;
      readonly sessions: readonly AgentSessionSummary[];
    }
  | {
      readonly type: 'agent.session.created';
      readonly requestId: string;
      readonly session: AgentSessionSummary;
    }
  | {
      readonly type: 'agent.session.opened';
      readonly requestId: string;
      readonly session: AgentSessionSummary;
      readonly messages: readonly AgentConversationMessage[];
    }
  | {
      readonly type: 'agent.session.active';
      readonly requestId: string;
      readonly session?: AgentSessionSummary;
      readonly messages?: readonly AgentConversationMessage[];
    }
  | {
      readonly type: 'agent.message.accepted';
      readonly requestId: string;
      readonly executionId: AgentExecutionId;
    }
  | {
      readonly type: 'agent.execution.cancelAccepted';
      readonly requestId: string;
    };

interface AgentEventBase {
  readonly projectId: ProjectId;
  readonly sessionId: AgentSessionId;
  readonly executionId: AgentExecutionId;
}

export type AgentEvent =
  | (AgentEventBase & {
      readonly type: 'agent.textDelta';
      readonly text: string;
    })
  | (AgentEventBase & {
      readonly type: 'agent.executionCompleted';
    })
  | (AgentEventBase & {
      readonly type: 'agent.executionFailed';
      readonly code: string;
      readonly message: string;
    })
  | (AgentEventBase & {
      readonly type: 'agent.executionCancelled';
    });

export type AgentProcessCommand =
  | {
      readonly type: 'agent.process.health';
      readonly requestId: string;
    }
  | {
      readonly type: 'agent.process.shutdown';
      readonly requestId: string;
    };

export type AgentProcessEvent =
  | { readonly type: 'agent.process.ready' }
  | {
      readonly type: 'agent.process.healthy';
      readonly requestId: string;
    }
  | {
      readonly type: 'agent.process.stopped';
      readonly requestId: string;
    }
  | {
      readonly type: 'agent.process.commandResult';
      readonly result: AgentCommandResult;
    }
  | {
      readonly type: 'agent.process.agentEvent';
      readonly event: AgentEvent;
    }
  | {
      readonly type: 'agent.process.commandFailed';
      readonly requestId: string;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly type: 'agent.process.fatal';
      readonly code: string;
      readonly message: string;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isSessionSummary = (value: unknown): value is AgentSessionSummary =>
  isRecord(value) &&
  isUuid(value.sessionId) &&
  isUuid(value.projectId) &&
  isNonEmptyString(value.createdAt);

const isConversationMessage = (
  value: unknown,
): value is AgentConversationMessage =>
  isRecord(value) &&
  (value.role === 'user' || value.role === 'assistant') &&
  typeof value.text === 'string';

const isConversationMessages = (
  value: unknown,
): value is readonly AgentConversationMessage[] =>
  Array.isArray(value) && value.every(isConversationMessage);

const isCommandBase = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  readonly requestId: string;
  readonly projectId: ProjectId;
} => isNonEmptyString(value.requestId) && isUuid(value.projectId);

export const isAgentCommand = (value: unknown): value is AgentCommand => {
  if (!isRecord(value) || !isCommandBase(value)) {
    return false;
  }

  switch (value.type) {
    case 'agent.session.list':
    case 'agent.session.create':
    case 'agent.session.getActive':
    case 'agent.execution.cancel':
      return true;
    case 'agent.session.open':
      return isUuid(value.sessionId);
    case 'agent.message.send':
      return (
        isUuid(value.sessionId) &&
        (value.task === undefined ||
          (isRecord(value.task) &&
            isUuid(value.task.taskId) &&
            isUuid(value.task.candidateId))) &&
        isNonEmptyString(value.text)
      );
    default:
      return false;
  }
};

export const isAgentCommandResult = (
  value: unknown,
): value is AgentCommandResult => {
  if (!isRecord(value) || !isNonEmptyString(value.requestId)) {
    return false;
  }

  switch (value.type) {
    case 'agent.session.listed':
      return (
        Array.isArray(value.sessions) && value.sessions.every(isSessionSummary)
      );
    case 'agent.session.created':
      return isSessionSummary(value.session);
    case 'agent.session.opened':
      return (
        isSessionSummary(value.session) &&
        isConversationMessages(value.messages)
      );
    case 'agent.session.active':
      return (
        (value.session === undefined || isSessionSummary(value.session)) &&
        (value.messages === undefined ||
          isConversationMessages(value.messages)) &&
        !(value.session === undefined && value.messages !== undefined)
      );
    case 'agent.message.accepted':
      return isUuid(value.executionId);
    case 'agent.execution.cancelAccepted':
      return true;
    default:
      return false;
  }
};

export const isAgentEvent = (value: unknown): value is AgentEvent => {
  if (
    !isRecord(value) ||
    !isUuid(value.projectId) ||
    !isUuid(value.sessionId) ||
    !isUuid(value.executionId)
  ) {
    return false;
  }

  switch (value.type) {
    case 'agent.textDelta':
      return typeof value.text === 'string';
    case 'agent.executionCompleted':
    case 'agent.executionCancelled':
      return true;
    case 'agent.executionFailed':
      return isNonEmptyString(value.code) && isNonEmptyString(value.message);
    default:
      return false;
  }
};

export const isAgentProcessCommand = (
  value: unknown,
): value is AgentProcessCommand =>
  isRecord(value) &&
  (value.type === 'agent.process.health' ||
    value.type === 'agent.process.shutdown') &&
  isNonEmptyString(value.requestId);

export const isAgentProcessEvent = (
  value: unknown,
): value is AgentProcessEvent => {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case 'agent.process.ready':
      return true;
    case 'agent.process.healthy':
    case 'agent.process.stopped':
      return isNonEmptyString(value.requestId);
    case 'agent.process.commandResult':
      return isAgentCommandResult(value.result);
    case 'agent.process.agentEvent':
      return isAgentEvent(value.event);
    case 'agent.process.commandFailed':
      return (
        isNonEmptyString(value.requestId) &&
        isNonEmptyString(value.code) &&
        isNonEmptyString(value.message)
      );
    case 'agent.process.fatal':
      return isNonEmptyString(value.code) && isNonEmptyString(value.message);
    default:
      return false;
  }
};
