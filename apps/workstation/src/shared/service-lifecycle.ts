import { isProjectCommand, type CoreProjectRequest } from './project-bridge.js';
import {
  isCorePlaybackRequest,
  type CorePlaybackRequest,
} from './playback-bridge.js';

export const SERVICE_LIFECYCLE_PROTOCOL_VERSION = 1 as const;

export type ServiceKind = 'core' | 'agent';
export type MainToServiceMessage =
  | Readonly<{ type: 'healthCheck'; protocolVersion: 1; requestId: string }>
  | Readonly<{ type: 'shutdown'; protocolVersion: 1; requestId: string }>
  | CoreProjectRequest
  | CorePlaybackRequest;
export type ServiceToMainMessage =
  | Readonly<{ type: 'ready'; protocolVersion: 1; service: ServiceKind }>
  | Readonly<{ type: 'healthResult'; protocolVersion: 1; requestId: string }>
  | Readonly<{
      type: 'fatal';
      protocolVersion: 1;
      service: ServiceKind;
      code: string;
      message: string;
    }>
  | Readonly<{
      type: 'shutdownComplete';
      protocolVersion: 1;
      requestId: string;
    }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export const isServiceKind = (value: unknown): value is ServiceKind =>
  value === 'core' || value === 'agent';
const hasVersion = (value: Record<string, unknown>): boolean =>
  value.protocolVersion === SERVICE_LIFECYCLE_PROTOCOL_VERSION;

export const isMainToServiceMessage = (
  value: unknown,
): value is MainToServiceMessage => {
  if (!isRecord(value) || !hasVersion(value)) return false;
  if (value.type === 'projectCommand') return isProjectCommand(value.command);
  if (value.type === 'playback.readCurrent')
    return isCorePlaybackRequest(value);
  if (!isRequestId(value.requestId)) return false;
  return value.type === 'healthCheck' || value.type === 'shutdown';
};

export const isServiceToMainMessage = (
  value: unknown,
): value is ServiceToMainMessage => {
  if (!isRecord(value) || !hasVersion(value)) return false;
  switch (value.type) {
    case 'ready':
      return isServiceKind(value.service);
    case 'healthResult':
    case 'shutdownComplete':
      return isRequestId(value.requestId);
    case 'fatal':
      return (
        isServiceKind(value.service) &&
        typeof value.code === 'string' &&
        value.code.length > 0 &&
        typeof value.message === 'string' &&
        value.message.length > 0
      );
    default:
      return false;
  }
};
