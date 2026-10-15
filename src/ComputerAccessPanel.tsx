import type { Settings } from './types';
import { t } from './i18n';
import { api } from './api';
import Switch from './Switch';
import { approvalChoices } from './ChatPreferences';
export default function ComputerAccessPanel({
  settings,
  onUpdate,
  onError,
}: {
  settings: Settings;
  onUpdate: (s: Partial<Settings>) => Promise<any>;
  onError: (e: any) => void;
}) {
  const update = (s: Partial<Settings>) => void onUpdate(s).catch(onError);
  return (
    <section className="settings-card computer-access">
      <h3>{t('Computer access')}</h3>
      <label>
        {t('File access scope')}
        <select
          aria-label={t('File access scope')}
          value={settings.computerScope || 'projects'}
          onChange={(e) => update({ computerScope: e.target.value as Settings['computerScope'] })}
        >
          <option value="projects">{t('Authorized project folders')}</option>
          <option value="folders">{t('Projects and selected folders')}</option>
          <option value="system">{t('All files available to my account')}</option>
        </select>
      </label>
      <small>
        {t(
          'File tools enforce this scope. Intelligence storage stays protected. Profiles can restrict access further.',
        )}
      </small>
      {settings.computerScope === 'folders' && (
        <>
          {(settings.computerFolders || []).map((f, i) => (
            <div className="grant-row" key={f.directory}>
              <span className="path-text">{f.directory}</span>
              <select
                aria-label={t('Folder permission') + ' ' + f.directory}
                value={f.permission}
                onChange={(e) =>
                  update({
                    computerFolders: settings.computerFolders.map((old, index) =>
                      index === i ? { ...old, permission: e.target.value as 'read' | 'edit' } : old,
                    ),
                  })
                }
              >
                <option value="read">{t('Read')}</option>
                <option value="edit">{t('Read & edit')}</option>
              </select>
              <button
                onClick={() =>
                  update({
                    computerFolders: settings.computerFolders.filter((_, index) => index !== i),
                  })
                }
              >
                {t('Revoke')}
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              void api
                .directory()
                .then((directory) => {
                  if (
                    directory &&
                    !settings.computerFolders?.some((f) => f.directory === directory)
                  )
                    update({
                      computerFolders: [
                        ...(settings.computerFolders || []),
                        { directory, permission: 'read' },
                      ],
                    });
                })
                .catch(onError)
            }
          >
            {t('Add folder')}
          </button>
        </>
      )}
      <label className="setting-switch">
        <span>{t('Host terminal commands')}</span>
        <Switch
          checked={settings.terminalAccess}
          onChange={(e) => update({ terminalAccess: e.target.checked })}
        />
      </label>
      <label>
        {t('Command approvals')}
        <select
          aria-label={t('Command approvals')}
          value={settings.approvalMode || 'ask'}
          onChange={(e) => update({ approvalMode: e.target.value as Settings['approvalMode'] })}
        >
          {approvalChoices.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
      <small>
        {t(
          'Selecting automatic approval enables host commands. The terminal switch can revoke them.',
        )}
      </small>
      <label className="setting-switch">
        <span>{t('Ask before destructive or unclassified actions')}</span>
        <Switch
          checked={settings.askDestructive !== false}
          onChange={(e) => update({ askDestructive: e.target.checked })}
        />
      </label>
      <p className="settings-note">
        {t(
          'Approve for me accepts supported actions within file scope. Full Access approves ordinary commands automatically. Protected destructive or unclassified commands still ask. Reviewed shell commands can access files available to your account; file-tool scopes are not a shell sandbox. MCP setup always requires review.',
        )}
      </p>
    </section>
  );
}
