import { useState } from 'react';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { EyeClosedIcon } from '@phosphor-icons/react/dist/csr/EyeClosed';

export interface AgentSettings {
  readonly provider: 'openai' | 'custom';
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

interface SettingsModalProps {
  readonly initialSettings?: AgentSettings | undefined;
  readonly onSave: (settings: AgentSettings) => void;
  readonly onClose: () => void;
}

const DEFAULT_SETTINGS: AgentSettings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
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

  const isConfigured = settings.apiKey.trim().length > 0;

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
              value={settings.provider}
              onChange={(e) => {
                const provider = e.target.value as 'openai' | 'custom';
                setSettings({
                  ...settings,
                  provider,
                  baseUrl:
                    provider === 'openai'
                      ? 'https://api.openai.com/v1'
                      : settings.baseUrl,
                });
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
              value={settings.baseUrl}
              onChange={(e) => {
                setSettings({ ...settings, baseUrl: e.target.value });
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
                value={settings.apiKey}
                onChange={(e) => {
                  setSettings({ ...settings, apiKey: e.target.value });
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
              value={settings.model}
              onChange={(e) => {
                setSettings({ ...settings, model: e.target.value });
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
              onSave(settings);
            }}
          >
            Save Changes
          </button>
        </footer>
      </section>
    </div>
  );
};
