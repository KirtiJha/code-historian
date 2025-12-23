/**
 * Settings Panel Component
 * Configuration UI for the extension - Enhanced version
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { SettingsData } from '../types';
import { Button, Input, Select } from './components';
import { vscode } from './vscode-api';

interface SettingsPanelProps {
  settings: SettingsData;
  onUpdate: (updates: Partial<SettingsData>) => void;
}

// Connection test result type
type ConnectionTestResult = 'idle' | 'testing' | 'success' | 'error';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onUpdate }) => {
  const [localSettings, setLocalSettings] = useState(settings);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<ConnectionTestResult>('idle');
  const [llmTestResult, setLlmTestResult] = useState<ConnectionTestResult>('idle');
  const [testMessage, setTestMessage] = useState<string>('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    capture: true,
    embedding: true,
    llm: false,
    storage: false,
    ui: false,
  });

  // Sync localSettings when settings prop changes (e.g., after loading from extension)
  // Only sync if we're not in the middle of saving and don't have unsaved changes
  useEffect(() => {
    if (isSaving) {
      // We just saved - the settings prop now contains confirmed values
      console.log('SettingsPanel: Received confirmed settings after save', settings);
      setLocalSettings(settings);
      setHasChanges(false);
      setIsSaving(false);
    } else if (!hasChanges) {
      // Not saving and no unsaved changes - sync from props
      const settingsChanged = JSON.stringify(settings) !== JSON.stringify(localSettings);
      if (settingsChanged) {
        console.log('SettingsPanel: Syncing from props (no unsaved changes)', settings);
        setLocalSettings(settings);
      }
    }
  }, [settings]); // Only depend on settings - we check the flags inside

  const updateLocal = useCallback(
    <K extends keyof SettingsData>(category: K, updates: Partial<SettingsData[K]>) => {
      console.log('SettingsPanel: updateLocal called', category, updates);
      setLocalSettings(prev => ({
        ...prev,
        [category]: { ...prev[category], ...updates },
      }));
      setHasChanges(true);
      console.log('SettingsPanel: hasChanges set to true');
    },
    []
  );

  const handleSave = useCallback(() => {
    console.log('SettingsPanel: Saving settings', JSON.stringify(localSettings, null, 2));
    setIsSaving(true); // Mark that we're saving - don't reset hasChanges until confirmed
    onUpdate(localSettings);
  }, [localSettings, onUpdate]);

  const handleReset = useCallback(() => {
    setLocalSettings(settings);
    setHasChanges(false);
  }, [settings]);

  // Listen for test connection results from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'testConnectionResult') {
        const { provider, success, message: resultMessage } = message.data;
        if (provider === 'embedding') {
          setEmbeddingTestResult(success ? 'success' : 'error');
          setTestMessage(
            resultMessage || (success ? 'Connection successful!' : 'Connection failed')
          );
        } else if (provider === 'llm') {
          setLlmTestResult(success ? 'success' : 'error');
          setTestMessage(
            resultMessage || (success ? 'Connection successful!' : 'Connection failed')
          );
        }
        // Reset after 5 seconds
        setTimeout(() => {
          setEmbeddingTestResult('idle');
          setLlmTestResult('idle');
          setTestMessage('');
        }, 5000);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleTestConnection = useCallback(
    (provider: 'embedding' | 'llm') => {
      if (provider === 'embedding') {
        setEmbeddingTestResult('testing');
      } else {
        setLlmTestResult('testing');
      }
      setTestMessage('');

      // Send test request to extension with current settings
      vscode.postMessage({
        type: 'testConnection',
        data: {
          provider,
          config: provider === 'embedding' ? localSettings.embedding : localSettings.llm,
        },
      });
    },
    [localSettings]
  );

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="settings-panel">
      {/* Floating save bar when there are changes */}
      {hasChanges && (
        <div className="settings-save-bar">
          <span className="settings-save-text">
            <i className="codicon codicon-warning" />
            You have unsaved changes
          </span>
          <div className="settings-save-actions">
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Discard
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave}>
              <i className="codicon codicon-save" />
              Save Changes
            </Button>
          </div>
        </div>
      )}

      <div className="settings-content">
        {/* Capture Settings */}
        <section className="settings-section">
          <button className="settings-section-header" onClick={() => toggleSection('capture')}>
            <div className="settings-section-icon settings-section-icon--capture">
              <i className="codicon codicon-record" />
            </div>
            <div className="settings-section-title">
              <h3>Capture Settings</h3>
              <p>Configure how code changes are tracked</p>
            </div>
            <i
              className={`codicon codicon-chevron-${expandedSections.capture ? 'up' : 'down'} settings-section-chevron`}
            />
          </button>

          {expandedSections.capture && (
            <div className="settings-section-content">
              <div className="settings-row">
                <div className="settings-toggle-group">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={localSettings.capture.enabled}
                      onChange={e => updateLocal('capture', { enabled: e.target.checked })}
                    />
                    <span className="settings-toggle-slider"></span>
                    <span className="settings-toggle-label">Enable automatic capture</span>
                  </label>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={localSettings.capture.autoCapture}
                      onChange={e => updateLocal('capture', { autoCapture: e.target.checked })}
                    />
                    <span className="settings-toggle-slider"></span>
                    <span className="settings-toggle-label">Capture on file save</span>
                  </label>
                </div>
              </div>

              <div className="settings-grid">
                <div className="settings-field">
                  <label className="settings-label">Debounce (ms)</label>
                  <Input
                    type="number"
                    value={localSettings.capture.debounceMs}
                    onChange={e =>
                      updateLocal('capture', { debounceMs: parseInt(e.target.value) || 1000 })
                    }
                    min={100}
                    max={10000}
                  />
                  <span className="settings-hint">Wait time before capturing</span>
                </div>

                <div className="settings-field">
                  <label className="settings-label">Max file size (KB)</label>
                  <Input
                    type="number"
                    value={localSettings.capture.maxFileSizeKb}
                    onChange={e =>
                      updateLocal('capture', { maxFileSizeKb: parseInt(e.target.value) || 500 })
                    }
                    min={10}
                    max={10000}
                  />
                  <span className="settings-hint">Skip files larger than this</span>
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Exclude patterns</label>
                <textarea
                  value={localSettings.capture.excludePatterns.join('\n')}
                  onChange={e =>
                    updateLocal('capture', {
                      excludePatterns: e.target.value.split('\n').filter(Boolean),
                    })
                  }
                  rows={4}
                  className="settings-textarea"
                  placeholder="**/node_modules/**&#10;**/.git/**&#10;**/dist/**"
                />
                <span className="settings-hint">One glob pattern per line</span>
              </div>
            </div>
          )}
        </section>

        {/* Embedding Settings */}
        <section className="settings-section">
          <button className="settings-section-header" onClick={() => toggleSection('embedding')}>
            <div className="settings-section-icon settings-section-icon--embedding">
              <i className="codicon codicon-symbol-namespace" />
            </div>
            <div className="settings-section-title">
              <h3>Embedding Settings</h3>
              <p>Configure vector embeddings for semantic search</p>
            </div>
            <i
              className={`codicon codicon-chevron-${expandedSections.embedding ? 'up' : 'down'} settings-section-chevron`}
            />
          </button>

          {expandedSections.embedding && (
            <div className="settings-section-content">
              <div className="settings-field">
                <label className="settings-label">Provider</label>
                <div className="settings-provider-cards">
                  {[
                    {
                      value: 'huggingface',
                      label: 'HuggingFace',
                      desc: 'Recommended',
                      icon: 'hubot',
                    },
                    { value: 'ollama', label: 'Ollama', desc: 'Local', icon: 'server' },
                    { value: 'openai', label: 'OpenAI', desc: 'Cloud', icon: 'cloud' },
                  ].map(provider => (
                    <button
                      key={provider.value}
                      className={`settings-provider-card ${localSettings.embedding.provider === provider.value ? 'settings-provider-card--active' : ''}`}
                      onClick={() =>
                        updateLocal('embedding', {
                          provider: provider.value as SettingsData['embedding']['provider'],
                          model: getDefaultModelForProvider(provider.value),
                        })
                      }
                    >
                      <i className={`codicon codicon-${provider.icon}`} />
                      <span className="provider-name">{provider.label}</span>
                      <span className="provider-desc">{provider.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Embedding Model</label>
                <Select
                  value={localSettings.embedding.model}
                  onChange={value => updateLocal('embedding', { model: value })}
                  options={getEmbeddingModelOptions(localSettings.embedding.provider)}
                />
                <span className="settings-hint">
                  {getEmbeddingModelDescription(
                    localSettings.embedding.provider,
                    localSettings.embedding.model
                  )}
                </span>
              </div>

              {localSettings.embedding.provider === 'ollama' && (
                <div className="settings-field">
                  <label className="settings-label">Ollama Endpoint</label>
                  <Input
                    value={localSettings.embedding.ollamaUrl || 'http://localhost:11434'}
                    onChange={e => updateLocal('embedding', { ollamaUrl: e.target.value })}
                    placeholder="http://localhost:11434"
                  />
                  <span className="settings-hint">URL of your local Ollama server</span>
                </div>
              )}

              {localSettings.embedding.provider === 'huggingface' && (
                <div className="settings-field">
                  <label className="settings-label">HuggingFace API Key</label>
                  <Input
                    type="password"
                    value={localSettings.embedding.huggingfaceApiKey || ''}
                    onChange={e => updateLocal('embedding', { huggingfaceApiKey: e.target.value })}
                    placeholder="hf_..."
                  />
                  <span className="settings-hint">
                    Get a free API key at{' '}
                    <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">
                      huggingface.co/settings/tokens
                    </a>
                  </span>
                </div>
              )}

              {localSettings.embedding.provider === 'openai' && (
                <div className="settings-field">
                  <label className="settings-label">OpenAI API Key</label>
                  <Input
                    type="password"
                    value={localSettings.embedding.openaiApiKey || ''}
                    onChange={e => updateLocal('embedding', { openaiApiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>
              )}

              <div className="settings-grid">
                <div className="settings-field">
                  <label className="settings-label">Batch Size</label>
                  <Input
                    type="number"
                    value={localSettings.embedding.batchSize}
                    onChange={e =>
                      updateLocal('embedding', { batchSize: parseInt(e.target.value) || 32 })
                    }
                    min={1}
                    max={100}
                  />
                  <span className="settings-hint">Number of changes to embed at once</span>
                </div>
              </div>

              <div className="settings-actions">
                <Button
                  variant={
                    embeddingTestResult === 'success'
                      ? 'primary'
                      : embeddingTestResult === 'error'
                        ? 'ghost'
                        : 'secondary'
                  }
                  size="sm"
                  onClick={() => handleTestConnection('embedding')}
                  disabled={embeddingTestResult === 'testing'}
                >
                  {embeddingTestResult === 'testing' ? (
                    <>
                      <i className="codicon codicon-loading codicon-modifier-spin" />
                      Testing...
                    </>
                  ) : embeddingTestResult === 'success' ? (
                    <>
                      <i className="codicon codicon-check" />
                      Connected!
                    </>
                  ) : embeddingTestResult === 'error' ? (
                    <>
                      <i className="codicon codicon-error" />
                      Failed
                    </>
                  ) : (
                    <>
                      <i className="codicon codicon-plug" />
                      Test Connection
                    </>
                  )}
                </Button>
                {embeddingTestResult !== 'idle' &&
                  embeddingTestResult !== 'testing' &&
                  testMessage && (
                    <span
                      className={`settings-test-message settings-test-message--${embeddingTestResult}`}
                    >
                      {testMessage}
                    </span>
                  )}
              </div>
            </div>
          )}
        </section>

        {/* LLM Settings */}
        <section className="settings-section">
          <button className="settings-section-header" onClick={() => toggleSection('llm')}>
            <div className="settings-section-icon settings-section-icon--llm">
              <i className="codicon codicon-hubot" />
            </div>
            <div className="settings-section-title">
              <h3>LLM Settings</h3>
              <p>Configure AI model for code analysis</p>
            </div>
            <i
              className={`codicon codicon-chevron-${expandedSections.llm ? 'up' : 'down'} settings-section-chevron`}
            />
          </button>

          {expandedSections.llm && (
            <div className="settings-section-content">
              <div className="settings-field">
                <label className="settings-label">Provider</label>
                <div className="settings-provider-cards">
                  {[
                    { value: 'ollama', label: 'Ollama', desc: 'Local', icon: 'server' },
                    { value: 'openai', label: 'OpenAI', desc: 'GPT-4', icon: 'cloud' },
                    { value: 'anthropic', label: 'Anthropic', desc: 'Claude', icon: 'sparkle' },
                    { value: 'google', label: 'Google', desc: 'Gemini', icon: 'globe' },
                  ].map(provider => (
                    <button
                      key={provider.value}
                      className={`settings-provider-card ${localSettings.llm.provider === provider.value ? 'settings-provider-card--active' : ''}`}
                      onClick={() =>
                        updateLocal('llm', {
                          provider: provider.value as SettingsData['llm']['provider'],
                          model: getDefaultLLMModelForProvider(provider.value),
                        })
                      }
                    >
                      <i className={`codicon codicon-${provider.icon}`} />
                      <span className="provider-name">{provider.label}</span>
                      <span className="provider-desc">{provider.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Model</label>
                <Select
                  value={localSettings.llm.model}
                  onChange={value => updateLocal('llm', { model: value })}
                  options={getLLMModelOptions(localSettings.llm.provider)}
                />
                <span className="settings-hint">
                  {getLLMModelDescription(localSettings.llm.provider, localSettings.llm.model)}
                </span>
              </div>

              {localSettings.llm.provider === 'ollama' && (
                <div className="settings-field">
                  <label className="settings-label">Ollama Endpoint</label>
                  <Input
                    value={localSettings.llm.ollamaUrl || 'http://localhost:11434'}
                    onChange={e => updateLocal('llm', { ollamaUrl: e.target.value })}
                    placeholder="http://localhost:11434"
                  />
                  <span className="settings-hint">URL of your local Ollama server</span>
                </div>
              )}

              {['openai', 'anthropic', 'google'].includes(localSettings.llm.provider) && (
                <div className="settings-field">
                  <label className="settings-label">API Key</label>
                  <Input
                    type="password"
                    value={
                      localSettings.llm.provider === 'openai'
                        ? localSettings.llm.openaiApiKey || ''
                        : localSettings.llm.provider === 'anthropic'
                          ? localSettings.llm.anthropicApiKey || ''
                          : localSettings.llm.googleApiKey || ''
                    }
                    onChange={e => {
                      if (localSettings.llm.provider === 'openai') {
                        updateLocal('llm', { openaiApiKey: e.target.value });
                      } else if (localSettings.llm.provider === 'anthropic') {
                        updateLocal('llm', { anthropicApiKey: e.target.value });
                      } else {
                        updateLocal('llm', { googleApiKey: e.target.value });
                      }
                    }}
                    placeholder={`Enter your ${localSettings.llm.provider} API key`}
                  />
                  <span className="settings-hint">
                    {localSettings.llm.provider === 'openai' &&
                      'Get API key at platform.openai.com'}
                    {localSettings.llm.provider === 'anthropic' &&
                      'Get API key at console.anthropic.com'}
                    {localSettings.llm.provider === 'google' && 'Get API key at ai.google.dev'}
                  </span>
                </div>
              )}

              <div className="settings-grid">
                <div className="settings-field">
                  <label className="settings-label">Temperature</label>
                  <div className="settings-range-container">
                    <input
                      type="range"
                      className="settings-range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={localSettings.llm.temperature}
                      onChange={e =>
                        updateLocal('llm', { temperature: parseFloat(e.target.value) })
                      }
                      aria-label="Temperature"
                    />
                    <span className="settings-range-value">{localSettings.llm.temperature}</span>
                  </div>
                  <span className="settings-hint">Higher = more creative</span>
                </div>

                <div className="settings-field">
                  <label className="settings-label">Max Tokens</label>
                  <Input
                    type="number"
                    value={localSettings.llm.maxTokens}
                    onChange={e =>
                      updateLocal('llm', { maxTokens: parseInt(e.target.value) || 4096 })
                    }
                    min={100}
                    max={128000}
                    step={100}
                  />
                </div>
              </div>

              <div className="settings-actions">
                <Button
                  variant={
                    llmTestResult === 'success'
                      ? 'primary'
                      : llmTestResult === 'error'
                        ? 'ghost'
                        : 'secondary'
                  }
                  size="sm"
                  onClick={() => handleTestConnection('llm')}
                  disabled={llmTestResult === 'testing'}
                >
                  {llmTestResult === 'testing' ? (
                    <>
                      <i className="codicon codicon-loading codicon-modifier-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <i className="codicon codicon-plug" />
                      Test Connection
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Storage Settings */}
        <section className="settings-section">
          <button className="settings-section-header" onClick={() => toggleSection('storage')}>
            <div className="settings-section-icon settings-section-icon--storage">
              <i className="codicon codicon-database" />
            </div>
            <div className="settings-section-title">
              <h3>Storage Settings</h3>
              <p>Manage history and data retention</p>
            </div>
            <i
              className={`codicon codicon-chevron-${expandedSections.storage ? 'up' : 'down'} settings-section-chevron`}
            />
          </button>

          {expandedSections.storage && (
            <div className="settings-section-content">
              <div className="settings-grid">
                <div className="settings-field">
                  <label className="settings-label">Max changes to store</label>
                  <Input
                    type="number"
                    value={localSettings.storage.maxChanges}
                    onChange={e =>
                      updateLocal('storage', { maxChanges: parseInt(e.target.value) || 10000 })
                    }
                    min={100}
                    max={100000}
                  />
                </div>

                <div className="settings-field">
                  <label className="settings-label">Retention days</label>
                  <Input
                    type="number"
                    value={localSettings.storage.retentionDays}
                    onChange={e =>
                      updateLocal('storage', { retentionDays: parseInt(e.target.value) || 30 })
                    }
                    min={1}
                    max={365}
                  />
                  <span className="settings-hint">Auto-cleanup older changes</span>
                </div>
              </div>

              <div className="settings-row">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.storage.compressionEnabled}
                    onChange={e => updateLocal('storage', { compressionEnabled: e.target.checked })}
                  />
                  <span className="settings-toggle-slider"></span>
                  <span className="settings-toggle-label">Enable content compression</span>
                </label>
              </div>

              <div className="settings-actions settings-actions--spread">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    vscode.postMessage({ type: 'exportHistory', data: { format: 'json' } })
                  }
                >
                  <i className="codicon codicon-export" />
                  Export History
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    if (
                      confirm('Are you sure you want to clear all history? This cannot be undone.')
                    ) {
                      vscode.postMessage({ type: 'clearHistory' });
                    }
                  }}
                >
                  <i className="codicon codicon-trash" />
                  Clear History
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* UI Settings */}
        <section className="settings-section">
          <button className="settings-section-header" onClick={() => toggleSection('ui')}>
            <div className="settings-section-icon settings-section-icon--ui">
              <i className="codicon codicon-paintcan" />
            </div>
            <div className="settings-section-title">
              <h3>UI Settings</h3>
              <p>Customize the interface appearance</p>
            </div>
            <i
              className={`codicon codicon-chevron-${expandedSections.ui ? 'up' : 'down'} settings-section-chevron`}
            />
          </button>

          {expandedSections.ui && (
            <div className="settings-section-content">
              <div className="settings-grid">
                <div className="settings-field">
                  <label className="settings-label">Theme</label>
                  <Select
                    value={localSettings.ui.theme}
                    onChange={value =>
                      updateLocal('ui', { theme: value as SettingsData['ui']['theme'] })
                    }
                    options={[
                      { value: 'auto', label: 'Auto (follow VS Code)' },
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                </div>

                <div className="settings-field">
                  <label className="settings-label">Items per page</label>
                  <Select
                    value={String(localSettings.ui.defaultPageSize)}
                    onChange={value => updateLocal('ui', { defaultPageSize: parseInt(value) })}
                    options={[
                      { value: '25', label: '25 items' },
                      { value: '50', label: '50 items' },
                      { value: '100', label: '100 items' },
                    ]}
                  />
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-label">Default timeline grouping</label>
                <div className="settings-radio-group">
                  {[
                    { value: 'date', label: 'By Date', icon: 'calendar' },
                    { value: 'file', label: 'By File', icon: 'file' },
                    { value: 'session', label: 'By Session', icon: 'folder' },
                  ].map(option => (
                    <label key={option.value} className="settings-radio">
                      <input
                        type="radio"
                        name="timelineGroupBy"
                        value={option.value}
                        checked={(localSettings.ui.timelineGroupBy ?? 'date') === option.value}
                        onChange={e =>
                          updateLocal('ui', {
                            timelineGroupBy: e.target
                              .value as SettingsData['ui']['timelineGroupBy'],
                          })
                        }
                      />
                      <span className="settings-radio-box">
                        <i className={`codicon codicon-${option.icon}`} />
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.ui.showPreviewOnHover ?? true}
                    onChange={e => updateLocal('ui', { showPreviewOnHover: e.target.checked })}
                  />
                  <span className="settings-toggle-slider"></span>
                  <span className="settings-toggle-label">Show diff preview on hover</span>
                </label>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

// Embedding model configurations
const EMBEDDING_MODEL_OPTIONS = {
  huggingface: [
    {
      value: 'BAAI/bge-large-en-v1.5',
      label: 'BGE Large (recommended)',
      description: 'Best quality, 1024 dimensions',
    },
    {
      value: 'BAAI/bge-base-en-v1.5',
      label: 'BGE Base',
      description: 'Good balance, 768 dimensions',
    },
    { value: 'BAAI/bge-small-en-v1.5', label: 'BGE Small', description: 'Fast, 384 dimensions' },
    {
      value: 'sentence-transformers/all-mpnet-base-v2',
      label: 'MPNet Base',
      description: 'High quality sentence embeddings',
    },
    {
      value: 'sentence-transformers/all-MiniLM-L6-v2',
      label: 'MiniLM',
      description: 'Very fast, lightweight',
    },
    {
      value: 'nomic-ai/nomic-embed-text-v1.5',
      label: 'Nomic Embed',
      description: 'Long context support (8K)',
    },
    {
      value: 'jinaai/jina-embeddings-v2-base-en',
      label: 'Jina Embeddings',
      description: 'Long context, high quality',
    },
  ],
  ollama: [
    {
      value: 'nomic-embed-text',
      label: 'Nomic Embed Text',
      description: 'Fast, good quality, 768 dim',
    },
    { value: 'mxbai-embed-large', label: 'MxBai Large', description: 'High quality, 1024 dim' },
    { value: 'bge-large', label: 'BGE Large', description: 'BGE via Ollama, 1024 dim' },
    {
      value: 'snowflake-arctic-embed',
      label: 'Snowflake Arctic',
      description: 'State-of-the-art retrieval',
    },
    { value: 'all-minilm', label: 'All MiniLM', description: 'Lightweight, 384 dim' },
  ],
  openai: [
    {
      value: 'text-embedding-3-large',
      label: 'Embedding 3 Large',
      description: 'Highest quality, 3072 dim',
    },
    {
      value: 'text-embedding-3-small',
      label: 'Embedding 3 Small',
      description: 'Fast, cost-effective, 1536 dim',
    },
    { value: 'text-embedding-ada-002', label: 'Ada 002', description: 'Legacy model, 1536 dim' },
  ],
};

function getDefaultModelForProvider(provider: string): string {
  switch (provider) {
    case 'huggingface':
      return 'BAAI/bge-large-en-v1.5';
    case 'ollama':
      return 'nomic-embed-text';
    case 'openai':
      return 'text-embedding-3-small';
    default:
      return '';
  }
}

function getEmbeddingModelOptions(provider: string): Array<{ value: string; label: string }> {
  const options = EMBEDDING_MODEL_OPTIONS[provider as keyof typeof EMBEDDING_MODEL_OPTIONS] || [];
  return options.map(opt => ({ value: opt.value, label: opt.label }));
}

function getEmbeddingModelDescription(provider: string, model: string): string {
  const options = EMBEDDING_MODEL_OPTIONS[provider as keyof typeof EMBEDDING_MODEL_OPTIONS] || [];
  const found = options.find(opt => opt.value === model);
  return found?.description || 'Select a model for semantic search embeddings';
}

function getEmbeddingModelPlaceholder(provider: string): string {
  return getDefaultModelForProvider(provider);
}

function getLLMModelPlaceholder(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'ollama':
      return 'llama3.2';
    case 'google':
      return 'gemini-1.5-pro';
    default:
      return '';
  }
}

// LLM model configurations
const LLM_MODEL_OPTIONS = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o', description: 'Most capable, multimodal' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Fast and affordable' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', description: 'High capability with vision' },
    { value: 'gpt-4', label: 'GPT-4', description: 'Original GPT-4' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', description: 'Fast, cost-effective' },
  ],
  anthropic: [
    {
      value: 'claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4',
      description: 'Balanced performance (recommended)',
    },
    {
      value: 'claude-opus-4-20250514',
      label: 'Claude Opus 4',
      description: 'Most capable Claude model',
    },
    {
      value: 'claude-3-5-sonnet-20241022',
      label: 'Claude 3.5 Sonnet',
      description: 'Previous generation Sonnet',
    },
    {
      value: 'claude-3-haiku-20240307',
      label: 'Claude 3 Haiku',
      description: 'Fast and affordable',
    },
  ],
  ollama: [
    { value: 'llama3.2', label: 'Llama 3.2', description: 'Latest Llama, efficient' },
    { value: 'llama3.1', label: 'Llama 3.1', description: 'High quality open model' },
    { value: 'codellama', label: 'Code Llama', description: 'Optimized for code' },
    { value: 'mistral', label: 'Mistral', description: 'Fast and capable' },
    { value: 'mixtral', label: 'Mixtral', description: 'MoE architecture' },
    { value: 'deepseek-coder', label: 'DeepSeek Coder', description: 'Code-focused model' },
    { value: 'qwen2.5-coder', label: 'Qwen 2.5 Coder', description: 'Strong coding model' },
  ],
  google: [
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Most capable, long context' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Fast and efficient' },
    { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro', description: 'Balanced performance' },
  ],
};

function getDefaultLLMModelForProvider(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'ollama':
      return 'llama3.2';
    case 'google':
      return 'gemini-1.5-pro';
    default:
      return '';
  }
}

function getLLMModelOptions(provider: string): Array<{ value: string; label: string }> {
  const options = LLM_MODEL_OPTIONS[provider as keyof typeof LLM_MODEL_OPTIONS] || [];
  return options.map(opt => ({ value: opt.value, label: opt.label }));
}

function getLLMModelDescription(provider: string, model: string): string {
  const options = LLM_MODEL_OPTIONS[provider as keyof typeof LLM_MODEL_OPTIONS] || [];
  const found = options.find(opt => opt.value === model);
  return found?.description || 'Select a model for LLM analysis';
}
