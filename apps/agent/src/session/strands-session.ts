import { SessionManager } from '@strands-agents/sdk';
import { LocalFileStorage } from '@strands-agents/sdk/storage';
import type { AgentSessionId } from '@agent-music/contracts';

export interface StrandsSessionResources {
  readonly sessionManager: SessionManager;
  readonly storage: LocalFileStorage;
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
