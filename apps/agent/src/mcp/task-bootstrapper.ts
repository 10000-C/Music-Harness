import {
  TRACK_IDS,
  isTaskScope,
  type McpRuntimeDescriptor,
  type OperationId,
  type OperationView,
  type ProjectId,
  type TaskContextView,
  type TaskId,
} from '@agent-music/contracts';

import { createStrandsMcpClient } from './strands-mcp.js';

export interface TaskBootstrapDescriptorPort {
  read(projectId: ProjectId): Promise<McpRuntimeDescriptor>;
}

export class StrandsTaskBootstrapError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StrandsTaskBootstrapError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasCanonicalTrackIds = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === TRACK_IDS.length &&
  TRACK_IDS.every((trackId, index) => value[index] === trackId);

const isTaskContextView = (value: unknown): value is TaskContextView =>
  isRecord(value) &&
  typeof value.taskId === 'string' &&
  typeof value.projectId === 'string' &&
  typeof value.candidateId === 'string' &&
  typeof value.baseRevision === 'string' &&
  value.baseRevision.length > 0 &&
  isTaskScope(value.scope) &&
  typeof value.scopeRevision === 'number' &&
  Number.isInteger(value.scopeRevision) &&
  value.scopeRevision >= 0 &&
  (value.state === 'editing' || value.state === 'validating') &&
  (value.candidateState === 'active' ||
    value.candidateState === 'ready' ||
    value.candidateState === 'accepting' ||
    value.candidateState === 'stale') &&
  Array.isArray(value.allowedOperations) &&
  value.allowedOperations.every(
    (operation) =>
      operation === 'replaceScopedMusic' ||
      operation === 'updateMusicalProperties' ||
      operation === 'resizeComposition',
  ) &&
  hasCanonicalTrackIds(value.trackIds) &&
  typeof value.createdAt === 'string';

const parseTextResult = (result: unknown): unknown => {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    throw new StrandsTaskBootstrapError(
      'Music Core returned an invalid Task bootstrap result',
    );
  }
  const text = result.content.find(
    (item): item is Record<string, unknown> & { readonly text: string } =>
      isRecord(item) && typeof item.text === 'string',
  );
  if (text === undefined) {
    throw new StrandsTaskBootstrapError(
      'Music Core returned an invalid Task bootstrap result',
    );
  }
  try {
    return JSON.parse(text.text) as unknown;
  } catch {
    throw new StrandsTaskBootstrapError(
      'Music Core returned an invalid Task bootstrap result',
    );
  }
};

const isOperationView = (value: unknown): value is OperationView =>
  isRecord(value) &&
  typeof value.operationId === 'string' &&
  (value.type === 'generationPlan' || value.type === 'scopeExtension') &&
  (value.state === 'pending' ||
    value.state === 'succeeded' ||
    value.state === 'rejected' ||
    value.state === 'cancelled' ||
    value.state === 'failed') &&
  typeof value.createdAt === 'string';

export class StrandsTaskBootstrapper {
  public constructor(
    private readonly descriptors: TaskBootstrapDescriptorPort,
  ) {}

  public async getTaskContext(
    projectId: ProjectId,
    taskId: TaskId,
    signal: AbortSignal,
  ): Promise<TaskContextView> {
    const descriptor = await this.descriptors.read(projectId);
    const client = createStrandsMcpClient(descriptor);
    try {
      const tools = await client.listTools();
      const getTaskContext = tools.find(
        (tool) => tool.name === 'getTaskContext',
      );
      if (getTaskContext === undefined) {
        throw new StrandsTaskBootstrapError(
          'Music Core does not expose getTaskContext',
        );
      }
      const result = await client.callTool(
        getTaskContext,
        { taskId },
        { signal },
      );
      const context = parseTextResult(result);
      if (!isTaskContextView(context)) {
        throw new StrandsTaskBootstrapError(
          'Music Core returned an invalid Task bootstrap context',
        );
      }
      return context;
    } finally {
      await client.disconnect();
    }
  }
  public async cancelOperation(
    projectId: ProjectId,
    operationId: OperationId,
    signal: AbortSignal,
  ): Promise<OperationView> {
    const descriptor = await this.descriptors.read(projectId);
    const client = createStrandsMcpClient(descriptor);
    try {
      const tools = await client.listTools();
      const cancelOperation = tools.find(
        (tool) => tool.name === 'cancelOperation',
      );
      if (cancelOperation === undefined) {
        throw new StrandsTaskBootstrapError(
          'Music Core does not expose cancelOperation',
        );
      }
      const result = await client.callTool(
        cancelOperation,
        { operationId },
        { signal },
      );
      const operation = parseTextResult(result);
      if (!isOperationView(operation)) {
        throw new StrandsTaskBootstrapError(
          'Music Core returned an invalid Operation result',
        );
      }
      return operation;
    } finally {
      await client.disconnect();
    }
  }
}
