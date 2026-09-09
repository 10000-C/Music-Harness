export interface TestMcpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: {
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
}

export interface TestMcpTextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface TestMcpClient {
  listTools(): Promise<{ readonly tools: readonly TestMcpTool[] }>;
  callTool(
    input: {
      readonly name: string;
      readonly arguments?: Readonly<Record<string, unknown>>;
    },
    options?: { readonly timeout?: number },
  ): Promise<{
    readonly content: readonly TestMcpTextContent[];
    readonly isError?: boolean;
  }>;
  close(): Promise<void>;
}

export declare const connectMcpTestClient: (
  endpoint: string,
  instanceToken: string,
) => Promise<TestMcpClient>;
