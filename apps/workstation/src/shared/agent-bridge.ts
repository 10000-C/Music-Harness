import {
  isAgentCommand,
  isAgentCommandResult,
  isAgentEvent,
  type AgentCommand,
  type AgentCommandResult,
  type AgentEvent,
} from '@agent-music/contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export type DesktopAgentCommandResult =
  | Readonly<{ ok: true; result: AgentCommandResult }>
  | Readonly<{ ok: false; code: string; userMessage: string }>;

export const isDesktopAgentCommandResult = (
  value: unknown,
): value is DesktopAgentCommandResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return false;
  }
  if (value.ok) {
    return isAgentCommandResult(value.result);
  }
  return isNonEmptyString(value.code) && isNonEmptyString(value.userMessage);
};

export {
  isAgentCommand,
  isAgentCommandResult,
  isAgentEvent,
  type AgentCommand,
  type AgentCommandResult,
  type AgentEvent,
};
