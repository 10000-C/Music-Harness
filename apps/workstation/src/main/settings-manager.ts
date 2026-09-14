import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isAgentSettings,
  type AgentSettings,
} from '../shared/settings-bridge.js';
import type { CommandResult } from '../shared/shell-contracts.js';

const getSettingsPath = (): string =>
  join(homedir(), '.agent-music', 'settings.json');

interface CanonicalModelConfig {
  readonly id: string;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
}

interface CanonicalAgentSettings {
  readonly formatVersion: 1;
  readonly activeModelConfigId: string;
  readonly modelConfigs: readonly CanonicalModelConfig[];
  readonly agent: {
    readonly maxRepairAttempts: number;
  };
}

const isCanonicalSettings = (
  value: unknown,
): value is CanonicalAgentSettings => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.formatVersion === 1 &&
    typeof v.activeModelConfigId === 'string' &&
    Array.isArray(v.modelConfigs) &&
    v.modelConfigs.length > 0 &&
    typeof v.agent === 'object' &&
    v.agent !== null
  );
};

export const readAgentSettings = async (): Promise<AgentSettings | null> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isCanonicalSettings(parsed)) {
      const active =
        parsed.modelConfigs.find((c) => c.id === parsed.activeModelConfigId) ??
        parsed.modelConfigs[0];
      if (!active) return null;
      return {
        provider: active.endpoint.includes('api.openai.com')
          ? 'openai'
          : 'custom',
        baseUrl: active.endpoint,
        apiKey: active.apiKey,
        model: active.model,
      };
    }
    if (isAgentSettings(parsed)) return parsed;
    return null;
  } catch (error: unknown) {
    if (error !== null && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'ENOENT') return null;
    }
    // Failed to parse or read other than ENOENT
    return null;
  }
};

export const writeAgentSettings = async (
  settings: unknown,
): Promise<CommandResult> => {
  if (!isAgentSettings(settings)) {
    return {
      ok: false,
      code: 'INVALID_SETTINGS',
      userMessage: 'The provided settings are invalid.',
    };
  }

  const canonical: CanonicalAgentSettings = {
    formatVersion: 1,
    activeModelConfigId: 'default',
    modelConfigs: [
      {
        id: 'default',
        endpoint: settings.baseUrl.trim(),
        apiKey: settings.apiKey,
        model: settings.model.trim(),
      },
    ],
    agent: {
      maxRepairAttempts: 2,
    },
  };

  const settingsPath = getSettingsPath();
  const dirPath = join(homedir(), '.agent-music');

  try {
    await fs.mkdir(dirPath, { recursive: true });
    // Atomic write by writing to a .tmp file then renaming
    const tempPath = `${settingsPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(canonical, null, 2), 'utf8');
    await fs.rename(tempPath, settingsPath);

    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'SETTINGS_WRITE_FAILED',
      userMessage: `Failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
