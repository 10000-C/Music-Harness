import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentSessionId,
  McpRuntimeDescriptor,
  ProjectId,
} from '@agent-music/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentModelConfig } from '../settings/index.js';
import { StrandsAgentRuntimeFactory } from './strands-agent-factory.js';

const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
const sessionId = '22222222-2222-4222-8222-222222222222' as AgentSessionId;
const descriptor: McpRuntimeDescriptor = {
  projectId,
  endpoint: 'http://127.0.0.1:43127/mcp',
  instanceToken: 'test-token',
  pid: 1234,
};
const modelA: AgentModelConfig = {
  id: 'model-a',
  endpoint: 'http://127.0.0.1:5001/v1',
  apiKey: 'key-a',
  model: 'model-a',
};
const modelB: AgentModelConfig = {
  id: 'model-b',
  endpoint: 'http://127.0.0.1:5002/v1',
  apiKey: 'key-b',
  model: 'model-b',
};
const tempDirectories: string[] = [];

const makeStorageRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'strands-agent-factory-'));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('StrandsAgentRuntimeFactory', () => {
  it('reads the latest model config for each invocation while preserving the Session ID', async () => {
    const getActiveModelConfig = vi
      .fn()
      .mockResolvedValueOnce(modelA)
      .mockResolvedValueOnce(modelB);
    const readDescriptor = vi.fn().mockResolvedValue(descriptor);
    const factory = new StrandsAgentRuntimeFactory({
      settings: { getActiveModelConfig },
      descriptors: { read: readDescriptor },
      storageRoot: await makeStorageRoot(),
    });

    const first = await factory.create(projectId, sessionId);
    const second = await factory.create(projectId, sessionId);

    expect(first.agent.sessionId).toBe(sessionId);
    expect(second.agent.sessionId).toBe(sessionId);
    expect(first.agent.model.getConfig().modelId).toBe('model-a');
    expect(second.agent.model.getConfig().modelId).toBe('model-b');
    expect(getActiveModelConfig).toHaveBeenCalledTimes(2);
    expect(readDescriptor).toHaveBeenCalledTimes(2);
  });
});
