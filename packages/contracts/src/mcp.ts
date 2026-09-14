import type {
  PendingScopeExtensionView,
  TaskContextView,
} from './candidate.js';
import type { TaskScope } from './domain.js';

declare const operationIdBrand: unique symbol;

export type OperationId = string & {
  readonly [operationIdBrand]: true;
};

export type OperationType = 'generationPlan' | 'scopeExtension';
export type OperationState =
  'pending' | 'succeeded' | 'rejected' | 'cancelled' | 'failed';

export interface OperationFailure {
  readonly code: string;
  readonly message: string;
}

interface OperationViewBase {
  readonly operationId: OperationId;
  readonly type: OperationType;
  readonly state: OperationState;
  readonly createdAt: string;
}

export type GenerationPlanOperationView =
  | (OperationViewBase & {
      readonly type: 'generationPlan';
      readonly state: 'pending';
      readonly summary: string;
      readonly scope: TaskScope;
    })
  | (OperationViewBase & {
      readonly type: 'generationPlan';
      readonly state: 'succeeded';
      readonly result: { readonly task: TaskContextView };
    })
  | (OperationViewBase & {
      readonly type: 'generationPlan';
      readonly state: 'rejected' | 'cancelled';
    })
  | (OperationViewBase & {
      readonly type: 'generationPlan';
      readonly state: 'failed';
      readonly error: OperationFailure;
    });

export type ScopeExtensionOperationView =
  | (OperationViewBase & {
      readonly type: 'scopeExtension';
      readonly state: 'pending';
      readonly request?: PendingScopeExtensionView;
    })
  | (OperationViewBase & {
      readonly type: 'scopeExtension';
      readonly state: 'succeeded';
      readonly result: { readonly task: TaskContextView };
    })
  | (OperationViewBase & {
      readonly type: 'scopeExtension';
      readonly state: 'rejected' | 'cancelled';
    })
  | (OperationViewBase & {
      readonly type: 'scopeExtension';
      readonly state: 'failed';
      readonly error: OperationFailure;
    });

export type OperationView =
  GenerationPlanOperationView | ScopeExtensionOperationView;

/**
 * Core-process-scoped runtime descriptor (Architecture V1.16). One Core
 * process owns one MCP server whose lifetime is independent of Project
 * close/open; Project selection is not connection discovery.
 */
export interface McpRuntimeDescriptor {
  readonly endpoint: string;
  readonly instanceToken: string;
  readonly pid: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLoopbackMcpEndpoint = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const url = new URL(value);
    const port = Number(url.port);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.pathname === '/mcp' &&
      url.search === '' &&
      url.hash === '' &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65_535
    );
  } catch {
    return false;
  }
};

const MCP_RUNTIME_DESCRIPTOR_KEYS = [
  'endpoint',
  'instanceToken',
  'pid',
] as const;

export const isMcpRuntimeDescriptor = (
  value: unknown,
): value is McpRuntimeDescriptor =>
  isRecord(value) &&
  Object.keys(value).length === MCP_RUNTIME_DESCRIPTOR_KEYS.length &&
  MCP_RUNTIME_DESCRIPTOR_KEYS.every((key) => key in value) &&
  isLoopbackMcpEndpoint(value.endpoint) &&
  typeof value.instanceToken === 'string' &&
  value.instanceToken.length > 0 &&
  typeof value.pid === 'number' &&
  Number.isInteger(value.pid) &&
  value.pid > 0;
