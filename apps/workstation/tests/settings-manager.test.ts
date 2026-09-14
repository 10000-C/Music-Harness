import { describe, expect, it, vi, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import {
  readAgentSettings,
  writeAgentSettings,
} from '../src/main/settings-manager.js';
import type { AgentSettings } from '../src/shared/settings-bridge.js';

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    rm: vi.fn(),
  },
}));

describe('settings-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads valid settings from disk', async () => {
    const validSettings: AgentSettings = {
      formatVersion: 1,
      activeModelConfigId: 'primary',
      modelConfigs: [
        {
          id: 'primary',
          endpoint: 'https://api.openai.com/v1',
          apiKey: 'sk-test-key-12345',
          model: 'gpt-4o',
        },
      ],
      agent: { maxRepairAttempts: 2 },
    };

    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(validSettings));

    const result = await readAgentSettings();
    expect(result).toEqual(validSettings);
  });

  it('returns null when settings file does not exist (ENOENT) or is invalid JSON', async () => {
    const enoentError = new Error('File not found') as Error & { code: string };
    enoentError.code = 'ENOENT';
    vi.mocked(fs.readFile).mockRejectedValueOnce(enoentError);

    const result1 = await readAgentSettings();
    expect(result1).toBeNull();

    vi.mocked(fs.readFile).mockResolvedValueOnce('invalid json content');
    const result2 = await readAgentSettings();
    expect(result2).toBeNull();

    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify({ provider: 'unknown', apiKey: 123 }),
    );
    const result3 = await readAgentSettings();
    expect(result3).toBeNull();
  });

  it('validates settings before writing and rejects invalid payloads', async () => {
    const invalidSettings = {
      formatVersion: 1,
      activeModelConfigId: 'primary',
      modelConfigs: [],
      agent: { maxRepairAttempts: 2 },
    };

    const result = await writeAgentSettings(invalidSettings);
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_SETTINGS',
      userMessage: 'The provided settings are invalid.',
    });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('writes settings atomically via temporary file and rename', async () => {
    const validSettings: AgentSettings = {
      formatVersion: 1,
      activeModelConfigId: 'primary',
      modelConfigs: [
        {
          id: 'primary',
          endpoint: 'http://localhost:11434/v1',
          apiKey: 'local-test-key',
          model: 'deepseek-v3',
        },
      ],
      agent: { maxRepairAttempts: 2 },
    };

    vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);
    vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined);
    vi.mocked(fs.rename).mockResolvedValueOnce(undefined);

    const result = await writeAgentSettings(validSettings);
    expect(result).toEqual({ ok: true });

    expect(fs.mkdir).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
      mode: 0o700,
    });
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/),
      JSON.stringify(validSettings, null, 2),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/),
      expect.not.stringMatching(/\.tmp$/),
    );
  });

  it('handles write failures gracefully without throwing', async () => {
    const validSettings: AgentSettings = {
      formatVersion: 1,
      activeModelConfigId: 'primary',
      modelConfigs: [
        {
          id: 'primary',
          endpoint: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-4o',
        },
      ],
      agent: { maxRepairAttempts: 2 },
    };

    vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error('Permission denied'));

    const result = await writeAgentSettings(validSettings);
    expect(result).toEqual({
      ok: false,
      code: 'SETTINGS_WRITE_FAILED',
      userMessage: 'Failed to save settings. Check permissions and try again.',
    });
  });
});
