import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAgentSettings, type AgentSettings } from '../shared/settings-bridge.js';
import type { CommandResult } from '../shared/shell-contracts.js';

const getSettingsPath = (): string =>
  join(homedir(), '.agent-music', 'settings.json');

export const readAgentSettings = async (): Promise<AgentSettings | null> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
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

  const settingsPath = getSettingsPath();
  const dirPath = join(homedir(), '.agent-music');

  try {
    await fs.mkdir(dirPath, { recursive: true });
    // Atomic write by writing to a .tmp file then renaming
    const tempPath = `${settingsPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf8');
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
