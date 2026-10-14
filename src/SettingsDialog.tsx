import AgentAccessPanel from './AgentAccessPanel';
const HelpGuide = lazy(() => import('./HelpGuide'));
import type { HelpArticle } from './HelpGuide';
import UserProfileFields from './UserProfileFields';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { Settings, Snapshot } from './types';
import { api } from './api';
import { t } from './i18n';
import ModelSettings from './ModelSettings';
import ChatPreferences from './ChatPreferences';
import SearchSettings from './SearchSettings';
import Switch from './Switch';
import { AutomationPanel, BackupPanel } from './WorkspacePanels';
import AppearanceSettings from './AppearanceSettings';
import OptionalModulesPanel from './OptionalModulesPanel';
import LicensesPanel from './LicensesPanel';

export default function SettingsDialog({
  section,
  settings,
  snapshot,
  onSection,
  onSettings,
  onChanged,
  onError,
  onAgent,
  onGuide,
  onTrash,
  trashOpen,
  guideOpen,
  setupReturn = false,
  onLesson,
}: {
  section: string;
  settings: Settings;
  snapshot: Snapshot;
  onSection: (s: string | null) => void;
  onSettings: (s: Partial<Settings>) => Promise<boolean>;
  onChanged: () => Promise<any>;
  onError: (e: any) => void;
  onAgent: () => void;
  onGuide: () => void;
  onTrash: () => void;
  trashOpen: boolean;
  guideOpen: boolean;
  setupReturn?: boolean;
  onLesson: (article: HelpArticle) => void;
}) {
  const [settingsQuery, setSettingsQuery] = useState('');
  const [licensesOpen, setLicensesOpen] = useState(false);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  const changeSettings = onSettings,
    boot = onChanged,
    fail = onError;
  const entities = snapshot.entities.filter((e) => !e.deleted);
  return (
    <div
      className={'modal-backdrop' + (trashOpen ? ' suspended-dialog' : '')}
      inert={trashOpen || guideOpen}
      aria-hidden={trashOpen || guideOpen || undefined}
      onClick={() => onSection(null)}
    >
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('Settings')}
        onClick={(e) => e.stopPropagation()}
      >
        <aside>
          <h2>{t('Settings')}</h2>
          <input
            aria-label={t('Search settings')}
            placeholder={t('Search settings…')}
            value={settingsQuery}
            onChange={(e) => setSettingsQuery(e.target.value)}
          />
          <nav className="settings-navigation" aria-label={t('Settings sections')}>
            {[
              {
                title: 'Personal',
                items: [
                  ['profile', 'Your profile', 'user name identity sharing'],
                  ['appearance', 'Look & feel', 'theme notebook background language layout accent'],
                  ['icons', 'Icons & identity', 'app tray logo icons'],
                ],
              },
              {
                title: 'Assistant',
                items: [
                  [
                    'models',
                    'Model & providers',
                    'model provider api credentials connection tools repair agent',
                  ],
                  ['chat', 'Chat & context', 'thinking context compaction approval width'],
                  ['search', 'Search providers', 'web brave searxng research'],
                  [
                    'modules',
                    'Optional Modules',
                    'voice speech tts stt piper zim offline downloads',
                  ],
                ],
              },
              {
                title: 'Workspace',
                items: [
                  [
                    'access',
                    'Agent access',
                    'permissions scopes terminal notebook vault calendar reports memory',
                  ],
                  [
                    'automation',
                    'Background & automation',
                    'pause notifications tray missed tasks events port wake',
                  ],
                  ['matrix', 'Cognition Matrix', 'queue integration preparation schedule colors'],
                  ['data', 'Your data', 'backup restore export trash storage'],
                ],
              },
            ].map((group) => {
              const items = group.items.filter(
                ([, label, terms]) =>
                  !settingsQuery ||
                  (t(label) + ' ' + terms)
                    .toLocaleLowerCase()
                    .includes(settingsQuery.toLocaleLowerCase()),
              );
              return items.length ? (
                <div className="settings-nav-group" key={group.title}>
                  <span>{t(group.title)}</span>
                  {items.map(([id, label]) => (
                    <button
                      key={id}
                      className={section === id ? 'active' : ''}
                      aria-current={section === id ? 'page' : undefined}
                      onClick={() => onSection(id)}
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
              ) : null;
            })}
          </nav>
          <a
            className="kofi-support"
            href="https://ko-fi.com/B0B5KQRRD"
            target="_blank"
            rel="noopener noreferrer"
            title={t('Opens Ko-fi in your browser. Support is optional.')}
            onClick={(e) => {
              if (snapshot.desktop) {
                e.preventDefault();
                void api.workspace({ action: 'support-kofi' }).catch(fail);
              }
            }}
          >
            {t('Support me on Ko-fi')}
          </a>
          <details className="settings-help-menu">
            <summary>{t('Help & setup')}</summary>
            <button onClick={onGuide}>
              {t(
                settings.onboardingComplete
                  ? 'Review setup'
                  : settings.onboarding?.status === 'deferred'
                    ? 'Continue setup'
                    : 'Getting started',
              )}
            </button>
            <button onClick={() => onSection('guide')}>{t('Written guide')}</button>
            <button onClick={() => onSection('lessons')}>{t('Feature lessons')}</button>
          </details>
          <details className="settings-help-menu">
            <summary>{t('Licenses')}</summary>
            <button onClick={() => setLicensesOpen(true)}>{t('Read licenses & notices')}</button>
          </details>
        </aside>
        {licensesOpen ? <LicensesPanel onClose={() => setLicensesOpen(false)} /> : null}
        <button
          className="settings-close icon-button"
          aria-label={t('Close settings')}
          onClick={() => onSection(null)}
        >
          ×
        </button>
        <div className="settings-content" data-section={section}>
          {setupReturn && (
            <button className="setup-return" onClick={() => onSection(null)}>
              {t('Return to setup')}
            </button>
          )}
          {(section === 'guide' || section === 'lessons') && (
            <Suspense fallback={<p role="status">{t('Opening guide…')}</p>}>
              <HelpGuide
                settings={settings}
                onSetting={(section) => onSection(section)}
                onLesson={onLesson}
                lessons={section === 'lessons'}
              />
            </Suspense>
          )}
          {section === 'profile' && (
            <section className="user-profile-settings settings-section">
              <span className="eyebrow">{t('YOUR PROFILE')}</span>
              <h2>{t('What should we call you?')}</h2>
              <div className="settings-grid">
                <section className="settings-card profile-photo-card">
                  {settings.profilePhoto ? (
                    <img
                      className="user-profile-photo"
                      src={settings.profilePhoto}
                      alt={t('Your profile photo')}
                    />
                  ) : (
                    <div className="user-profile-monogram" aria-hidden="true">
                      {(settings.preferredName || '?').slice(0, 1).toLocaleUpperCase()}
                    </div>
                  )}
                  <div className="profile-photo-actions">
                    <button
                      onClick={() =>
                        void api
                          .image('profile')
                          .then((url) => (url ? changeSettings({ profilePhoto: url }) : null))
                          .catch(fail)
                      }
                    >
                      {t(settings.profilePhoto ? 'Replace photo' : 'Choose photo')}
                    </button>
                    {settings.profilePhoto ? (
                      <button onClick={() => void changeSettings({ profilePhoto: '' })}>
                        {t('Remove photo')}
                      </button>
                    ) : null}
                  </div>
                  <p className="settings-note">
                    {t('Your photo stays on this device until you allow the agent to request it.')}
                  </p>
                </section>
                <UserProfileFields settings={settings} onUpdate={changeSettings} />
              </div>
            </section>
          )}
          {section === 'modules' ? <OptionalModulesPanel onError={fail} /> : null}
          {section === 'models' ? (
            <ModelSettings
              snapshot={snapshot}
              onUpdate={changeSettings}
              onError={fail}
              onAgent={onAgent}
            />
          ) : null}
          {section === 'chat' ? (
            <ChatPreferences settings={settings} onUpdate={changeSettings} />
          ) : null}
          {(section === 'appearance' || section === 'icons') && (
            <AppearanceSettings
              settings={settings}
              onUpdate={changeSettings}
              identity={section === 'icons'}
            />
          )}
          {section === 'access' && (
            <section className="settings-section">
              <span className="eyebrow">{t('IN YOUR HANDS')}</span>
              <h2>{t('Agent access')}</h2>
              <div className="settings-grid">
                <section className="settings-card">
                  <h3>{t('Workspace resources')}</h3>
                  {(
                    [
                      ['notebookAccess', 'Notebook access'],
                      ['vaultAccess', 'Vault access'],
                      ['kanbanAccess', 'Task board access'],
                      ['calendarAccess', 'Calendar access'],
                      ['reportsAccess', 'Reports access'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="setting-switch" key={key}>
                      <span>{t(label)}</span>
                      <Switch
                        checked={settings[key]}
                        onChange={(e) => void changeSettings({ [key]: e.target.checked })}
                      />
                    </label>
                  ))}
                </section>
                <section className="settings-card">
                  <h3>{t('Memory & host tools')}</h3>
                  {(
                    [
                      ['memoryAccess', 'Memory recall'],
                      ['terminalAccess', 'Host terminal commands'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="setting-switch" key={key}>
                      <span>{t(label)}</span>
                      <Switch
                        checked={settings[key]}
                        onChange={(e) => void changeSettings({ [key]: e.target.checked })}
                      />
                    </label>
                  ))}
                  <p className="settings-note">
                    {t(
                      'Resource switches suspend existing grants. Individual items and agent profiles still control what can be used.',
                    )}
                  </p>
                  <p className="settings-note">
                    {t(
                      'Host commands have broader file access and follow your chosen approval mode.',
                    )}
                  </p>
                </section>
              </div>
              <details className="agent-grants-menu">
                <summary>{t('Access for each agent')}</summary>
                <AgentAccessPanel snapshot={snapshot} onChanged={boot} onError={fail} />
              </details>
            </section>
          )}
          {section === 'automation' && (
            <section className="settings-section">
              <span className="eyebrow">{t('WORK IN THE BACKGROUND')}</span>
              <h2>{t('Background & automation')}</h2>
              <div className="settings-grid">
                <section className="settings-card">
                  <h3>{t('Background work')}</h3>
                  <label className="setting-switch">
                    <span>{t('Pause background AI')}</span>
                    <Switch
                      checked={settings.backgroundPaused}
                      onChange={(e) =>
                        void api
                          .workspace({ action: 'pause', paused: e.target.checked })
                          .then(boot)
                          .catch(fail)
                      }
                    />
                  </label>
                  {(
                    [
                      ['background', 'Keep running in the tray'],
                      ['activityNotifications', 'Desktop activity notifications'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="setting-switch" key={key}>
                      <span>{t(label)}</span>
                      <Switch
                        checked={settings[key]}
                        onChange={(e) => void changeSettings({ [key]: e.target.checked })}
                      />
                    </label>
                  ))}
                  <label>
                    {t('Missed task occurrences')}
                    <select
                      aria-label={t('Missed task occurrences')}
                      value={settings.missedTaskPolicy}
                      onChange={(e) =>
                        void changeSettings({
                          missedTaskPolicy: e.target.value as Settings['missedTaskPolicy'],
                        })
                      }
                    >
                      <option value="ask">{t('Ask before running')}</option>
                      <option value="skip">{t('Skip the missed occurrence')}</option>
                      <option value="run">{t('Run when available')}</option>
                    </select>
                  </label>
                  <p className="settings-note">
                    {t('Interrupted or uncertain runs always require review.')}
                  </p>
                </section>
                <AutomationPanel snapshot={snapshot} onSettings={changeSettings} onError={fail} />
              </div>
            </section>
          )}
          {section === 'data' && (
            <section className="settings-section">
              <span className="eyebrow">{t('LOCAL BY DESIGN')}</span>
              <h2>{t('Your work belongs to you.')}</h2>
              <div className="settings-grid">
                <section className="settings-card">
                  <h3>{t('Local storage & Trash')}</h3>
                  <p className="settings-note">
                    {t(
                      'Conversations, notebooks, memory, and task history live in your local Intelligence data directory.',
                    )}
                  </p>
                  <button onClick={onTrash}>{t('Open Trash ↗')}</button>
                </section>
                <BackupPanel onChanged={() => void boot()} onError={fail} />
              </div>
            </section>
          )}
          {section === 'search' ? (
            <SearchSettings snapshot={snapshot} onUpdate={changeSettings} onError={fail} />
          ) : null}
          {section === 'matrix' ? (
            <section className="settings-section matrix-settings">
              <span className="eyebrow">{t('COGNITION MATRIX')}</span>
              <h2>{t('Make room for the way you work.')}</h2>
              <div className="settings-grid">
                <section className="settings-card">
                  <h3>{t('Task execution')}</h3>
                  <div className="matrix-settings-grid">
                    <label className="matrix-preload-control">
                      <Switch
                        checked={settings.matrixPreload ?? true}
                        onChange={(e) => void changeSettings({ matrixPreload: e.target.checked })}
                      />
                      <span>{t('Prepare model before Matrix tasks')}</span>
                      <small>
                        {t(
                          'On: prepare each list’s model before scheduled work. Off: use only the selected chat model if it is already loaded; otherwise report why the task did not run.',
                        )}
                      </small>
                    </label>
                    <label>
                      {t('Prepare model before task (minutes)')}
                      <input
                        type="number"
                        min={1}
                        max={10}
                        disabled={!settings.matrixPreload}
                        aria-label={t('Matrix preload lead time')}
                        defaultValue={settings.matrixPreloadMinutes ?? 5}
                        onBlur={(e) =>
                          void changeSettings({ matrixPreloadMinutes: Number(e.target.value) })
                        }
                      />
                      <small>
                        {t(
                          'One preparation at a time. Local Matrix requests use a 15-minute idle timeout; no continuous keep-alive prompts.',
                        )}
                      </small>
                    </label>
                    <label>
                      {t('Task time budget (minutes)')}
                      <input
                        type="number"
                        min={1}
                        max={480}
                        aria-label={t('Matrix task time budget')}
                        defaultValue={settings.matrixMaxMinutes}
                        onBlur={(e) =>
                          void changeSettings({ matrixMaxMinutes: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      {t('Maximum tool steps per task')}
                      <input
                        type="number"
                        min={1}
                        max={128}
                        aria-label={t('Matrix tool step budget')}
                        defaultValue={settings.matrixMaxSteps}
                        onBlur={(e) =>
                          void changeSettings({ matrixMaxSteps: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      {t('Queue order')}
                      <select
                        aria-label={t('Matrix queue order')}
                        value={settings.matrixScheduling}
                        onChange={(e) =>
                          void changeSettings({
                            matrixScheduling: e.target.value as Settings['matrixScheduling'],
                          })
                        }
                      >
                        <option value="round-robin">{t('Lists take turns')}</option>
                        <option value="priority">
                          {['core', 'secondary', 'tertiary']
                            .map(
                              (slot) =>
                                entities.find((e) => e.id === 'matrix-' + slot)?.title ?? slot,
                            )
                            .join(' → ')}
                        </option>
                      </select>
                    </label>
                  </div>
                </section>
                <section className="settings-card">
                  <h3>{t('Display & state colors')}</h3>
                  <label className="setting-switch">
                    <span>{t('Agent access to Matrix items')}</span>
                    <Switch
                      checked={settings.matrixAccess}
                      onChange={(e) => void changeSettings({ matrixAccess: e.target.checked })}
                    />
                  </label>
                  <label className="setting-switch">
                    <span>{t('Show completed tasks')}</span>
                    <Switch
                      checked={settings.matrixShowCompleted}
                      onChange={(e) =>
                        void changeSettings({ matrixShowCompleted: e.target.checked })
                      }
                    />
                  </label>
                  <label className="setting-switch">
                    <span>{t('Compact task rows')}</span>
                    <Switch
                      checked={settings.matrixCompactRows}
                      onChange={(e) => void changeSettings({ matrixCompactRows: e.target.checked })}
                    />
                  </label>
                  <div className="matrix-settings-colors">
                    {(
                      [
                        ['matrixWorkingColor', t('◌ Working')],
                        ['matrixDoneColor', t('✓ Done')],
                        ['matrixFailedColor', t('✕ Failed')],
                        ['matrixAttentionColor', t('= Needs attention')],
                        ['matrixQueuedColor', t('○ Queued')],
                      ] as [keyof Settings, string][]
                    ).map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="color"
                          aria-label={label + t(' color')}
                          data-tooltip={t(
                            'Choose the color used for this Matrix task state. Labels and symbols remain visible.',
                          )}
                          value={String(settings[key])}
                          onChange={(e) => void changeSettings({ [key]: e.target.value })}
                        />
                        {t(label)}
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
