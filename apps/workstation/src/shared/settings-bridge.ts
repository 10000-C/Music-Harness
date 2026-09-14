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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isHttpEndpoint = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;

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

export const isAgentSettings = (value: unknown): value is AgentSettings => {
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
    return false;
  }

  const ids = value.modelConfigs.map((config) => config.id);
  return (
    new Set(ids).size === ids.length &&
    value.modelConfigs.some((config) => config.id === value.activeModelConfigId)
  );
};
