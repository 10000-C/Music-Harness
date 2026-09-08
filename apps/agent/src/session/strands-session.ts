import {
  Agent,
  Model,
  SessionManager,
  type BaseModelConfig,
  type ModelStreamEvent,
} from '@strands-agents/sdk';
import { LocalFileStorage } from '@strands-agents/sdk/storage';
import type {
  AgentConversationMessage,
  AgentSessionId,
} from '@agent-music/contracts';

export interface StrandsSessionResources {
  readonly sessionManager: SessionManager;
  readonly storage: LocalFileStorage;
}

class SessionHydrationModel extends Model {
  private config: BaseModelConfig = { modelId: 'session-hydration' };

  public override updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  public override getConfig(): BaseModelConfig {
    return this.config;
  }

  public override async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    const events: readonly ModelStreamEvent[] = [];
    for (const event of events) {
      yield event;
    }
  }
}

export const createStrandsSession = (
  sessionId: AgentSessionId,
  storageRoot: string,
): StrandsSessionResources => {
  const storage = new LocalFileStorage(storageRoot);
  return {
    storage,
    sessionManager: new SessionManager({
      sessionId,
      storage,
      saveLatestOn: 'invocation',
    }),
  };
};

export const readStrandsConversation = async (
  sessionId: AgentSessionId,
  storageRoot: string,
): Promise<readonly AgentConversationMessage[]> => {
  const resources = createStrandsSession(sessionId, storageRoot);
  const agent = new Agent({
    model: new SessionHydrationModel(),
    sessionManager: resources.sessionManager,
    storage: resources.storage,
    contextManager: 'auto',
    printer: false,
  });
  await agent.initialize();

  const messages: AgentConversationMessage[] = [];
  for (const message of agent.messages) {
    const text = message.content
      .filter((block) => block.type === 'textBlock')
      .map((block) => block.text)
      .join('');
    if (text.length > 0) {
      messages.push({ role: message.role, text });
    }
  }
  return messages;
};
