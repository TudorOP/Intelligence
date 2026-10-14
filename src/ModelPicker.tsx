import { useEffect, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Settings } from './types';
export default function ModelPicker({
  settings,
  models: provided,
  onUpdate,
  onError,
  matrix = false,
}: {
  settings: Settings;
  models?: string[];
  onUpdate: (input: Partial<Settings>) => Promise<any>;
  onError: (error: any) => void;
  matrix?: boolean;
}) {
  const [models, setModels] = useState<string[]>(provided ?? []),
    [manual, setManual] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (provided) setModels(provided);
  }, [provided]);
  useEffect(() => {
    let mounted = true;
    setModels(provided ?? []);
    if (!provided)
      api
        .models({ provider: settings.provider })
        .then((list) => {
          if (mounted) setModels(list);
        })
        .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [settings.provider, settings.endpoint]);
  const values = [...new Set([settings.model, ...models].filter(Boolean))];
  return (
    <div className="model-picker">
      <select
        aria-label={t('Selected model')}
        value={settings.model}
        disabled={busy}
        onChange={(e) => void onUpdate({ model: e.target.value }).catch(onError)}
      >
        <option value="">{t('Choose a model')}</option>
        {values.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy}
        aria-label={t('Refresh models')}
        onClick={() => {
          setBusy(true);
          api
            .models({ provider: settings.provider }, true)
            .then(setModels)
            .catch(onError)
            .finally(() => setBusy(false));
        }}
      >
        ↻
      </button>
      <button type="button" aria-expanded={manual} onClick={() => setManual((v) => !v)}>
        {t('Model ID')}
      </button>
      {manual ? (
        <input
          className="manual-model"
          key={settings.provider + settings.model}
          aria-label={t('Model identifier')}
          defaultValue={settings.model}
          placeholder={t('Choose or enter a model ID')}
          onBlur={(e) => {
            if (e.target.value !== settings.model)
              void onUpdate({ model: e.target.value }).catch(onError);
          }}
        />
      ) : null}
    </div>
  );
}
