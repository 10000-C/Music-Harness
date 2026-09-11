import {
  isServiceKind,
  type ServiceKind,
} from '../shared/service-lifecycle.js';
import type { ProjectEvent } from '@agent-music/contracts';
import {
  isCandidateCommand as isContractCandidateCommand,
  type CandidateEvent,
} from '@agent-music/contracts';
import { isProjectCommand, isProjectEvent } from './project-bridge.js';
import { isCoreCandidateResponse } from './candidate-bridge.js';
import { isCorePlaybackResponse } from './playback-bridge.js';
import type { CorePlaybackResponse } from './playback-bridge.js';
import {
  isDesktopAgentCommandResult,
  type DesktopAgentCommandResult,
} from './agent-bridge.js';
import {
  isAgentCommand,
  isAgentEvent,
  type AgentCommand,
  type AgentEvent,
} from '@agent-music/contracts';

export const shellIpcChannels = {
  snapshot: 'shell:snapshot',
  restart: 'shell:restart',
  subscribe: 'shell:subscribe',
  directory: 'shell:directory',
  exportPath: 'shell:export',
  project: 'shell:project',
  candidate: 'shell:candidate',
  playback: 'shell:playback',
  agent: 'shell:agent',
  agentEvent: 'shell:agent:event',
} as const;

export type ProjectDirectoryPurpose = 'create' | 'open' | 'saveAs';
export type ExportFormat = 'abc' | 'midi' | 'wav';
export interface CommandResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly userMessage?: string;
}
export interface DirectoryDialogResult extends CommandResult {
  readonly path?: string;
  readonly cancelled?: boolean;
}
export interface ExportPathRequest {
  readonly format: ExportFormat;
  readonly suggestedName: string;
}
export type FileDialogResult = DirectoryDialogResult;
export type ProjectCommandResult =
  | Readonly<{ ok: true; event: ProjectEvent }>
  | Readonly<{ ok: false; code: string; userMessage: string }>;
export type CandidateCommandResult =
  | Readonly<{ ok: true; events: readonly CandidateEvent[] }>
  | Readonly<{ ok: false; code: string; userMessage: string }>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasAsciiControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
};

export const isCommandResult = (value: unknown): value is CommandResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  return (
    value.ok ||
    (typeof value.code === 'string' &&
      value.code.length > 0 &&
      typeof value.userMessage === 'string' &&
      value.userMessage.length > 0)
  );
};

export const isDirectoryDialogResult = (
  value: unknown,
): value is DirectoryDialogResult => {
  if (!isCommandResult(value)) return false;
  const result = value as CommandResult & {
    readonly path?: unknown;
    readonly cancelled?: unknown;
  };
  if (!result.ok) return true;
  return (
    (result.cancelled === true && result.path === undefined) ||
    (typeof result.path === 'string' &&
      result.path.length > 0 &&
      result.cancelled === undefined)
  );
};

export const isProjectDirectoryPurpose = (
  value: unknown,
): value is ProjectDirectoryPurpose =>
  value === 'create' || value === 'open' || value === 'saveAs';
export const isExportPathRequest = (
  value: unknown,
): value is ExportPathRequest => {
  if (typeof value !== 'object' || value === null) return false;
  const { format, suggestedName } = value as {
    format?: unknown;
    suggestedName?: unknown;
  };
  const windowsStem =
    typeof suggestedName === 'string'
      ? (suggestedName.split('.')[0] ?? '')
      : '';
  const hasControlCharacter =
    typeof suggestedName === 'string' &&
    hasAsciiControlCharacter(suggestedName);
  return (
    ['abc', 'midi', 'wav'].includes(format as string) &&
    typeof suggestedName === 'string' &&
    suggestedName.length > 0 &&
    suggestedName.length <= 240 &&
    suggestedName !== '.' &&
    suggestedName !== '..' &&
    !/[<>:"/\\|?*]/u.test(suggestedName) &&
    !hasControlCharacter &&
    !/[. ]$/u.test(suggestedName) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(windowsStem)
  );
};

export { isProjectCommand, isProjectEvent };
export const isCandidateCommand = isContractCandidateCommand;
export { isCorePlaybackResponse };
export type { CorePlaybackResponse };

export const isProjectCommandResult = (
  value: unknown,
): value is ProjectCommandResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return isProjectEvent(value.event);
  return (
    typeof value.code === 'string' && typeof value.userMessage === 'string'
  );
};

export const isCandidateCommandResult = (
  value: unknown,
): value is CandidateCommandResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) {
    return isCoreCandidateResponse({
      type: 'candidateEvents',
      protocolVersion: 1,
      requestId: 'shell-candidate-result',
      events: value.events,
    });
  }
  return (
    typeof value.code === 'string' && typeof value.userMessage === 'string'
  );
};
export { isServiceKind };
export type { ServiceKind };
export {
  isDesktopAgentCommandResult,
  type DesktopAgentCommandResult,
  isAgentCommand,
  isAgentEvent,
  type AgentCommand,
  type AgentEvent,
};

