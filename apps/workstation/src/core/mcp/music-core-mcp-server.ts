import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { join } from 'node:path';

import { McpServer, StreamableHTTPServerTransport } from './mcp-sdk-runtime.js';
import {
  TRACK_IDS,
  isMcpRuntimeDescriptor,
  type McpRuntimeDescriptor,
  type ProjectId,
} from '@agent-music/contracts';
import { z } from 'zod';

import { candidateErrorPayload } from '../candidate/candidate-error.js';
import type { MusicCoreToolName } from './music-core-tool-host.js';

export interface MusicCoreToolInvoker {
  listTools(): readonly MusicCoreToolName[];
  call(
    name: MusicCoreToolName,
    input: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

const trackIdSchema = z.enum(TRACK_IDS);
const trackIdsSchema = z
  .array(trackIdSchema)
  .min(1)
  .refine((trackIds) => new Set(trackIds).size === trackIds.length, {
    message: 'trackIds must not contain duplicates',
  });
const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wholeProject'), trackIds: trackIdsSchema }),
  z
    .object({
      type: z.literal('timeRange'),
      trackIds: trackIdsSchema,
      startTick: z.int().nonnegative(),
      endTick: z.int().positive(),
    })
    .refine((value) => value.startTick < value.endTick, {
      message: 'startTick must be less than endTick',
    }),
]);
const envelopeSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  candidateId: z.uuid(),
  baseRevision: z.string().min(1),
  expectedScopeRevision: z.int().nonnegative(),
});
const replacementSchema = z.object({
  trackId: trackIdSchema,
  abc: z.string(),
});

const toolResult = (value: unknown, isError = false) => ({
  ...(isError ? { isError: true } : {}),
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(value),
    },
  ],
});

const registerJsonTool = (
  server: McpServer,
  host: MusicCoreToolInvoker,
  name: MusicCoreToolName,
  description: string,
  schema: z.ZodType,
): void => {
  server.registerTool(
    name,
    { description, inputSchema: schema },
    async (input, extra) => {
      const parsedInput = schema.parse(input);
      try {
        return toolResult(
          await host.call(name, parsedInput, { signal: extra.signal }),
        );
      } catch (error) {
        return toolResult(candidateErrorPayload(error), true);
      }
    },
  );
};

const registerTools = (
  server: McpServer,
  host: MusicCoreToolInvoker,
  projectId: ProjectId,
): void => {
  registerJsonTool(
    server,
    host,
    'getTaskContext',
    'Read the current authorized Candidate Task context.',
    z.object({ taskId: z.uuid() }),
  );
  registerJsonTool(
    server,
    host,
    'getScopedComposition',
    'Read Canonical composition content inside the authorized Scope.',
    envelopeSchema,
  );
  const generationPlanSchema = z.object({
    summary: z.string().min(1),
    scope: scopeSchema,
  });
  server.registerTool(
    'submitGenerationPlan',
    {
      description:
        'Submit the initial generation plan for the MCP server current Project and wait for user confirmation. The Project is bound by Core; do not provide a projectId.',
      inputSchema: generationPlanSchema,
    },
    async (input, extra) => {
      const parsedInput = generationPlanSchema.parse(input);
      try {
        return toolResult(
          await host.call(
            'submitGenerationPlan',
            { projectId, ...parsedInput },
            { signal: extra.signal },
          ),
        );
      } catch (error) {
        return toolResult(candidateErrorPayload(error), true);
      }
    },
  );
  registerJsonTool(
    server,
    host,
    'requestScopeExtension',
    'Request a superset Scope and wait for product authorization.',
    z.object({
      envelope: envelopeSchema,
      requestedScope: scopeSchema,
    }),
  );
  registerJsonTool(
    server,
    host,
    'replaceScopedMusic',
    'Replace musical content only inside the authorized Scope.',
    z.object({
      envelope: envelopeSchema,
      replacements: z.array(replacementSchema).min(1),
    }),
  );
  registerJsonTool(
    server,
    host,
    'updateGlobalMeter',
    'Update the global meter for an authorized whole-project Task.',
    z.object({
      envelope: envelopeSchema,
      numerator: z.int().positive(),
      denominator: z.int().positive(),
    }),
  );
  registerJsonTool(
    server,
    host,
    'finishTask',
    'Validate and finish the current Candidate Task.',
    envelopeSchema,
  );
};

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export interface RuntimeDescriptorStorePort {
  cleanupStale(): Promise<void>;
  write(descriptor: McpRuntimeDescriptor): Promise<void>;
  remove(projectId: ProjectId): Promise<void>;
}

export class RuntimeDescriptorStore {
  public constructor(
    private readonly runtimeDirectory: string,
    private readonly isProcessAlive: (
      pid: number,
    ) => boolean = defaultIsProcessAlive,
  ) {}

  public descriptorPath(projectId: ProjectId): string {
    return join(this.runtimeDirectory, `${projectId}.json`);
  }

