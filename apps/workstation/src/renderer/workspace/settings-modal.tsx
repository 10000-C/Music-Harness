import { useState } from 'react';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { EyeClosedIcon } from '@phosphor-icons/react/dist/csr/EyeClosed';
import {
  isAgentSettings,
  type AgentModelConfig,
  type AgentSettings,
} from '../../shared/settings-bridge.js';

export type { AgentSettings } from '../../shared/settings-bridge.js';

interface SettingsModalProps {
  readonly initialSettings?: AgentSettings | undefined;
  readonly onSave: (settings: AgentSettings) => void;
  readonly onClose: () => void;
}

const DEFAULT_SETTINGS: AgentSettings = {
  formatVersion: 1,
  activeModelConfigId: 'primary',
  modelConfigs: [
    {
      id: 'primary',
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o',
    },
  ],
  agent: { maxRepairAttempts: 2 },
};

export const SettingsModal = ({
  initialSettings,
  onSave,
  onClose,
}: SettingsModalProps) => {
  const [settings, setSettings] = useState<AgentSettings>(
    initialSettings ?? DEFAULT_SETTINGS,
  );
  const [showKey, setShowKey] = useState(false);

  const activeConfig = settings.modelConfigs.find(
    (config) => config.id === settings.activeModelConfigId,
  );
  const [providerPreset, setProviderPreset] = useState<'openai' | 'custom'>(
    () =>
      activeConfig?.endpoint.startsWith('https://api.openai.com') === true
        ? 'openai'
        : 'custom',
  );
  const isConfigured = isAgentSettings(settings);
  const updateActiveConfig = (patch: Partial<AgentModelConfig>): void => {
    setSettings((current) => ({
      ...current,
      modelConfigs: current.modelConfigs.map((config) =>
        config.id === current.activeModelConfigId
          ? { ...config, ...patch }
          : config,
      ),
    }));
  };

  return (
    <div className="workstation-modal-overlay">
      <section
        className="settings-dialog"
        role="dialog"
        aria-labelledby="settings-dialog-title"
      >
        <header className="settings-dialog__header">
          <div>
            <span className="settings-dialog__eyebrow">Configuration</span>
            <h2 id="settings-dialog-title">AI Collaborator</h2>
          </div>
          {isConfigured ? (
            <span
              className="settings-dialog__status is-ready"
              title="API Key configured"
            >
              <div className="status-dot"></div>
              Ready
            </span>
          ) : (
            <span
              className="settings-dialog__status is-warning"
              title="API Key required"
            >
              <div className="status-dot"></div>
              Required
            </span>
          )}
        </header>
        <p className="settings-dialog__description">
          Configure your AI model and provider. Your API key is stored securely
          in <code>~/.agent-music/settings.json</code> and never saved in your
          project files or git.
        </p>

        <div className="settings-form">
          <div className="settings-form__field">
            <label htmlFor="setting-provider">Provider Preset</label>
            <select
              id="setting-provider"
              value={providerPreset}
              onChange={(e) => {
                const provider = e.target.value as 'openai' | 'custom';
                setProviderPreset(provider);
                if (provider === 'openai') {
                  updateActiveConfig({ endpoint: 'https://api.openai.com/v1' });
                }
              }}
            >
              <option value="openai">OpenAI (or Compatible)</option>
              <option value="custom">
                Custom Endpoint (e.g. DeepSeek, Ollama)
              </option>
            </select>
          </div>

          <div className="settings-form__field">
            <label htmlFor="setting-base-url">API Base URL</label>
            <input
              id="setting-base-url"
              type="text"
              value={activeConfig?.endpoint ?? ''}
              onChange={(e) => {
                setProviderPreset('custom');
                updateActiveConfig({ endpoint: e.target.value });
              }}
              placeholder="https://api.openai.com/v1"
            />
            <small>
              Must be compatible with the standard /v1/chat/completions endpoint
            </small>
          </div>

          <div className="settings-form__field">
            <label htmlFor="setting-api-key">API Key</label>
            <div className="settings-form__input-with-icon">
              <input
                id="setting-api-key"
                type={showKey ? 'text' : 'password'}
                value={activeConfig?.apiKey ?? ''}
                onChange={(e) => {
                  updateActiveConfig({ apiKey: e.target.value });
                }}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="button"
                className="icon-action"
                onClick={() => {
                  setShowKey(!showKey);
                }}
                aria-label={showKey ? 'Hide API Key' : 'Show API Key'}
                title={showKey ? 'Hide' : 'Show'}
              >
                {showKey ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
            {!isConfigured && (
              <small className="settings-form__error">
                API Key is required for the agent to work.
              </small>
            )}
          </div>

          <div className="settings-form__field">
            <label htmlFor="setting-model">Model Name</label>
            <input
              id="setting-model"
              type="text"
              value={activeConfig?.model ?? ''}
              onChange={(e) => {
                updateActiveConfig({ model: e.target.value });
              }}
              placeholder="gpt-4o"
            />
          </div>
        </div>

        <footer className="settings-dialog__actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            onClick={() => {
              if (isConfigured) onSave(settings);
            }}
            disabled={!isConfigured}
          >
            Save Changes
          </button>
        </footer>
      </section>
    </div>
  );
};
