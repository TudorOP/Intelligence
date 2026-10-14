import { useEffect, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Settings } from './types';
import { providerNames as names } from './providers';
export default function ChatModelMenu({
  settings,
  onSettings,
  onError,
  conversationId,
}: {
  settings: Settings;
  onSettings: () => void;
  onError: (text: string) => void;
  conversationId?: string;
}) {
  const [catalogs, setCatalogs] = useState<
    { provider: Settings['provider']; models: string[]; error: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const connected = settings.connectedProviders ?? [settings.provider];
  const signature = JSON.stringify(
    connected.map((provider) => [
      provider,
      provider === settings.provider
        ? settings.endpoint
        : settings.providerProfiles?.[provider]?.endpoint,
    ]),
  );
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setCatalogs([]);
    void Promise.all(
      connected.map(async (provider) => {
        try {
          return { provider, models: await api.models({ provider }), error: false };
        } catch {
          return { provider, models: [], error: true };
        }
      }),
    ).then((next) => {
      if (mounted) {
        setCatalogs(next);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [signature]);
  const choice = (provider: string, model: string) => JSON.stringify([provider, model]);
  const current = settings.model ? choice(settings.provider, settings.model) : '';
  const groups = connected.map((provider) => {
    const catalog = catalogs.find((entry) => entry.provider === provider);
    const saved =
      provider === settings.provider
        ? settings.model
        : settings.providerProfiles?.[provider]?.model;
    return {
      provider,
      models: [...new Set([saved, ...(catalog?.models ?? [])].filter(Boolean))] as string[],
      error: catalog?.error,
    };
  });
  return (
    <select
      className="composer-select chat-model-select"
      aria-label={t('Choose model')}
      title={settings.model || t('Choose model')}
      value={current}
      disabled={saving}
      onChange={(e) => {
        if (e.target.value === '__intelligence_settings__') {
          onSettings();
          return;
        }
        const [provider, model] = JSON.parse(e.target.value);
        setSaving(true);
        void api
          .workspace(
            conversationId
              ? { action: 'conversation-model', id: conversationId, provider, model }
              : { action: 'active-model', provider, model },
          )
          .catch((e) => onError(e.message))
          .finally(() => setSaving(false));
      }}
    >
      <option value="" disabled>
        {t('Choose a model')}
      </option>
      {settings.model &&
        !groups.some(
          (group) => group.provider === settings.provider && group.models.includes(settings.model),
        ) && (
          <option value={current} disabled>
            {names[settings.provider]} · {settings.model} · {t('Disconnected')}
          </option>
        )}
      {groups.map(({ provider, models, error }) => (
        <optgroup key={provider} label={names[provider]}>
          {models.map((model) => (
            <option key={model} value={choice(provider, model)}>
              {names[provider]} · {model}
            </option>
          ))}
          {error && <option disabled>{t('Models unavailable — open Settings')}</option>}
        </optgroup>
      ))}
      {loading && <option disabled>{t('Loading models…')}</option>}
      {!loading && !groups.some((group) => group.models.length) && (
        <option disabled>{t('No models found. Configure your provider in Settings.')}</option>
      )}
      <option value="__intelligence_settings__">{t('Model & providers')}…</option>
    </select>
  );
}
