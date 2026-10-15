import { useEffect, useRef, useState } from 'react';
import { api, art } from './api';
import { t } from './i18n';
import type { Entity, Snapshot } from './types';
import { logoPath } from './branding';
import Switch from './Switch';
import ModelPicker from './ModelPicker';
import AgentAccessPanel from './AgentAccessPanel';
import Modal from './Modal';
import { providers } from './providers';
import AgentChoicesDialog, { type AgentChoice } from './AgentChoicesDialog';
import Icon from './Icon';
const ratings = [
  ['intelligence', 'Intelligence'],
  ['knowledge', 'Knowledge'],
  ['toolUse', 'Tool-use'],
  ['longTasks', 'Long Tasks'],
] as const;
const groups = [
  'workspace',
  'projects',
  'memory',
  'search',
  'machine',
  'terminal',
  'matrix',
  'connections',
  'calendar',
  'reports',
];
const groupLabels: Record<string, string> = {
  workspace: 'Workspace',
  projects: 'Computer & project files',
  memory: 'Memory',
  search: 'Web search',
  machine: 'Machine tools',
  terminal: 'Terminal',
  matrix: 'Cognition Matrix',
  connections: 'Connections',
  calendar: 'Calendar',
  reports: 'Reports',
};
function ProfileStars({ value }: { value: number }) {
  return (
    <span
      className="profile-stars"
      aria-label={t('Agent Performance') + ' ' + value.toFixed(1) + ' / 5'}
    >
      <span aria-hidden="true">☆☆☆☆☆</span>
      <span
        className="profile-stars-fill"
        aria-hidden="true"
        style={{ width: (value / 5) * 100 + '%' }}
      >
        ★★★★★
      </span>
    </span>
  );
}
export default function AgentScreen({
  snapshot,
  onChanged,
  onError,
}: {
  snapshot: Snapshot;
  onChanged: () => Promise<void>;
  onError: (e: any) => void;
}) {
  const profiles = snapshot.entities.filter((e) => e.kind === 'agent-profile');
  const [list, setList] = useState(true),
    [id, setId] = useState(snapshot.settings.activeAgent),
    [draft, setDraft] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [accessOpen, setAccessOpen] = useState(false),
    [choicesOpen, setChoicesOpen] = useState<'categories' | 'skill' | 'connection' | null>(null);
  const profile = profiles.find((p) => p.id === id) ?? profiles[0];
  const draftBase = useRef<{ id: string; data: any } | null>(null);
  useEffect(() => {
    if (profile) {
      const next = { title: profile.title, ...profile.data, ratings: { ...profile.data.ratings } };
      const old = draftBase.current;
      setDraft((current: any) =>
        old?.id === profile.id && current
          ? {
              ...next,
              ...Object.fromEntries(
                Object.entries(current).filter(
                  ([key, value]) => JSON.stringify(value) !== JSON.stringify(old.data[key]),
                ),
              ),
            }
          : next,
      );
      draftBase.current = { id: profile.id, data: next };
    }
  }, [profile?.id, profile?.revision]);
  const act = async (input: any) => {
    setBusy(true);
    try {
      const value = await api.workspace(input);
      await onChanged();
      return value;
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const scope = (key: string, values: string[], value: string, checked: boolean) =>
    setDraft((d: any) => ({
      ...d,
      [key]: checked
        ? [...(d[key] ?? values).filter((v: string) => v !== value), value]
        : (d[key] ?? values).filter((v: string) => v !== value),
    }));
  if (list)
    return (
      <div className="page-pad agent-screen">
        <header className="agent-screen-heading">
          <div>
            <span className="eyebrow">{t('YOUR COMPANIONS')}</span>
            <h1>{t('Agent Profiles')}</h1>
            <p>{t('Different strengths. Your choice of companion.')}</p>
          </div>
          <button onClick={() => setList(false)}>{t('Back to agent')}</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void act({
                action: 'profile-save',
                title: t('New agent'),
                data: {
                  personality: snapshot.settings.personality,
                  systemPrompt: snapshot.settings.systemPrompt,
                  provider: snapshot.settings.provider,
                  model: snapshot.settings.model,
                  toolGroups: [],
                  skillIds: [],
                  connectionIds: [],
                  ratings: {},
                },
              }).then((e) => {
                if (e) {
                  setId(e.id);
                  setList(false);
                }
              })
            }
          >
            {t('Create agent profile')}
          </button>
        </header>
        <div className="agent-profile-grid">
          {profiles.map((p) => (
            <article key={p.id}>
              <img
                src={p.data.avatar ? art(p.data.avatar) : logoPath(snapshot.settings.logoIcon)}
                alt=""
              />
              <h2>{p.title}</h2>
              <small>
                {p.id === snapshot.settings.activeAgent
                  ? t('Default agent')
                  : p.data.model || t('Uses global model')}
              </small>
              <p>{p.data.personality?.slice(0, 120)}</p>
              <p>
                <ProfileStars value={p.data.performance ?? 0} />{' '}
                {(p.data.performance ?? 0).toFixed(1)}
              </p>
              <button
                onClick={() => {
                  setId(p.id);
                  setList(false);
                }}
              >
                {t('Edit profile')}
              </button>
              <button
                disabled={busy || p.id === snapshot.settings.activeAgent}
                onClick={() => void act({ action: 'profile-select', id: p.id })}
              >
                {t('Use this agent')}
              </button>
              <button
                className="danger"
                disabled={busy || profiles.length < 2}
                onClick={() => void act({ action: 'profile-delete', id: p.id })}
              >
                {t('Remove profile')}
              </button>
            </article>
          ))}
        </div>
      </div>
    );
  if (!draft || !profile) return <p className="page-pad">{t('Opening agent profiles…')}</p>;
  const performance = ratings.reduce((sum, [key]) => sum + (draft.ratings?.[key] ?? 0), 0) / 4;
  const choiceTitle =
    choicesOpen === 'categories'
      ? 'More tool categories'
      : choicesOpen === 'skill'
        ? 'Skills'
        : 'MCP servers';
  const choices: AgentChoice[] =
    choicesOpen === 'categories'
      ? groups
          .filter((g) => !['search', 'projects', 'calendar', 'reports'].includes(g))
          .map((g) => ({
            id: g,
            title: t(groupLabels[g]),
            checked: !draft.toolGroups || draft.toolGroups.includes(g),
            onChange: (checked) => scope('toolGroups', groups, g, checked),
          }))
      : snapshot.entities
          .filter((e) => e.kind === choicesOpen)
          .map((entity, _, entities) => {
            const key = choicesOpen === 'skill' ? 'skillIds' : 'connectionIds';
            return {
              id: entity.id,
              title: entity.title,
              checked:
                choicesOpen === 'skill' &&
                entity.data.creatorProfile &&
                entity.data.creatorProfile !== profile.id
                  ? !!draft[key]?.includes(entity.id)
                  : !draft[key] || draft[key].includes(entity.id),
              onChange: (checked) =>
                scope(
                  key,
                  entities
                    .filter(
                      (c) =>
                        choicesOpen !== 'skill' ||
                        !c.data.creatorProfile ||
                        c.data.creatorProfile === profile.id ||
                        draft[key]?.includes(c.id) ||
                        c.id === entity.id,
                    )
                    .map((c) => c.id),
                  entity.id,
                  checked,
                ),
            };
          });
  return (
    <div className="page-pad agent-screen agent-editor agent-balanced">
      <header className="agent-screen-heading">
        <div>
          <span className="eyebrow">{t('YOUR COMPANION')}</span>
          <h1>{t('Agent profile')}</h1>
          <p>{t('A name, a face, and a way of working together.')}</p>
        </div>
        <button onClick={() => setList(true)}>{t('Agent Profiles')}</button>
        <button aria-haspopup="dialog" onClick={() => setAccessOpen(true)}>
          {t('Resource access')}
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void act({
              action: 'profile-save',
              id: profile.id,
              revision: profile.revision,
              title: draft.title,
              data: Object.fromEntries(
                [
                  'avatar',
                  'personality',
                  'inheritModel',
                  'provider',
                  'model',
                  'toolGroups',
                  'skillIds',
                  'connectionIds',
                  'ratings',
                  'computerAccess',
                  'allowSkillCreation',
                ]
                  .map((key) => [key, draft[key]])
                  .filter(([, value]) => value !== undefined),
              ),
            })
          }
        >
          {t('Save profile')}
        </button>
      </header>
      <div className="agent-profile-layout">
        <div className="agent-profile-column agent-profile-left">
          <section className="agent-identity-card">
            <h2>{t('Agent identity')}</h2>
            <img
              src={draft.avatar ? art(draft.avatar) : logoPath(snapshot.settings.logoIcon)}
              alt={t('Agent profile')}
            />
            <button
              onClick={() =>
                void api
                  .image()
                  .then((src) => src && setDraft({ ...draft, avatar: src }))
                  .catch(onError)
              }
            >
              {t('Choose profile image ↗')}
            </button>
            <label>
              {t('Name')}
              <input
                aria-label={t('Agent name')}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
          </section>
          <section className="agent-config-card">
            <h2>{t('Default model')}</h2>
            <label className="setting-switch">
              <span>{t('Uses global model')}</span>
              <Switch
                checked={draft.inheritModel === true}
                onChange={(e) => setDraft({ ...draft, inheritModel: e.target.checked })}
              />
            </label>
            <label>
              {t('Provider')}
              <select
                data-tooltip={t('Provider addresses and credentials are managed in Settings.')}
                value={draft.provider ?? 'ollama'}
                onChange={(e) =>
                  setDraft({ ...draft, provider: e.target.value, inheritModel: false })
                }
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Model ID')}
              <input
                placeholder={t('Use provider model ID')}
                value={draft.model ?? ''}
                onChange={(e) => setDraft({ ...draft, model: e.target.value, inheritModel: false })}
              />
            </label>
            <ModelPicker
              manualEntry={false}
              settings={{
                ...snapshot.settings,
                provider: draft.provider ?? snapshot.settings.provider,
                model: draft.model ?? '',
              }}
              onUpdate={async ({ model }) => setDraft({ ...draft, model, inheritModel: false })}
              onError={onError}
            />
          </section>
        </div>
        <section className="agent-prompt-card">
          <h2>{t('System prompt')}</h2>
          <label>
            {t('Personality & preferences')}
            <textarea
              rows={12}
              aria-label={t('Personality & preferences')}
              value={draft.personality ?? ''}
              onChange={(e) => setDraft({ ...draft, personality: e.target.value })}
            />
          </label>
          <small className="internal-guidance">
            {t('Internal app instructions remain active.')}
          </small>
        </section>
        <div className="agent-profile-column agent-profile-right">
          <section className="agent-ratings-card">
            <h2>{t('Your ratings')}</h2>
            <p className="muted">{t('Your assessment, from 0 to 5 stars.')}</p>
            {ratings.map(([key, label]) => (
              <div className="star-rating" key={key}>
                <span>{t(label)}</span>
                <div role="group" aria-label={t(label)}>
                  <button
                    aria-label={t(label) + ' 0'}
                    title={t('Clear this rating')}
                    aria-pressed={!draft.ratings?.[key]}
                    onClick={() => setDraft({ ...draft, ratings: { ...draft.ratings, [key]: 0 } })}
                  >
                    0
                  </button>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      aria-label={t(label) + ' ' + v}
                      title={t(
                        (
                          {
                            intelligence: 'Your rating of the agent’s overall intelligence.',
                            knowledge:
                              'Your rating of training knowledge and accuracy with that information.',
                            toolUse:
                              'Your rating of reliable tool calls and correct tool arguments.',
                            longTasks:
                              'Your rating of staying on track through many steps and tool calls.',
                          } as Record<string, string>
                        )[key],
                      )}
                      aria-pressed={draft.ratings?.[key] === v}
                      onClick={() =>
                        setDraft({ ...draft, ratings: { ...draft.ratings, [key]: v } })
                      }
                    >
                      {v <= (draft.ratings?.[key] ?? 0) ? '★' : '☆'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="agent-performance">
              <b>{t('Agent Performance')}</b>
              <span>
                {performance.toFixed(1)} / 5 <ProfileStars value={performance} />
              </span>
              <small>{t('Average of your four ratings; calculated automatically.')}</small>
            </div>
          </section>
          <section className="agent-tools-card">
            <h2>{t('Tools and connections')}</h2>
            <label className="agent-computer-scope">
              {t('Computer access')}
              <select
                value={draft.computerAccess || 'inherit'}
                onChange={(e) => setDraft({ ...draft, computerAccess: e.target.value })}
              >
                <option value="inherit">{t('Use global computer access')}</option>
                <option value="projects">{t('Authorized project folders only')}</option>
              </select>
            </label>
            <div className="agent-common-tools">
              {['search', 'projects', 'calendar', 'reports'].map((g) => (
                <label className="setting-switch" data-tool-category={g} key={g}>
                  <span>{t(groupLabels[g])}</span>
                  <Switch
                    data-tooltip={t(
                      'Allow this agent to use this tool category within the access you granted in the app.',
                    )}
                    checked={!draft.toolGroups || draft.toolGroups.includes(g)}
                    onChange={(e) => scope('toolGroups', groups, g, e.target.checked)}
                  />
                </label>
              ))}
            </div>
            <div className="agent-tool-actions">
              {(['categories', 'skill', 'connection'] as const).map((kind) => (
                <button key={kind} aria-haspopup="dialog" onClick={() => setChoicesOpen(kind)}>
                  <span>
                    <Icon
                      name={
                        kind === 'categories' ? 'layers' : kind === 'skill' ? 'sparkles' : 'plug'
                      }
                    />
                    {t(
                      kind === 'categories'
                        ? 'More tool categories'
                        : kind === 'skill'
                          ? 'Skills'
                          : 'MCP servers',
                    )}
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
            <label className="setting-switch agent-skill-creation">
              <span>{t('Create reusable skills')}</span>
              <Switch
                checked={draft.allowSkillCreation !== false}
                onChange={(e) => setDraft({ ...draft, allowSkillCreation: e.target.checked })}
              />
            </label>
          </section>
        </div>
      </div>
      {choicesOpen && (
        <AgentChoicesDialog
          key={profile.id + choicesOpen}
          title={t(choiceTitle)}
          choices={choices}
          onClose={() => setChoicesOpen(null)}
        />
      )}
      {accessOpen && (
        <Modal
          title={t('Resource access')}
          className="agent-access-modal"
          onClose={() => setAccessOpen(false)}
        >
          <div className="agent-access-modal-body">
            <p className="muted">
              {t('Agent')}: {profile.title}
            </p>
            <AgentAccessPanel
              profileId={profile.id}
              snapshot={snapshot}
              onChanged={onChanged}
              onError={onError}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
