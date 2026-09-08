import type { IncomingMessage, ServerResponse } from 'node:http';

export interface McpTextResult {
  readonly content: readonly {
    readonly type: 'text';
    readonly text: string;
  }[];
}

export declare class StreamableHTTPServerTransport {
  public constructor(options?: { readonly enableJsonResponse?: boolean });
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
