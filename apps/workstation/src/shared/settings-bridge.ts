export interface AgentSettings {
  readonly provider: 'openai' | 'custom';
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export const isAgentSettings = (value: unknown): value is AgentSettings => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (v.provider !== 'openai' && v.provider !== 'custom') return false;
  if (typeof v.baseUrl !== 'string' || v.baseUrl.trim() === '') return false;
  if (typeof v.apiKey !== 'string') return false;
  if (typeof v.model !== 'string' || v.model.trim() === '') return false;
  return true;
};
