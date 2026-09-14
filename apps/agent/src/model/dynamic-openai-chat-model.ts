import {
  Model,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from '@strands-agents/sdk';
import type {
  OpenAIModel,
  OpenAIModelConfig,
} from '@strands-agents/sdk/models/openai';

import type { AgentModelConfig } from '../settings/index.js';
import { createOpenAiChatModel } from './openai-chat-model.js';

export interface DynamicModelSettingsPort {
  getActiveModelConfig(): Promise<AgentModelConfig>;
}

export class DynamicOpenAiChatModel extends Model<OpenAIModelConfig> {
  private delegate: OpenAIModel;
  private configurationId: string;

  public constructor(
    initialConfig: AgentModelConfig,
    private readonly settings: DynamicModelSettingsPort,
  ) {
    super();
    this.delegate = createOpenAiChatModel(initialConfig);
    this.configurationId = initialConfig.id;
  }

  public get activeConfigurationId(): string {
    return this.configurationId;
  }

  public updateConfig(modelConfig: OpenAIModelConfig): void {
    this.delegate.updateConfig(modelConfig);
  }

  public getConfig(): OpenAIModelConfig {
    return this.delegate.getConfig();
  }

  public async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    const config = await this.settings.getActiveModelConfig();
    this.delegate = createOpenAiChatModel(config);
    this.configurationId = config.id;
    yield* this.delegate.stream(messages, options);
  }
}
