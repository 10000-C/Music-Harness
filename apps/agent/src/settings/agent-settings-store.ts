import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  AgentSettingsError,
  parseAgentSettings,
  type AgentModelConfig,
  type AgentSettings,
} from './agent-settings.js';

export { AgentSettingsError } from './agent-settings.js';
export type { AgentModelConfig, AgentSettings } from './agent-settings.js';

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

export class AgentSettingsStore {
  public constructor(private readonly settingsPath: string) {}

  public async read(): Promise<AgentSettings> {
    let raw: string;
    try {
      raw = await readFile(this.settingsPath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new AgentSettingsError(
          'SETTINGS_NOT_FOUND',
          'Agent settings have not been configured',
        );
      }
      throw new AgentSettingsError(
        'SETTINGS_IO_FAILED',
        'Unable to read Agent settings',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new AgentSettingsError(
        'SETTINGS_INVALID',
        'Agent settings are invalid JSON',
      );
    }

    return parseAgentSettings(parsed);
  }

  public async write(settings: AgentSettings): Promise<void> {
    const validated = parseAgentSettings(settings);
    const directory = dirname(this.settingsPath);
    const temporaryPath = join(
      directory,
      `.${basename(this.settingsPath)}.${String(process.pid)}.${randomUUID()}.tmp`,
    );

    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        temporaryPath,
        `${JSON.stringify(validated, null, 2)}\n`,
        {
          encoding: 'utf8',
          mode: 0o600,
        },
      );
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.settingsPath);
      await chmod(this.settingsPath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof AgentSettingsError) {
        throw error;
      }
      throw new AgentSettingsError(
        'SETTINGS_IO_FAILED',
        'Unable to write Agent settings',
      );
    }
  }

  public async getActiveModelConfig(): Promise<AgentModelConfig> {
    const settings = await this.read();
    const active = settings.modelConfigs.find(
      (config) => config.id === settings.activeModelConfigId,
    );
    if (active === undefined) {
      throw new AgentSettingsError(
        'SETTINGS_INVALID',
        'Active model configuration does not exist',
      );
    }
    return active;
  }

  public async getMaxRepairAttempts(): Promise<number> {
    return (await this.read()).agent.maxRepairAttempts;
  }
}
