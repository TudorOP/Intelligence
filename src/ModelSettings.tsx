import Switch from './Switch';
import ProviderConnection from './ProviderConnection';
import { t } from './i18n';
import { useState } from 'react';
import { api } from './api';
import type { Snapshot, Settings } from './types';
import ModelPicker from './ModelPicker';
import { providers } from './providers';
export default function ModelSettings({
  snapshot,
  onUpdate,
  onError,
  onAgent,
  guided = false,
}: {
  snapshot: Snapshot;
  onUpdate: (v: Partial<Settings>) => Promise<any>;
  onError: (e: any) => void;
  onAgent?: () => void;
  guided?: boolean;
}) {
  const settings = snapshot.settings,
    info = providers.find((p) => p.id === settings.provider)!;
  const [models, setModels] = useState<string[]>([]),
    [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const act = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section models-settings">
      {!guided && (
        <>
          <span className="eyebrow">{t('MODEL & PROVIDERS')}</span>
          <h2>{t('Choose your connection.')}</h2>
        </>
      )}
      {!guided && (
        <details className="settings-card connected-providers">
          <summary>
            {t('Connected providers')} ·{' '}
            {(settings.connectedProviders ?? [settings.provider]).length}
          </summary>
          <p>
            {t(
              'Keep local and API providers connected together. Choose a provider and model for each chat or agent; switching never happens automatically.',
            )}
          </p>
          {(settings.connectedProviders ?? [settings.provider]).map((id) => (
            <div className="provider-connection-row" key={id}>
              <span>
                <strong>{providers.find((p) => p.id === id)?.name}</strong>
                <small>
                  {id === settings.provider
                    ? settings.endpoint
                    : settings.providerProfiles?.[id]?.endpoint}
                </small>
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  setKey('');
                  setModels([]);
                  void onUpdate({ provider: id });
                }}
              >
                {t('Use / configure')}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api.inferenceKey({ action: 'disconnect', provider: id });
                    setKey('');
                    setModels([]);
                    setNotice(t('Provider disconnected. Its saved API keys were removed.'));
                  })
                }
              >
                {t('Disconnect')}
              </button>
            </div>
          ))}
          {!settings.connectedProviders?.length && (
            <small>{t('Choose a provider below to connect it.')}</small>
          )}
        </details>
      )}
      <div className="settings-grid">
        <ProviderConnection
          snapshot={snapshot}
          onUpdate={onUpdate}
          onError={onError}
          onModels={setModels}
          onNotice={setNotice}
          guided={guided}
        />
        <section className="settings-card">
          <h3>{t('Model & capabilities')}</h3>
          <label>{t('Model')}</label>
          <ModelPicker settings={settings} models={models} onUpdate={onUpdate} onError={onError} />
          <details open={!guided}>
            <summary>{t('Advanced model options')}</summary>
            <label className="setting-switch">
              <span>
                {t('Image input')}
                <small>{t('Choose a vision-capable model to understand attached images.')}</small>
              </span>
              <Switch
                aria-label={t('Image input')}
                checked={settings.visionEnabled !== false}
                onChange={(e) => void onUpdate({ visionEnabled: e.target.checked })}
              />
            </label>
            <label className="setting-switch">
              <span>
                {t('Agent tools')}
                <small>{t('Use a model with native function-calling support.')}</small>
              </span>
              <Switch
                aria-label={t('Agent tools')}
                checked={settings.tools}
                onChange={(e) => void onUpdate({ tools: e.target.checked })}
              />
            </label>
            {info.cloud ? (
              <label>
                {t('Maximum output tokens')}
                <input
                  type="number"
                  min={256}
                  max={65536}
                  defaultValue={settings.apiMaxTokens ?? 8192}
                  onBlur={(e) => void onUpdate({ apiMaxTokens: Number(e.target.value) })}
                />
              </label>
            ) : null}
            <label className="setting-switch">
              <span>{t('Repair tool-call formatting')}</span>
              <Switch
                checked={settings.toolRepair !== false}
                onChange={(e) => void onUpdate({ toolRepair: e.target.checked })}
              />
            </label>
            <label>
              {t('Tool-step limit per response')}
              <input
                aria-label={t('Tool-step limit per response')}
                type="number"
                min={1}
                max={256}
                key={settings.toolStepLimit}
                defaultValue={settings.toolStepLimit ?? 12}
                onBlur={(e) => {
                  if (Number(e.target.value) !== settings.toolStepLimit)
                    void onUpdate({ toolStepLimit: Number(e.target.value) });
                }}
              />
              <small>
                {t(
                  '1–256 model/tool rounds per response. Default: 12. Higher limits allow longer work and may increase API costs. Matrix and reports retain their own limits.',
                )}
              </small>
            </label>
            <label>
              {t('Tool correction attempts')}
              <input
                aria-label={t('Tool correction attempts')}
                type="number"
                min={0}
                max={4}
                value={settings.toolRepairAttempts ?? 2}
                onChange={(e) => void onUpdate({ toolRepairAttempts: Number(e.target.value) })}
              />
            </label>
          </details>
          {onAgent && (
            <div className="settings-related-action">
              <span>
                {t('Agent Profiles')}
                <small>{t('Individual models, personalities and tool scopes.')}</small>
              </span>
              <button onClick={onAgent}>{t('Open Agent screen')}</button>
            </div>
          )}
        </section>
      </div>
      {notice ? <p role="status">{t(notice)}</p> : null}
    </section>
  );
}
