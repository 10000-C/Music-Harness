import type { IncomingMessage, ServerResponse } from 'node:http';

export interface McpTextResult {
  readonly isError?: boolean;
  readonly content: readonly {
    readonly type: 'text';
    readonly text: string;
  }[];
}

export declare class StreamableHTTPServerTransport {
  public constructor(options?: {
    readonly enableJsonResponse?: boolean;
    readonly sessionIdGenerator?: () => string;
    readonly onsessioninitialized?: (sessionId: string) => void | Promise<void>;
    readonly onsessionclosed?: (sessionId: string) => void | Promise<void>;
  });
  public readonly sessionId: string | undefined;
  public handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void>;
  public close(): Promise<void>;
}

export declare class McpServer {
  public constructor(info: { readonly name: string; readonly version: string });
  public registerTool(
    name: string,
    config: {
      readonly description?: string;
      readonly inputSchema?: unknown;
    },
    callback: (
      input: unknown,
      extra: { readonly signal: AbortSignal },
    ) => Promise<McpTextResult>,
  ): unknown;
  public connect(transport: StreamableHTTPServerTransport): Promise<void>;
  public close(): Promise<void>;
}
