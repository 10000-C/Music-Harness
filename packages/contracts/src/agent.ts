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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

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