  public async write(descriptor: McpRuntimeDescriptor): Promise<void> {
    await mkdir(this.runtimeDirectory, { recursive: true, mode: 0o700 });
    const destination = this.descriptorPath(descriptor.projectId);
    const temporary = `${destination}.${String(process.pid)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  }

  public async remove(projectId: ProjectId): Promise<void> {
    await rm(this.descriptorPath(projectId), { force: true });
  }

  public async cleanupStale(): Promise<void> {
    await mkdir(this.runtimeDirectory, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.runtimeDirectory, {
      withFileTypes: true,
    });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const path = join(this.runtimeDirectory, entry.name);
          try {
            const value: unknown = JSON.parse(await readFile(path, 'utf8'));
            if (
              !isMcpRuntimeDescriptor(value) ||
              !this.isProcessAlive(value.pid)
            ) {
              await rm(path, { force: true });
            }
          } catch {
            await rm(path, { force: true });
          }
        }),
    );
  }
}

interface MusicCoreMcpHttpServerOptions {
  readonly projectId: ProjectId;
  readonly runtimeDirectory: string;
  readonly toolHost: MusicCoreToolInvoker;
  readonly createToken?: () => string;
  readonly descriptorStore?: RuntimeDescriptorStorePort;
}

interface McpHttpSession {
  readonly mcpServer: McpServer;
  readonly transport: StreamableHTTPServerTransport;
}

const tokenMatches = (
  authorization: string | undefined,
  token: string,
): boolean => {
  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) {
    return false;
  }
  const supplied = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
};

export class MusicCoreMcpHttpServer {
  private readonly descriptorStore: RuntimeDescriptorStorePort;
  private readonly instanceToken: string;
  private server: ReturnType<typeof createServer> | undefined;
  private descriptor: McpRuntimeDescriptor | undefined;
  private readonly sessions = new Map<string, McpHttpSession>();

  public constructor(private readonly options: MusicCoreMcpHttpServerOptions) {
    this.descriptorStore =
      options.descriptorStore ??
      new RuntimeDescriptorStore(options.runtimeDirectory);
    this.instanceToken =
      options.createToken?.() ?? randomBytes(32).toString('base64url');
  }

  public async start(): Promise<McpRuntimeDescriptor> {
    if (this.server !== undefined) {
      throw new Error('Music Core MCP Server is already running');
    }
    await this.descriptorStore.cleanupStale();

    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      await this.closeServer();
      throw new Error('Music Core MCP Server failed to bind an ephemeral port');
    }

    const descriptor: McpRuntimeDescriptor = {
      projectId: this.options.projectId,
      endpoint: `http://127.0.0.1:${String(address.port)}/mcp`,
      instanceToken: this.instanceToken,
      pid: process.pid,
    };
    try {
      await this.descriptorStore.write(descriptor);
    } catch (publishError) {
      try {
        await this.closeServer();
      } catch (closeError) {
        throw new AggregateError(
          [publishError, closeError],
          'Music Core MCP Server failed to publish its runtime descriptor and close',
          { cause: closeError },
        );
      }
      throw publishError;
    }
    this.descriptor = descriptor;
    return descriptor;
  }

  public async stop(): Promise<void> {
    const descriptor = this.descriptor;
    this.descriptor = undefined;
    let removalError: unknown;
    try {
      if (descriptor !== undefined) {
        await this.descriptorStore.remove(descriptor.projectId);
      }
    } catch (error) {
      removalError = error;
    }

    const closeErrors: unknown[] = [];
    try {
      await this.closeMcpSessions();
    } catch (error) {
      closeErrors.push(error);
    }
    try {
      await this.closeServer();
    } catch (error) {
      closeErrors.push(error);
    }

    const errors = [
      ...(removalError === undefined ? [] : [removalError]),
      ...closeErrors,
    ];
    if (errors.length === 1) {
      throw errors[0] instanceof Error
        ? errors[0]
        : new Error('Music Core MCP Server cleanup failed', {
            cause: errors[0],
          });
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        'Music Core MCP Server failed to remove its runtime descriptor and close',
      );
    }
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    if (!tokenMatches(request.headers.authorization, this.instanceToken)) {
      response.writeHead(401).end();
      return;
    }
    if (
      request.method !== 'POST' &&
      request.method !== 'GET' &&
      request.method !== 'DELETE'
    ) {
      response.writeHead(405).end();
      return;
    }

    const sessionHeader = request.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;
    if (sessionId !== undefined) {
      const session = this.sessions.get(sessionId);
      if (session === undefined) {
        response.writeHead(404).end();
        return;
      }
      await session.transport.handleRequest(request, response);
      return;
    }

    if (request.method !== 'POST') {
      response.writeHead(400).end();
      return;
    }

    const session = await this.createMcpSession();
    try {
      await session.transport.handleRequest(request, response);
    } finally {
      if (session.transport.sessionId === undefined) {
        await session.mcpServer.close();
      }
    }
  }

  private async createMcpSession(): Promise<McpHttpSession> {
    const mcpServer = new McpServer({
      name: 'agent-music-workstation-core',
      version: '1.0.0',
    });
    registerTools(mcpServer, this.options.toolHost, this.options.projectId);

    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, { mcpServer, transport });
      },
      onsessionclosed: (sessionId) => {
        if (this.sessions.get(sessionId)?.transport === transport) {
          this.sessions.delete(sessionId);
        }
      },
    });
    const session = { mcpServer, transport };
    await mcpServer.connect(transport);
    return session;
  }

  private async closeMcpSessions(): Promise<void> {
    const sessions = [...new Set(this.sessions.values())];
    this.sessions.clear();
    const results = await Promise.allSettled(
      sessions.map((session) => session.mcpServer.close()),
    );
    const errors: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(result.reason as unknown);
      }
    }
    if (errors.length === 1) {
      throw errors[0] instanceof Error
        ? errors[0]
        : new Error('Music Core MCP session cleanup failed', {
            cause: errors[0],
          });
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Music Core MCP session cleanup failed');
    }
  }

  private async closeServer(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeAllConnections();
    });
  }
}
