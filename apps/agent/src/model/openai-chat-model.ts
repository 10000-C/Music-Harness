import { OpenAIModel } from '@strands-agents/sdk/models/openai';

import type { AgentModelConfig } from '../settings/index.js';

export const createOpenAiChatModel = (config: AgentModelConfig): OpenAIModel =>
  new OpenAIModel({
    api: 'chat',
    modelId: config.model,
    apiKey: config.apiKey,
    clientConfig: {
      baseURL: config.endpoint,
    },
    ...(config.parameters === undefined
      ? {}
      : { params: { ...config.parameters } }),
  });
