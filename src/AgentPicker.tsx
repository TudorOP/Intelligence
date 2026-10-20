import SearchPicker, { type PickerOption } from './SearchPicker';
import type { Entity, Settings } from './types';
import { t } from './i18n';
import { art } from './api';
import { providerNames } from './providers';
export default function AgentPicker({
  entities,
  settings,
  value,
  onChange,
  inherit,
  manual = false,
  disabled = false,
}: {
  entities: Entity[];
  settings: Settings;
  value: string;
  onChange: (id: string) => void;
  inherit?: string;
  manual?: boolean;
  disabled?: boolean;
}) {
  const options: PickerOption[] = entities
    .filter((e) => e.kind === 'agent-profile' && !e.deleted)
    .map((p) => ({
      value: p.id,
      label: p.title,
      detail: `${providerNames[p.data.inheritModel ? settings.provider : p.data.provider || settings.provider]} · ${p.data.inheritModel ? settings.model || t('Choose a model') : p.data.model || t('Choose a model')}`,
      image: p.data.avatar ? art(p.data.avatar) : undefined,
    }));
  if (value && !['inherit', 'manual'].includes(value) && !options.some((o) => o.value === value))
    options.unshift({
      value,
      label: t('Unavailable agent'),
      detail: t('Choose another agent'),
      image: undefined,
      disabled: true,
    });
  return (
    <SearchPicker
      label={t('Choose agent')}
      value={value}
      options={[
        ...(manual ? [{ value: 'manual', label: t('Manual only') }] : []),
        ...(inherit !== undefined
          ? [{ value: 'inherit', label: t('Inherit assignment'), detail: inherit }]
          : []),
        ...options,
      ]}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
