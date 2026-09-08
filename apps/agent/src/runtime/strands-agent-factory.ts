import { Agent, type McpClient } from '@strands-agents/sdk';
import type {
  AgentSessionId,
  McpRuntimeDescriptor,
  ProjectId,
} from '@agent-music/contracts';

import { createStrandsMcpClient } from '../mcp/index.js';
import { createOpenAiChatModel } from '../model/index.js';
import { createStrandsSession } from '../session/index.js';
import type { AgentModelConfig } from '../settings/index.js';

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

export interface StrandsAgentRuntime {
  readonly agent: Agent;
  readonly mcpClient: McpClient;
  readonly modelConfigurationId: string;
  dispose(): Promise<void>;
}

export class StrandsAgentRuntimeFactory {
  public constructor(
    private readonly dependencies: StrandsAgentRuntimeFactoryDependencies,
  ) {}

  public async create(
    projectId: ProjectId,
    sessionId: AgentSessionId,
  ): Promise<StrandsAgentRuntime> {
    const [modelConfig, descriptor] = await Promise.all([
      this.dependencies.settings.getActiveModelConfig(),
      this.dependencies.descriptors.read(projectId),
    ]);
    const session = createStrandsSession(
      sessionId,
      this.dependencies.storageRoot,
    );
    const mcpClient = createStrandsMcpClient(descriptor);
    const agent = new Agent({
      model: createOpenAiChatModel(modelConfig),
      tools: [mcpClient],
      sessionManager: session.sessionManager,
      storage: session.storage,
      contextManager: 'auto',
      toolExecutor: 'sequential',
      printer: false,
    });

    return {
      agent,
      mcpClient,
      modelConfigurationId: modelConfig.id,
      dispose: async () => {
        await mcpClient.disconnect();
      },
    };
  }
}
