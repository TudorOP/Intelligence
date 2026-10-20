import type { Settings } from './types';
import { t } from './i18n';
import Switch from './Switch';

export default function UserProfileFields({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (value: Partial<Settings>) => unknown;
}) {
  return (
    <div className="settings-card profile-settings-card">
      <label>
        {t('Your name')}
        <input
          aria-label={t('Your name')}
          maxLength={100}
          value={settings.preferredName || ''}
          onChange={(e) => void onUpdate({ preferredName: e.target.value })}
        />
      </label>
      <label className="setting-switch">
        <span>
          {t('Share my name with agents')}
          <small>
            {t('Your name is shared as context data with the selected model provider.')}
          </small>
        </span>
        <Switch
          checked={settings.shareName}
          onChange={(e) => void onUpdate({ shareName: e.target.checked })}
        />
      </label>
      <label>
        {t('Describe yourself (optional)')}
        <small>{t('What would you like Intelligence to know about you?')}</small>
        <textarea
          aria-label={t('Describe yourself (optional)')}
          maxLength={2000}
          rows={5}
          value={settings.profileDescription || ''}
          onChange={(e) => void onUpdate({ profileDescription: e.target.value })}
        />
      </label>
      <label className="setting-switch">
        <span>
          {t('Allow profile access on demand')}
          <small>
            {t(
              'The agent can request your description and photo when useful. They are not added to every prompt.',
            )}
          </small>
        </span>
        <Switch
          checked={settings.shareProfile || false}
          onChange={(e) => void onUpdate({ shareProfile: e.target.checked })}
        />
      </label>
    </div>
  );
}
