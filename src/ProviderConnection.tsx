import { useState, useEffect, useRef } from 'react';
import { api } from './api';
import { t } from './i18n';
import { providers } from './providers';
import type { Snapshot, Settings } from './types';
import ProviderHelp from './ProviderHelp';
export default function ProviderConnection({
  snapshot,
  onUpdate,
  onError,
  onModels,
  onNotice,
  guided = false,
}: {
  snapshot: Snapshot;
  onUpdate: (v: Partial<Settings>) => Promise<any>;
  onError: (e: any) => void;
  onModels: (v: string[]) => void;
  onNotice: (v: string) => void;
  guided?: boolean;
}) {
  const settings = snapshot.settings,
    info = providers.find((p) => p.id === settings.provider)!;
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [authOpen, setAuthOpen] = useState(false);
  const fingerprint = settings.provider + '|' + settings.endpoint;
  const latest = useRef(fingerprint),
    mounted = useRef(true);
  latest.current = fingerprint;
  useEffect(() => {
    setKey('');
    setAuthOpen(false);
    onModels([]);
    onNotice('');
  }, [fingerprint]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const setModels = (v: string[]) => {
    if (mounted.current && latest.current === fingerprint) onModels(v);
  };
  const setNotice = (v: string) => {
    if (mounted.current && latest.current === fingerprint) onNotice(v);
  };
  const act = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      if (mounted.current && latest.current === fingerprint) onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-card">
      <h3>{t('Connection')}</h3>
      {guided && <ProviderHelp provider={settings.provider} />}
      <label>
        {t('Inference provider')}
        <select
          aria-label={t('Inference provider')}
          value={settings.provider}
          disabled={busy}
          onChange={(e) => {
            setKey('');
            setModels([]);
            setNotice('');
            void onUpdate({ provider: e.target.value as Settings['provider'] });
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {!settings.connectedProviders?.includes(settings.provider) && (
        <button onClick={() => void onUpdate({ provider: settings.provider })}>
          {t('Connect provider')}
        </button>
      )}
      <p>
        {info.cloud
          ? t(
              'The selected API provider receives your conversation, shared context and attached images.',
            )
          : t('Connect to the model server running on your computer or network.')}
      </p>
      <label>
        {t('Server address')}
        <input
          key={settings.provider + settings.endpoint}
          aria-label={t('Server address')}
          defaultValue={settings.endpoint}
          onBlur={(e) => {
            if (e.target.value !== settings.endpoint)
              void onUpdate({ endpoint: e.target.value, model: '' });
          }}
        />
      </label>
      {settings.provider === 'qwen' ? (
        <small>
          {t(
            'Use the Model Studio endpoint for the region and workspace where your API key was created.',
          )}
        </small>
      ) : null}
      {!info.cloud && (
        <button aria-expanded={authOpen} onClick={() => setAuthOpen(!authOpen)}>
          {t('Server authentication (optional)')}
        </button>
      )}
      {info.cloud || authOpen ? (
        <>
          <label>
            {t(info.cloud ? 'API key' : 'Server token (optional)')}
            <input
              aria-label={t(info.cloud ? 'Inference API key' : 'Server authentication token')}
              type="password"
              autoComplete="off"
              value={key}
              placeholder={snapshot.inference?.key.configured ? t('Key saved') : t('Enter API key')}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <div className="heading-actions">
            <button
              disabled={busy || !key.trim()}
              onClick={() =>
                void act(async () => {
                  await api.inferenceKey({
                    action: 'save',
                    key,
                    provider: settings.provider,
                    endpoint: settings.endpoint,
                  });
                  setKey('');
                  setNotice(t('API key saved.'));
                })
              }
            >
              {t('Save API key')}
            </button>
            <button
              disabled={busy || !snapshot.inference?.key.configured}
              onClick={() =>
                void act(async () => {
                  await api.inferenceKey({
                    action: 'remove',
                    provider: settings.provider,
                    endpoint: settings.endpoint,
                  });
                  setNotice(t('API key removed.'));
                })
              }
            >
              {t('Remove API key')}
            </button>
          </div>
          <small>
            {t('Save the key before leaving this page. Unsaved keys are not retained.')}
          </small>
          <small>
            {snapshot.inference?.key.persistentAvailable
              ? t('Encrypted with your operating system keyring.')
              : t(
                  'The key is kept for this session because secure keyring storage is unavailable.',
                )}{' '}
            {t('Keys are bound to the selected provider and address.')}
          </small>
        </>
      ) : null}
      <button
        disabled={busy}
        onClick={() =>
          void act(async () => {
            if (!settings.connectedProviders?.includes(settings.provider))
              await onUpdate({ provider: settings.provider });
            const found = await api.models(undefined, true);
            setModels(found);
            setNotice(
              t(
                found.length
                  ? 'Server reached · Models found. Choose a model below.'
                  : 'Server reached, but no models were listed. Download or load a model, or enter its ID.',
              ),
            );
          })
        }
      >
        {busy ? t('Connecting…') : t('Test connection & find models')} ↗
      </button>
    </section>
  );
}
