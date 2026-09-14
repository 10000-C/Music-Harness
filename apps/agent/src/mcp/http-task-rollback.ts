import type { McpRuntimeDescriptor } from '@agent-music/contracts';

import type { TaskRollbackPort } from '../workflow/index.js';

export interface HttpTaskRollbackDependencies {
  readonly descriptors: {
    read(): Promise<McpRuntimeDescriptor>;
  };
  readonly fetchImpl?: typeof fetch;
  /** Must stay below the supervisor shutdown timeout (3s). */
  readonly timeoutMs?: number;
}

const CONTROL_TIMEOUT_MS = 2_000;

/**
 * Production TaskRollbackPort: calls the Core process's host-side control
 * endpoint (POST /control/cancel-task) on the same loopback HTTP server as
 * the MCP transport, authenticated with the runtime descriptor's instance
 * token. This is infrastructure for Agent-side rollback during cancel,
 * final failure, and controlled shutdown — never an MCP Tool.
 */
export class HttpTaskRollback implements TaskRollbackPort {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(
    private readonly dependencies: HttpTaskRollbackDependencies,
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.timeoutMs = dependencies.timeoutMs ?? CONTROL_TIMEOUT_MS;
  }

  public async cancelTask(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly taskId: string;
  }): Promise<unknown> {
    const descriptor = await this.dependencies.descriptors.read();
    const controlUrl = `${descriptor.endpoint.slice(
      0,
      -'/mcp'.length,
    )}/control/cancel-task`;
    let response: Response;
    try {
      response = await this.fetchImpl(controlUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${descriptor.instanceToken}`,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new HttpTaskRollbackError(
        'AGENT_ROLLBACK_UNAVAILABLE',
        'Music Core rollback endpoint is unreachable',
      );
    }

    const body = await response.text();
    if (response.status === 200) {
      return { ok: true };
    }
    try {
      const payload = JSON.parse(body) as { code?: unknown; message?: unknown };
      if (
        typeof payload.code === 'string' &&
        typeof payload.message === 'string'
      ) {
        throw new HttpTaskRollbackError(payload.code, payload.message);
      }
    } catch (error) {
      if (error instanceof HttpTaskRollbackError) {
        throw error;
      }
    }
    throw new HttpTaskRollbackError(
      'AGENT_ROLLBACK_FAILED',
      'Music Core rollback endpoint returned an unexpected response',
    );
  }
}

export class HttpTaskRollbackError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpTaskRollbackError';
  }
}
