import { useEffect, useState } from 'react';
import SearchPicker from './SearchPicker';
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
    <SearchPicker
      compact
      label={t('Choose model')}
      value={current}
      disabled={saving}
      options={[
        ...groups.flatMap(({ provider, models, error }) => [
          ...models.map((model) => ({
            value: choice(provider, model),
            label: model,
            group: names[provider],
          })),
          ...(error
            ? [
                {
                  value: '__unavailable__' + provider,
                  label: t('Models unavailable — open Settings'),
                  group: names[provider],
                  disabled: true,
                },
              ]
            : []),
        ]),
        ...(settings.model &&
        !groups.some((g) => g.provider === settings.provider && g.models.includes(settings.model))
          ? [
              {
                value: current,
                label: settings.model,
                group: names[settings.provider],
                detail: t('Disconnected'),
                disabled: true,
              },
            ]
          : []),
      ]}
      status={
        loading
          ? t('Loading models…')
          : groups.some((g) => g.error)
            ? t('Models unavailable — open Settings')
            : undefined
      }
      footer={{ label: t('Model & providers'), action: onSettings }}
      onChange={(value) => {
        const [provider, model] = JSON.parse(value);
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
    />
  );
}
