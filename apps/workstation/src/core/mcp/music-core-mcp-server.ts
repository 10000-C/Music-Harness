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

import {
  CandidateError,
  candidateErrorPayload,
} from '../candidate/candidate-error.js';
import type { MusicCoreToolName } from './music-core-tool-host.js';

export interface MusicCoreToolInvoker {
  listTools(): readonly MusicCoreToolName[];
  call(
    name: MusicCoreToolName,
    input: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

/**
 * Host-side control surface mounted on the same loopback HTTP server as the
 * MCP endpoint but never exposed as MCP Tools. Used by the Agent process for
 * infrastructure calls (for example Task rollback during controlled
 * shutdown) that must not be model-visible.
 */
export interface MusicCoreControlPort {
  cancelTask(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly taskId: string;
  }): Promise<unknown>;
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
  resolveProjectId: () => ProjectId | undefined,
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
    'Read Canonical composition content inside the authorized Task Scope. Optionally provide targetScope to read a smaller sub-scope; targetScope must be contained by the authorized Task Scope. Returned tracks[].abc values are canonical voice-body fragments and are the formatting reference for replaceScopedMusic.',
    envelopeSchema.extend({ targetScope: scopeSchema.optional() }),
  );
  const generationPlanSchema = z.object({
    operationId: z.uuid(),
    summary: z.string().min(1),
    scope: scopeSchema,
  });
  server.registerTool(
    'submitGenerationPlan',
    {
      description:
        'Create or recover the initial generation-plan operation for the current Project. Provide a caller-stable operationId. The call returns immediately and never waits for the human decision; use getOperation for the terminal result/Task bootstrap.',
      inputSchema: generationPlanSchema,
    },
    async (input, extra) => {
      const parsedInput = generationPlanSchema.parse(input);
      const projectId = resolveProjectId();
      if (projectId === undefined) {
        return toolResult(
          candidateErrorPayload(
            new CandidateError(
              'PROJECT_NOT_OPEN',
              'No Project is open in this Core process',
            ),
          ),
          true,
        );
      }
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
    'Create or recover a Scope Extension operation. Provide a caller-stable operationId so retries after transport timeout are idempotent. The call returns operation state without waiting for user authorization; use getOperation to observe completion and cancelOperation to retract a pending request.',
    z.object({
      operationId: z.uuid(),
      envelope: envelopeSchema,
      requestedScope: scopeSchema,
    }),
  );
  registerJsonTool(
    server,
    host,
    'getOperation',
    'Read the authoritative state/result of a long-running Core operation by operationId. Use this after submitGenerationPlan/requestScopeExtension and after any transport timeout.',
    z.object({ operationId: z.uuid() }),
  );
  registerJsonTool(
    server,
    host,
    'cancelOperation',
    'Explicitly cancel a pending Core operation. Cancellation is a business action, not a transport timeout. If the operation already committed, its terminal state/result is returned.',
    z.object({ operationId: z.uuid() }),
  );
  registerJsonTool(
    server,
    host,
    'replaceScopedMusic',
    'Replace musical content only inside the authorized existing Scope. Each replacements[].abc is one track voice-body fragment only: never include X:/T:/M:/L:/Q:/K:/V: document headers or [V:...] markers. Follow getScopedComposition tracks[].abc as the canonical formatting example. ABC accidentals precede pitches (^F, _B, =C; do not use F# or Bb). P0 fragment syntax supports notes/accidentals/octaves/durations, rests z, chords [CEG], bar |, end ties -, inline velocity [I:MIDI vol N] with integer N=1..127 immediately before a Note/Chord onset, and authorized inline [Q:1/4=N] or [K:...] directives only after tick 0. Initial Tempo uses updateMusicalProperties; initial Key remains the K: header. A timeRange replacement must preserve exact duration. For long-form generation, first use resizeComposition(targetMeasureCount), then fill bounded timeRange chunks. wholeProject replacement remains available for genuine whole-song rewrites. If VALIDATION_FAILED reports ABC_NOT_CANONICAL with phase=currentComposition, retrying a different fragment cannot repair the existing Candidate preflight failure.',
    z.object({
      envelope: envelopeSchema,
      targetScope: scopeSchema.optional(),
      replacements: z.array(replacementSchema).min(1),
    }),
  );
  registerJsonTool(
    server,
    host,
    'updateMusicalProperties',
    'Update initial project-level musical properties for an authorized wholeProject Task covering all six tracks. P0 supports global Meter and initial Tempo. Provide meter {numerator, denominator}, tempo {bpm}, or both. This changes the canonical M:/Q: headers and rebuilds derived outputs; it does not rewrite notes, rests, barlines, local tempo events, or song length.',
    z
      .object({
        envelope: envelopeSchema,
        meter: z
          .object({
            numerator: z.int().positive(),
            denominator: z.int().positive(),
          })
          .optional(),
        tempo: z.object({ bpm: z.int().positive() }).optional(),
      })
      .refine(
        (value) => value.meter !== undefined || value.tempo !== undefined,
        {
          message: 'Provide meter, tempo, or both',
        },
      ),
  );
  registerJsonTool(
    server,
    host,
    'resizeComposition',
    'Resize the authorized wholeProject/all-six-track Candidate to an absolute target measure count. Core derives ticks from Global Meter + PPQ, appends empty rest measures when growing, is idempotent at the same target, and refuses shrinking that would delete musical content. Use this before segmented timeRange generation; do not send targetTicks or append deltas.',
    z.object({
      envelope: envelopeSchema,
      targetMeasureCount: z.int().positive(),
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
  remove(): Promise<void>;
}

/**
 * Filesystem store for the Core-process-scoped runtime descriptor. The fixed
 * `core.json` filename reflects that one Core process owns one MCP server,
 * independent of which Project (if any) is currently open.
 */
export class RuntimeDescriptorStore {
  private static readonly descriptorFileName = 'core.json';

  public constructor(
    private readonly runtimeDirectory: string,
    private readonly isProcessAlive: (
      pid: number,
    ) => boolean = defaultIsProcessAlive,
  ) {}

  public descriptorPath(): string {
    return join(
      this.runtimeDirectory,
      RuntimeDescriptorStore.descriptorFileName,
    );
  }

  public async write(descriptor: McpRuntimeDescriptor): Promise<void> {
    await mkdir(this.runtimeDirectory, { recursive: true, mode: 0o700 });
    const destination = this.descriptorPath();
    const temporary = `${destination}.${String(process.pid)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  }

  public async remove(): Promise<void> {
    await rm(this.descriptorPath(), { force: true });
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
  /**
   * Resolves the currently open Project at request time. The MCP server is
   * Core-process-scoped and outlives Project close/open, so the Project ID
   * cannot be captured at construction time.
   */
  readonly resolveProjectId: () => ProjectId | undefined;
  readonly runtimeDirectory: string;
  readonly toolHost: MusicCoreToolInvoker;
  readonly control?: MusicCoreControlPort;
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

const cancelTaskControlSchema = z.object({
  projectId: z.uuid(),
  candidateId: z.uuid(),
  taskId: z.uuid(),
});

const CONTROL_BODY_LIMIT_BYTES = 65_536;
const JSON_HEADERS = { 'content-type': 'application/json' } as const;

const parseJsonBody = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

const readRequestBody = (
  request: IncomingMessage,
  limitBytes: number,
): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        request.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', () => {
      resolve(undefined);
    });
  });

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
        await this.descriptorStore.remove();
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
    if (request.url?.startsWith('/control/') === true) {
      await this.handleControlRequest(request, response);
      return;
    }
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

  private async handleControlRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const control = this.options.control;
    if (request.url !== '/control/cancel-task' || control === undefined) {
      response.writeHead(404).end();
      return;
    }
    if (!tokenMatches(request.headers.authorization, this.instanceToken)) {
      response.writeHead(401).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }

    const body = await readRequestBody(request, CONTROL_BODY_LIMIT_BYTES);
    if (body === undefined) {
      response.writeHead(413).end();
      return;
    }
    const parsed = cancelTaskControlSchema.safeParse(parseJsonBody(body));
    if (!parsed.success) {
      response.writeHead(400).end();
      return;
    }

    try {
      await control.cancelTask(parsed.data);
      response.writeHead(200, JSON_HEADERS).end('{"ok":true}');
    } catch (error) {
      const payload = candidateErrorPayload(
        error,
        'Control cancel-task failed',
      );
      response.writeHead(500, JSON_HEADERS).end(JSON.stringify(payload));
    }
  }

  private async createMcpSession(): Promise<McpHttpSession> {
    const mcpServer = new McpServer({
      name: 'agent-music-workstation-core',
      version: '1.0.0',
    });
    registerTools(
      mcpServer,
      this.options.toolHost,
      this.options.resolveProjectId,
    );

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
