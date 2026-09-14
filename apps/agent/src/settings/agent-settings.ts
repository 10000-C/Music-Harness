export interface AgentModelConfig {
  readonly id: string;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface AgentSettings {
  readonly formatVersion: 1;
  readonly activeModelConfigId: string;
  readonly modelConfigs: readonly AgentModelConfig[];
  readonly agent: {
    readonly maxRepairAttempts: number;
  };
}

export type AgentSettingsErrorCode =
  'SETTINGS_NOT_FOUND' | 'SETTINGS_INVALID' | 'SETTINGS_IO_FAILED';

export class AgentSettingsError extends Error {
  public constructor(
    public readonly code: AgentSettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentSettingsError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isHttpEndpoint = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const isModelConfig = (value: unknown): value is AgentModelConfig =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isHttpEndpoint(value.endpoint) &&
  isNonEmptyString(value.apiKey) &&
  isNonEmptyString(value.model) &&
  (value.parameters === undefined || isRecord(value.parameters));

export const parseAgentSettings = (value: unknown): AgentSettings => {
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    !isNonEmptyString(value.activeModelConfigId) ||
    !Array.isArray(value.modelConfigs) ||
    value.modelConfigs.length === 0 ||
    !value.modelConfigs.every(isModelConfig) ||
    !isRecord(value.agent) ||
    typeof value.agent.maxRepairAttempts !== 'number' ||
    !Number.isInteger(value.agent.maxRepairAttempts) ||
    value.agent.maxRepairAttempts < 0
  ) {
    throw new AgentSettingsError(
      'SETTINGS_INVALID',
      'Agent settings are invalid',
    );
  }

  const ids = value.modelConfigs.map((config) => config.id);
  if (new Set(ids).size !== ids.length) {
    throw new AgentSettingsError(
      'SETTINGS_INVALID',
      'Agent settings contain duplicate model configuration IDs',
    );
  }

  if (
    !value.modelConfigs.some(
      (config) => config.id === value.activeModelConfigId,
    )
  ) {
    throw new AgentSettingsError(
      'SETTINGS_INVALID',
      'Active model configuration does not exist',
    );
  }

  return {
    formatVersion: 1,
    activeModelConfigId: value.activeModelConfigId,
    modelConfigs: value.modelConfigs,
    agent: {
      maxRepairAttempts: value.agent.maxRepairAttempts,
    },
  };
};
