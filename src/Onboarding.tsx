import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Settings, Snapshot } from './types';
import { initialSetup, setupStages, type SetupProgress } from '../electron/onboarding.mjs';
import UserProfileFields from './UserProfileFields';
import ModelSettings from './ModelSettings';
import Switch from './Switch';
import { resourceLabel } from '../electron/resource-catalog.mjs';
import './setup.css';

const titles = [
  'Welcome to Intelligence',
  'Make Intelligence yours',
  'Connect your AI',
  'Choose what your agent can do',
  'Memory and automatic work',
  'Review and begin',
];
const descriptions = [
  'Your workspace keeps conversations, notes and tasks together. A model produces replies; your agent uses it to help with your work.',
  'These details are optional. You can change them later in Settings.',
  'A model is the AI that replies to you. Connect one here, or set it up later.',
  'Read means looking at content. Read & edit also allows changes. Assigning tasks and approving host commands are separate choices.',
  'Choose what to remember and what may run automatically. Optional downloads and recurring tasks are separate choices.',
  'Check your choices. You can begin browsing without a model and finish connecting later.',
];
export default function Onboarding({
  snapshot,
  onClose,
  onSettings,
  onHelp,
  onChanged,
  resumeReview = false,
}: {
  snapshot: Snapshot;
  onClose: (finished?: boolean) => void;
  onSettings: (section: string) => void;
  onHelp: () => void;
  onChanged: () => Promise<any>;
  resumeReview?: boolean;
}) {
  const start = snapshot.settings.onboarding;
  const reviewing = useRef(start?.status === 'completed').current;
  const [progress, setProgress] = useState<SetupProgress>(
    start
      ? start.status !== 'completed' || resumeReview
        ? start
        : { ...start, stage: 'welcome' }
      : { ...initialSetup },
  );
  const index = Math.max(0, setupStages.indexOf(progress.stage));
  const agentId = useRef(snapshot.settings.activeAgent).current;
  const agent = snapshot.entities.find((e) => e.id === agentId);
  const [draft, setDraft] = useState(snapshot.settings);
  const [agentName, setAgentName] = useState(agent?.title || 'Intelligence');
  const [style, setStyle] = useState(agent?.data.personality || snapshot.settings.personality);
  const [policy, setPolicy] = useState<'shared' | 'ask'>(agent?.data.resourcePolicy || 'shared');
  const [grants, setGrants] = useState<{ id: string; permission: string }[]>(
    agent?.data.resourceGrants || [],
  );
  const [dirty, setDirty] = useState(false),
    [exitPrompt, setExitPrompt] = useState(false);
  const [resourceQuery, setResourceQuery] = useState('');
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [testStatus, setTestStatus] = useState(''),
    [testedSignature, setTestedSignature] = useState('');
  const testId = useRef<string | null>(null),
    mounted = useRef(true);
  const signature = [
    snapshot.settings.provider,
    snapshot.settings.endpoint,
    snapshot.settings.model,
    snapshot.inference?.key.generation || 0,
  ].join('|');
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current !== signature) {
      setTestStatus('');
      setTestedSignature('');
      lastSignature.current = signature;
      if (testId.current)
        void api.modelTest({ action: 'cancel', id: testId.current }).catch(() => {});
    }
  }, [signature]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (testId.current)
        void api.modelTest({ action: 'cancel', id: testId.current }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    document.querySelector<HTMLElement>('.setup-dialog header button')?.focus();
  }, [index]);
  const roots = snapshot.entities
    .filter(
      (e) =>
        !e.deleted &&
        ['notebook', 'board', 'project', 'calendar', 'vault-folder'].includes(e.kind) &&
        !e.parent &&
        e.title.toLocaleLowerCase().includes(resourceQuery.toLocaleLowerCase()),
    )
    .slice(0, 100);
  const save = async (
    stage = progress.stage,
    status: SetupProgress['status'] = 'in-progress',
    skipped = false,
  ) => {
    setBusy(true);
    setNotice('');
    try {
      if (!skipped && index === 1) {
        await api.settings({
          preferredName: draft.preferredName,
          profileDescription: draft.profileDescription,
          shareName: draft.shareName,
          shareProfile: draft.shareProfile,
        });
        const current = await api.bootstrap();
        if (current.settings.activeAgent !== agentId)
          throw Error('The active agent changed. Close setup and open it again.');
        const profile = current.entities.find((e) => e.id === agentId);
        if (!profile) throw Error('Agent profile not found');
        await api.workspace({
          action: 'profile-save',
          id: agentId,
          revision: profile.revision,
          title: agentName.trim() || profile.title,
          data: { personality: style },
        });
      }
      if (!skipped && index === 3) {
        const current = await api.bootstrap();
        const profile = current.entities.find((e) => e.id === agentId);
        if (!profile || current.settings.activeAgent !== agentId)
          throw Error('The active agent changed. Close setup and open it again.');
        await api.workspace({
          action: 'profile-save',
          id: agentId,
          revision: profile.revision,
          data: { resourcePolicy: policy, resourceGrants: grants },
        });
      }
      const next: SetupProgress = {
        ...progress,
        stage,
        status: reviewing ? 'completed' : status,
        outcomes: { ...progress.outcomes, [progress.stage]: skipped ? 'skipped' : 'configured' },
      };
      await api.settings({ onboarding: next });
      setProgress(next);
      setDirty(false);
      await onChanged();
      return true;
    } catch (error) {
      setNotice((error as Error).message);
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const exit = async () => {
    if (await save(progress.stage, 'deferred')) onClose();
  };
  const requestClose = () => {
    if (busy) return;
    if (dirty) setExitPrompt(true);
    else void exit();
  };
  const update = async (value: Partial<Settings>) => {
    try {
      await api.settings(value);
      await onChanged();
      return true;
    } catch (error) {
      setNotice((error as Error).message);
      return false;
    }
  };
  const navigate = async (target: number, skipped = false) => {
    await save(setupStages[target], 'in-progress', skipped);
  };
  const detour = async (section: string) => {
    if (await save(progress.stage)) onSettings(section);
  };
  const testReply = async () => {
    const id = crypto.randomUUID();
    testId.current = id;
    setBusy(true);
    setTestStatus(t('Testing a reply…'));
    try {
      await api.modelTest({ action: 'test', id });
      if (mounted.current && testId.current === id) {
        setTestedSignature(signature);
        setTestStatus(t('Reply tested. This model can chat. Agent tools remain untested.'));
      }
    } catch (error) {
      if (mounted.current) setTestStatus((error as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
      testId.current = null;
    }
  };
  const connected =
    !!snapshot.settings.model &&
    snapshot.settings.connectedProviders?.includes(snapshot.settings.provider);
  return (
    <div className="modal-backdrop onboarding-backdrop">
      <section
        className="form-dialog onboarding setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('Getting started')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            requestClose();
          }
        }}
      >
        <header>
          <span className="eyebrow">
            {t('GETTING STARTED')} · {index + 1} / 6
          </span>
          <button className="icon-button" aria-label={t('Close guide')} onClick={requestClose}>
            ×
          </button>
          <h1>{t(titles[index])}</h1>
          <p>{t(descriptions[index])}</p>
          <nav className="setup-progress" aria-label={t('Setup progress')}>
            {setupStages.map((id, i) => (
              <span
                key={id}
                aria-current={i === index ? 'step' : undefined}
                className={i <= index ? 'reached' : ''}
              >
                <span>{i + 1}</span>
                {t(['Welcome', 'Your profile', 'Model', 'Agent access', 'Memory', 'Review'][i])}
              </span>
            ))}
          </nav>
        </header>
        <div className="setup-body">
          {index === 0 && (
            <>
              <label>
                {t('Interface language')}
                <select
                  value={snapshot.settings.language}
                  onChange={(e) =>
                    void update({ language: e.target.value as Settings['language'] })
                  }
                >
                  <option value="en">English</option>
                  <option value="ro">Română</option>
                </select>
              </label>
              <div className="setup-cards">
                <section className="settings-card">
                  <h3>{t('Your work stays in your workspace')}</h3>
                  <p>
                    {t(
                      'Local storage does not mean every service is offline. Online model providers and connected tools receive the content you send to them.',
                    )}
                  </p>
                </section>
                <section className="settings-card">
                  <h3>{t('You stay in control')}</h3>
                  <p>
                    {t(
                      'Connecting a model does not give an agent access to your work. Choose access during setup or when an agent asks.',
                    )}
                  </p>
                </section>
              </div>
              <button onClick={() => void detour('data')}>{t('Restore a backup')}</button>
            </>
          )}
          {index === 1 && (
            <div className="setup-cards">
              <UserProfileFields
                settings={draft}
                onUpdate={(value) => {
                  setDraft((old) => ({ ...old, ...value }));
                  setDirty(true);
                }}
              />
              <section className="settings-card">
                <h3>{t('Your companion')}</h3>
                <label>
                  {t('Agent name')}
                  <input
                    maxLength={100}
                    value={agentName}
                    onChange={(e) => {
                      setAgentName(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
                <label>
                  {t('How should it help?')}
                  <textarea
                    rows={5}
                    maxLength={50000}
                    value={style}
                    onChange={(e) => {
                      setStyle(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
                <p>
                  {t(
                    'Style preferences change how the agent communicates. Required instructions and permission checks always remain active.',
                  )}
                </p>
                <p>
                  {t(
                    'Profile access includes your description and any profile photo, only when useful. Shared information may reach your chosen model provider.',
                  )}
                </p>
              </section>
            </div>
          )}
          {index === 2 && (
            <>
              <div className="setup-connection-choices">
                <button
                  aria-pressed={
                    !['openai', 'mistral', 'qwen', 'openrouter', 'compatible'].includes(
                      snapshot.settings.provider,
                    )
                  }
                  onClick={() => void update({ provider: 'ollama' })}
                >
                  {t('On this computer')}
                </button>
                <button
                  aria-pressed={['openai', 'mistral', 'qwen', 'openrouter', 'compatible'].includes(
                    snapshot.settings.provider,
                  )}
                  onClick={() => void update({ provider: 'openai' })}
                >
                  {t('Online service')}
                </button>
              </div>
              <ModelSettings
                snapshot={snapshot}
                guided
                onUpdate={update}
                onError={(e) => setNotice(e.message)}
              />
              <p className="settings-note">
                {t(
                  'A local address identifies the server. Some local servers can route models elsewhere; check your server settings before assuming inference is offline.',
                )}
              </p>
              {connected && (
                <section className="setup-reply-test">
                  <p>
                    {t(
                      'Test a reply sends a short greeting request to this model. Online services may charge for it. No profile, notes or chat history are sent.',
                    )}
                  </p>
                  <button
                    disabled={busy && !testId.current}
                    onClick={() => {
                      if (testId.current)
                        void api.modelTest({ action: 'cancel', id: testId.current });
                      else void testReply();
                    }}
                  >
                    {t(testId.current ? 'Cancel test' : 'Test a reply')}
                  </button>
                </section>
              )}
              {testStatus && <p role="status">{t(testStatus)}</p>}
              <button disabled={busy} onClick={() => void detour('models')}>
                {t('Advanced setup in Settings')}
              </button>
            </>
          )}
          {index === 3 && (
            <>
              <label>
                {t('Access for this agent')}
                <select
                  value={policy}
                  onChange={(e) => {
                    setPolicy(e.target.value as 'ask' | 'shared');
                    setDirty(true);
                  }}
                >
                  <option value="ask">{t('Selected resources only; ask when needed')}</option>
                  <option value="shared">{t('Use resources already shared with agents')}</option>
                </select>
              </label>
              <p>
                {t(
                  'Global resource switches can suspend access. An agent request cannot silently enable them or remove child exceptions.',
                )}
              </p>
              {policy === 'ask' && (
                <div className="setup-resource-list">
                  <label>
                    {t('Find a resource')}
                    <input
                      value={resourceQuery}
                      onChange={(e) => setResourceQuery(e.target.value)}
                    />
                  </label>
                  <small>
                    {t('Showing up to 100 matching resources. Search to find another.')}
                  </small>
                  {roots.map((item) => {
                    const grant = grants.find((g) => g.id === item.id);
                    return (
                      <div key={item.id}>
                        <span>
                          {item.title}
                          <small>{t(resourceLabel(item.kind))}</small>
                        </span>
                        <select
                          aria-label={t('Access for ') + item.title}
                          value={grant?.permission || 'none'}
                          onChange={(e) => {
                            setGrants((old) => [
                              ...old.filter((g) => g.id !== item.id),
                              ...(e.target.value === 'none'
                                ? []
                                : [{ id: item.id, permission: e.target.value }]),
                            ]);
                            setDirty(true);
                          }}
                        >
                          <option value="none">{t('No access')}</option>
                          <option value="read">{t('Read')}</option>
                          <option value="edit">{t('Read & edit')}</option>
                        </select>
                      </div>
                    );
                  })}
                  {!roots.length && (
                    <p>
                      {t(
                        'No collections yet. You can select resources or approve a request after creating them.',
                      )}
                    </p>
                  )}
                </div>
              )}
              <p>
                {t(
                  'Host commands have separate approvals. Full Access is never selected by setup.',
                )}
              </p>
              <button onClick={() => void detour('access')}>
                {t('Review global access switches')}
              </button>
            </>
          )}
          {index === 4 && (
            <>
              <div className="setup-cards">
                <section className="settings-card">
                  <h3>{t('Memory')}</h3>
                  {(
                    [
                      [
                        'memoryAccess',
                        'Memory recall',
                        'Let agents use permitted saved memories and conversations.',
                      ],
                      [
                        'semanticSearch',
                        'Automatic semantic search',
                        'Downloads local CPU models for searching by meaning. Keyword search works without them.',
                      ],
                      [
                        'autoConsolidation',
                        'Automatic summaries & facts',
                        'Processes eligible conversations automatically. Check your model provider and memory sources.',
                      ],
                    ] as const
                  ).map(([key, label, help]) => (
                    <label className="setting-switch" key={key}>
                      <span>
                        {t(label)}
                        <small>{t(help)}</small>
                      </span>
                      <Switch
                        checked={snapshot.settings[key]}
                        onChange={(e) => void update({ [key]: e.target.checked })}
                      />
                    </label>
                  ))}
                  <p>
                    {t(
                      'Downloads live in user data, separate from the application. Preparation needs internet access; download sizes depend on the selected models.',
                    )}
                  </p>
                  <button
                    onClick={() =>
                      void api
                        .memoryEnable()
                        .then(onChanged)
                        .catch((e) => setNotice(e.message))
                    }
                  >
                    {t('Prepare memory now')}
                  </button>
                  <small>{t(snapshot.memoryStatus || '')}</small>
                </section>
                <section className="settings-card">
                  <h3>{t('Automatic work')}</h3>
                  <label className="setting-switch">
                    <span>
                      {t('Background AI')}
                      <small>
                        {t(
                          'Allow eligible assigned tasks to run automatically. Assignment, schedules and Cognition Matrix integration are still separate.',
                        )}
                      </small>
                    </span>
                    <Switch
                      checked={snapshot.settings.background}
                      onChange={(e) => void update({ background: e.target.checked })}
                    />
                  </label>
                  <p>
                    {t(
                      'Pause AI pauses automatic tasks and memory processing. Your foreground conversation remains available.',
                    )}
                  </p>
                  <button onClick={() => void detour('automation')}>
                    {t('Review automatic work settings')}
                  </button>
                </section>
              </div>
            </>
          )}
          {index === 5 && (
            <>
              <dl className="setup-review">
                <dt>{t('Model')}</dt>
                <dd>
                  {connected
                    ? snapshot.settings.model +
                      ' · ' +
                      t(
                        testedSignature === signature
                          ? 'Reply tested'
                          : 'Selected; reply not verified here',
                      )
                    : t('Not connected — browsing is available')}
                </dd>
                <dt>{t('Profile sharing')}</dt>
                <dd>
                  {snapshot.settings.shareProfile
                    ? t('Description and photo available on demand')
                    : t('Profile access is off')}
                </dd>
                <dt>{t('Agent access')}</dt>
                <dd>
                  {t(
                    agent?.data.resourcePolicy === 'ask'
                      ? 'Selected resources only; ask when needed'
                      : 'Use resources already shared with agents',
                  )}
                </dd>
                <dt>{t('Automatic semantic search')}</dt>
                <dd>{t(snapshot.settings.semanticSearch ? 'Enabled' : 'Disabled')}</dd>
                <dt>{t('Automatic summaries & facts')}</dt>
                <dd>{t(snapshot.settings.autoConsolidation ? 'Enabled' : 'Disabled')}</dd>
                <dt>{t('Background AI')}</dt>
                <dd>{t(snapshot.settings.background ? 'Enabled' : 'Disabled')}</dd>
              </dl>
              <div className="setup-edit-links">
                {[1, 2, 3, 4].map((i) => (
                  <button key={i} onClick={() => void navigate(i)}>
                    {t('Edit')} · {t(titles[i])}
                  </button>
                ))}
              </div>
              <p>
                {t(
                  'Optional next steps: appearance, web search, voice, offline archives, connections and backups. None are required to start.',
                )}
              </p>
              <button
                onClick={() => {
                  void save(progress.stage, 'completed').then((done) => {
                    if (done) {
                      onClose(true);
                      onHelp();
                    }
                  });
                }}
              >
                {t('Finish & learn the workspace')}
              </button>
            </>
          )}
          {notice && <p role="alert">{t(notice)}</p>}
          {exitPrompt && (
            <section className="setup-exit-prompt" role="alert">
              <p>{t('Keep your unsaved setup changes? Applied settings stay saved.')}</p>
              <button onClick={() => void exit()}>{t('Save & exit')}</button>
              <button
                onClick={() => {
                  void api
                    .settings({ onboarding: { ...progress, status: 'deferred' } })
                    .then(() => {
                      onClose();
                      void onChanged();
                    })
                    .catch((e) => setNotice(e.message));
                }}
              >
                {t('Discard unsaved edits')}
              </button>
              <button onClick={() => setExitPrompt(false)}>{t('Keep editing')}</button>
            </section>
          )}
        </div>
        <footer>
          <button disabled={busy || !index} onClick={() => void navigate(index - 1)}>
            {t('Back')}
          </button>
          <button disabled={busy} onClick={() => void exit()}>
            {t(index === 0 ? 'Explore first' : 'Save & exit')}
          </button>
          {index > 0 && index < 5 && (
            <button disabled={busy} onClick={() => void navigate(index + 1, true)}>
              {t('Skip for now')}
            </button>
          )}
          {index < 5 ? (
            <button
              className="primary"
              disabled={busy || (index === 2 && !connected)}
              onClick={() => void navigate(index + 1)}
            >
              {t(index === 0 ? 'Start setup' : 'Continue')}
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void save('review', 'completed').then((done) => {
                  if (done) onClose(true);
                })
              }
            >
              {t(connected ? 'Start chatting' : 'Open workspace')}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
