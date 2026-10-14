import type { Settings } from './types';
import { t } from './i18n';
import Switch from './Switch';
export const approvalChoices = [
  ['ask', 'Ask for approval'],
  ['auto', 'Approve for me'],
  ['full', 'Full Access'],
] as const;
export default function ChatPreferences({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (input: Partial<Settings>) => Promise<any>;
}) {
  return (
    <section className="settings-section chat-settings">
      <span className="eyebrow">{t('CHAT & CONTEXT')}</span>
      <h2>{t('Conversation preferences')}</h2>
      <div className="settings-grid">
        <section className="settings-card">
          <h3>{t('Reading & responses')}</h3>
          <label>
            {t('Chat width')}
            <select
              aria-label={t('Chat width')}
              value={settings.chatWidth ?? 'comfortable'}
              onChange={(e) =>
                void onUpdate({ chatWidth: e.target.value as Settings['chatWidth'] })
              }
            >
              <option value="comfortable">{t('Comfortable reading')}</option>
              <option value="wide">{t('Use the wider canvas')}</option>
            </select>
          </label>
          {(
            [
              ['followLatest', 'Follow the latest message'],
              ['showThinking', 'Show thinking'],
            ] as const
          ).map(([key, label]) => (
            <label className="setting-switch" key={key}>
              <span>{t(label)}</span>
              <Switch
                checked={settings[key] ?? key !== 'showThinking'}
                onChange={(e) => void onUpdate({ [key]: e.target.checked })}
              />
            </label>
          ))}
        </section>
        <section className="settings-card">
          <h3>{t('Context & approvals')}</h3>
          <label className="setting-switch">
            <span>{t('Automatic context compaction')}</span>
            <Switch
              checked={settings.autoCompact}
              onChange={(e) => void onUpdate({ autoCompact: e.target.checked })}
            />
          </label>
          <label>
            {t('Compact at context usage (%)')}
            <input
              aria-label={t('Compact at context usage (%)')}
              type="number"
              min={25}
              max={95}
              defaultValue={settings.compactPercent ?? 75}
              onBlur={(e) => void onUpdate({ compactPercent: Number(e.target.value) })}
            />
            <small>
              {t(
                'Default: 75%. Original messages stay on disk; summaries replace older context sent to the model.',
              )}
            </small>
          </label>
          <label>
            {t('Context capacity override (tokens)')}
            <input
              aria-label={t('Context capacity override (tokens)')}
              type="number"
              min={0}
              max={2000000}
              defaultValue={settings.contextOverride ?? 0}
              onBlur={(e) => void onUpdate({ contextOverride: Number(e.target.value) })}
            />
            <small>
              {t(
                '0 detects the loaded model window when available. If the server does not report it, an 8192-token fallback is clearly labeled; enter the actual capacity here.',
              )}
            </small>
          </label>
          <label>
            {t('Command approvals')}
            <select
              aria-label={t('Command approvals')}
              data-tooltip={t(
                'Ask reviews each host action. Approve for me automatically accepts supported read-only project commands and writes inside an editable project; other actions still ask. Full Access skips action approvals. Selecting either automatic mode enables host commands; the host-terminal switch can revoke them. Resource grants and read-only machine sessions remain enforced.',
              )}
              value={settings.approvalMode ?? 'ask'}
              onChange={(e) =>
                void onUpdate({ approvalMode: e.target.value as Settings['approvalMode'] })
              }
            >
              {approvalChoices.map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <p>
            {t(
              'Full Access skips ordinary per-action approval. MCP server setup still requires review. Resource grants and read-only sessions still apply.',
            )}
          </p>
        </section>
      </div>
    </section>
  );
}
