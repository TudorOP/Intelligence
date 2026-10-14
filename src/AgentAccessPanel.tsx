import { useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import Switch from './Switch';
import type { Snapshot } from './types';
import { resourceLabel } from '../electron/resource-catalog.mjs';
export default function AgentAccessPanel({
  snapshot,
  onChanged,
  onError,
}: {
  snapshot: Snapshot;
  onChanged: () => Promise<any>;
  onError: (e: any) => void;
}) {
  const profiles = snapshot.entities.filter((e) => e.kind === 'agent-profile');
  const [selected, setSelected] = useState(snapshot.settings.activeAgent),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const profile = profiles.find((e) => e.id === selected) || profiles[0];
  if (!profile) return null;
  const grants: { id: string; permission: string; fingerprint?: string }[] =
    profile.data.resourceGrants || [];
  const save = async (data: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.workspace({
        action: 'profile-save',
        id: profile.id,
        revision: profile.revision,
        data,
      });
      await onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const choices = snapshot.entities
    .filter(
      (e) =>
        [
          'notebook',
          'board',
          'project',
          'calendar',
          'vault-folder',
          'memory',
          'conversation',
        ].includes(e.kind) &&
        !e.parent &&
        !grants.some((g) => g.id === e.id) &&
        e.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .slice(0, 100);
  return (
    <section className="settings-card agent-grants">
      <h3>{t('Access for each agent')}</h3>
      <label>
        {t('Agent')}
        <select value={profile.id} onChange={(e) => setSelected(e.target.value)} disabled={busy}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('Resource policy')}
        <select
          disabled={busy}
          value={profile.data.resourcePolicy || 'shared'}
          onChange={(e) => void save({ resourcePolicy: e.target.value })}
        >
          <option value="shared">{t('Use resources already shared with agents')}</option>
          <option value="ask">{t('Selected resources only; ask when needed')}</option>
        </select>
      </label>
      <label className="setting-switch">
        <span>
          {t('Allow setup and access requests')}
          <small>
            {t(
              'The agent can propose changes or ask for exact resource access. Only your native approval applies them.',
            )}
          </small>
        </span>
        <Switch
          checked={profile.data.allowConfigurationRequests !== false}
          disabled={busy}
          onChange={(e) => void save({ allowConfigurationRequests: e.target.checked })}
        />
      </label>
      <p>
        {t(
          'Global switches and profile tool scopes still apply. Child exceptions, task assignment and host-command approvals stay separate.',
        )}
      </p>
      {grants.map((g) => (
        <div className="grant-row" key={g.id}>
          <span>
            {snapshot.entities.find((e) => e.id === g.id)?.title || t('Unavailable resource')}
            <small>{t(g.permission === 'edit' ? 'Read & edit' : 'Read')}</small>
          </span>
          <button
            disabled={busy}
            onClick={() => void save({ resourceGrants: grants.filter((p) => p.id !== g.id) })}
          >
            {t('Revoke')}
          </button>
        </div>
      ))}
      {!grants.length && <p>{t('No permanent resource grants for this agent.')}</p>}
      <label>
        {t('Grant read access to a selected resource')}
        <input
          aria-label={t('Find a resource')}
          placeholder={t('Find a resource')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value)
              void save({
                resourceGrants: [...grants, { id: e.target.value, permission: 'read' }],
              });
          }}
        >
          <option value="">{t('Choose a resource')}</option>
          {choices.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {t(resourceLabel(e.kind))}
            </option>
          ))}
        </select>
      </label>
      <small>
        {t(
          'To change read access to editing, approve an exact agent request or remove and reselect the grant during setup.',
        )}
      </small>
      {snapshot.temporaryAccess
        ?.filter((g) => g.profile === profile.id)
        .map((g) => (
          <div className="grant-row" key={g.conversation + g.resource}>
            <span>
              {snapshot.entities.find((e) => e.id === g.resource)?.title ||
                t('Unavailable resource')}
              <small>{t('Temporary — current request only')}</small>
            </span>
            <button
              onClick={() =>
                void api
                  .accessRevoke({ conversation: g.conversation, id: g.resource })
                  .then(onChanged)
                  .catch(onError)
              }
            >
              {t('Revoke')}
            </button>
          </div>
        ))}
    </section>
  );
}
