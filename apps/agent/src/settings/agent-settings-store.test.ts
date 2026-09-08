import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentSettingsError,
  AgentSettingsStore,
  type AgentSettings,
} from './agent-settings-store.js';

const tempDirectories: string[] = [];

const makeStore = async (): Promise<{
  readonly directory: string;
  readonly path: string;
  readonly store: AgentSettingsStore;
}> => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-settings-'));
  tempDirectories.push(directory);
  const path = join(directory, 'settings.json');
  return { directory, path, store: new AgentSettingsStore(path) };
};

const settings = (overrides: Partial<AgentSettings> = {}): AgentSettings => ({
  formatVersion: 1,
  activeModelConfigId: 'primary',
  modelConfigs: [
    {
      id: 'primary',
      endpoint: 'http://127.0.0.1:11434/v1',
      apiKey: 'secret-primary-key',
      model: 'test-model-a',
      parameters: { temperature: 0.3 },
    },
    {
      id: 'secondary',
      endpoint: 'https://provider.example/v1',
      apiKey: 'secret-secondary-key',
      model: 'test-model-b',
    },
  ],
  agent: { maxRepairAttempts: 2 },
  ...overrides,
});

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AgentSettingsStore', () => {
  it('reports missing settings without inventing a model configuration', async () => {
    const { store } = await makeStore();

    await expect(store.read()).rejects.toMatchObject({
      code: 'SETTINGS_NOT_FOUND',
    } satisfies Partial<AgentSettingsError>);
  });

  it('writes and reads a valid settings document atomically', async () => {
    const { directory, path, store } = await makeStore();

    await store.write(settings());

    await expect(store.read()).resolves.toEqual(settings());
    expect(await readdir(directory)).toEqual(['settings.json']);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(settings());
  });

  it('rejects invalid settings with secret-safe errors', async () => {
    const { path, store } = await makeStore();
    const invalidDocuments: unknown[] = [
      settings({ activeModelConfigId: 'missing' }),
      settings({ agent: { maxRepairAttempts: -1 } }),
      settings({
        modelConfigs: [
          {
            id: 'primary',
            endpoint: 'not-a-url',
            apiKey: 'secret-primary-key',
            model: 'test-model-a',
          },
        ],
      }),
      settings({
        modelConfigs: [
          {
            id: 'primary',
            endpoint: 'https://provider.example/v1',
            apiKey: '',
            model: 'test-model-a',
          },
        ],
      }),
    ];

    for (const invalid of invalidDocuments) {
      await writeFile(path, JSON.stringify(invalid), 'utf8');
      try {
        await store.read();
        expect.unreachable('invalid settings should reject');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentSettingsError);
        expect(String(error)).not.toContain('secret-primary-key');
      }
    }
  });

  it('reads the active model and repair limit dynamically', async () => {
    const { store } = await makeStore();
    await store.write(settings());

    await expect(store.getActiveModelConfig()).resolves.toMatchObject({
      id: 'primary',
      model: 'test-model-a',
    });
    await expect(store.getMaxRepairAttempts()).resolves.toBe(2);

    await store.write(
      settings({
        activeModelConfigId: 'secondary',
        agent: { maxRepairAttempts: 0 },
      }),
    );

    await expect(store.getActiveModelConfig()).resolves.toMatchObject({
      id: 'secondary',
      model: 'test-model-b',
    });
    await expect(store.getMaxRepairAttempts()).resolves.toBe(0);
  });

  it('uses owner-only file permissions on POSIX systems', async () => {
    const { path, store } = await makeStore();
    await store.write(settings());

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });
});
