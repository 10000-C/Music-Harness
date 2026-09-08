import {
  Agent,
  type AgentResult,
  type AgentStreamEvent,
  type McpClient,
} from '@strands-agents/sdk';
import type {
  AgentSessionId,
  McpRuntimeDescriptor,
  ProjectId,
} from '@agent-music/contracts';

import { createStrandsMcpClient } from '../mcp/index.js';
import { DynamicOpenAiChatModel } from '../model/index.js';
import { createStrandsSession } from '../session/index.js';
import type { AgentModelConfig } from '../settings/index.js';
import { AGENT_SYSTEM_PROMPT } from './agent-system-prompt.js';

export interface ActiveModelSettingsPort {
  getActiveModelConfig(): Promise<AgentModelConfig>;
}

export interface RuntimeDescriptorPort {
  read(projectId: ProjectId): Promise<McpRuntimeDescriptor>;
}

interface StrandsAgentRuntimeFactoryDependencies {
  readonly settings: ActiveModelSettingsPort;
  readonly descriptors: RuntimeDescriptorPort;
  readonly storageRoot: string;
}

export interface StrandsAgentRuntimeOptions {
  readonly repairMode?: boolean;
}

export interface StrandsAgentRuntime {
  readonly agent: Agent;
  readonly mcpClient: McpClient;
  stream(
    text: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent, AgentResult, undefined>;
  dispose(): Promise<void>;
}

export class StrandsAgentRuntimeFactory {
  public constructor(
    private readonly dependencies: StrandsAgentRuntimeFactoryDependencies,
  ) {}

  public async create(
    projectId: ProjectId,
    sessionId: AgentSessionId,
    options: StrandsAgentRuntimeOptions = {},
  ): Promise<StrandsAgentRuntime> {
    const [modelConfig, descriptor] = await Promise.all([
      this.dependencies.settings.getActiveModelConfig(),
      this.dependencies.descriptors.read(projectId),
    ]);
    const session = createStrandsSession(
      sessionId,
      this.dependencies.storageRoot,
    );
    const mcpClient = createStrandsMcpClient(descriptor, options);
    const agent = new Agent({
      model: new DynamicOpenAiChatModel(
        modelConfig,
        this.dependencies.settings,
      ),
      tools: [mcpClient],
      systemPrompt: AGENT_SYSTEM_PROMPT,
      sessionManager: session.sessionManager,
      storage: session.storage,
      contextManager: 'auto',
      toolExecutor: 'sequential',
      printer: false,
    });

    return {
      agent,
      mcpClient,
      stream: (text, signal) => agent.stream(text, { cancelSignal: signal }),
      dispose: async () => {
        await mcpClient.disconnect();
      },
    };
  }
}
