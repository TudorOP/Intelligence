import Switch from './Switch';
import { t } from './i18n';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { Settings, Snapshot } from './types';

export default function SearchSettings({
  snapshot,
  onUpdate,
  onError,
}: {
  snapshot: Snapshot;
  onUpdate: (value: Partial<Settings>) => Promise<boolean>;
  onError: (error: any) => void;
}) {
  const settings = snapshot.settings;
  const providers = snapshot.search?.providers ?? [
    {
      id: 'searxng',
      name: 'SearXNG',
      description: t('Use your own search instance.'),
      credential: false,
    },
    {
      id: 'brave',
      name: 'Brave Search',
      description: t('Search Brave’s independent index.'),
      credential: true,
    },
    {
      id: 'duckduckgo',
      name: 'DuckDuckGo',
      description: t(
        'Uses the DuckDuckGo engine on your SearXNG instance; this is not a direct DuckDuckGo connection.',
      ),
      credential: false,
    },
    {
      id: 'ecosia',
      name: 'Ecosia',
      description: t(
        'Uses the Ecosia engine on your SearXNG instance; a custom engine may be needed. This is not a direct Ecosia connection.',
      ),
      credential: false,
    },
  ];
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);
  const selected = selectedOverride ?? settings.searchProvider;
  const provider = providers.find((p) => p.id === selected);
  useEffect(() => {
    if (selectedOverride === settings.searchProvider) setSelectedOverride(null);
  }, [selectedOverride, settings.searchProvider]);
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(''),
    [test, setTest] = useState<any>(null),
    [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (enabled === settings.searchEnabled) setEnabled(null);
  }, [settings.searchEnabled, enabled]);
  const work = async (fn: () => Promise<any>) => {
    setBusy(true);
    setNote('');
    try {
      await fn();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const credential = snapshot.search?.braveKey;
  return (
    <section className="settings-section search-settings">
      <span className="eyebrow">{t('WEB SEARCH')}</span>
      <h2>{t('Search providers')}</h2>
      <p>
        {t(
          'Choose a provider for research across chats, notebooks, task boards, and Cognition Matrix.',
        )}
      </p>
      <div className="settings-grid">
        <section className="settings-card">
          <h3>{t('Search connection')}</h3>
          <label className="setting-switch">
            <span>{t('Enable web search')}</span>
            <Switch
              aria-label={t('Enable web search')}
              checked={enabled ?? settings.searchEnabled}
              onChange={(e) => {
                const value = e.target.checked;
                setEnabled(value);
                void onUpdate({ searchEnabled: value }).then((saved) => {
                  if (!saved) setEnabled(null);
                });
              }}
            />
          </label>
          <label>
            {t('Provider')}
            <select
              aria-label={t('Search provider')}
              value={selected}
              onChange={(e) => {
                setTest(null);
                setNote('');
                const value = e.target.value;
                setSelectedOverride(value);
                void onUpdate({ searchProvider: value }).then((saved) => {
                  if (!saved) setSelectedOverride(null);
                });
              }}
            >
              {providers.map((p) => (
                <option value={p.id} key={p.id}>
                  {t(p.name)}
                </option>
              ))}
            </select>
          </label>
          <small>{provider?.description ? t(provider.description) : ''}</small>
          {selected !== 'brave' ? (
            <>
              <label>
                {t('SearXNG address')}
                <input
                  aria-label={t('SearXNG address')}
                  type="url"
                  key={selected}
                  defaultValue={settings.searxngEndpoint}
                  placeholder="http://127.0.0.1:8080"
                  onBlur={(e) => void onUpdate({ searxngEndpoint: e.target.value.trim() })}
                />
              </label>
              <small>{t('Enable JSON results in your instance’s search formats.')}</small>
            </>
          ) : provider?.credential ? (
            <>
              <p>{t('Brave requires an account, an activated plan, and an API key.')}</p>
              <label>
                {t('API key')}
                <input
                  type="password"
                  autoComplete="new-password"
                  aria-label={t('Brave API key')}
                  value={key}
                  placeholder={
                    credential?.configured ? t('Replace saved key…') : t('Enter your API key…')
                  }
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <div className="search-key-actions">
                <button
                  disabled={busy || !key.trim() || !snapshot.desktop}
                  onClick={() =>
                    void work(async () => {
                      const status = await api.searchProvider({
                        action: 'save-key',
                        key: key.trim(),
                      });
                      setKey('');
                      setNote(
                        status.storage === 'keyring'
                          ? t('Key saved with the system keyring.')
                          : t(
                              'Key saved for this session. Save it again after restarting Intelligence.',
                            ),
                      );
                    })
                  }
                >
                  {t('Save key')}
                </button>
                <button
                  disabled={busy || !credential?.configured || !snapshot.desktop}
                  onClick={() =>
                    void work(async () => {
                      await api.searchProvider({ action: 'forget-key' });
                      setNote(t('Key removed.'));
                    })
                  }
                >
                  {t('Remove key')}
                </button>
                <button
                  disabled={busy || !snapshot.desktop}
                  onClick={() =>
                    void work(() =>
                      api.searchProvider({ action: 'open-setup', provider: selected }),
                    )
                  }
                >
                  {t('Get a key ↗')}
                </button>
              </div>
              <small>
                {credential?.configured
                  ? `Key configured · ${credential.storage === 'keyring' ? t('System keyring') : t('Current session')}`
                  : t('Add a key to use this provider.')}
              </small>
            </>
          ) : null}
        </section>
        <section className="settings-card">
          <h3>{t('Research limits')}</h3>
          <div className="matrix-settings-grid">
            <label>
              {t('Results per search')}
              <input
                type="number"
                min={1}
                max={20}
                aria-label={t('Search result count')}
                defaultValue={settings.searchMaxResults}
                onBlur={(e) => void onUpdate({ searchMaxResults: Number(e.target.value) })}
              />
            </label>
            <label>
              {t('Request timeout (seconds)')}
              <input
                type="number"
                min={1}
                max={120}
                aria-label={t('Search timeout')}
                defaultValue={settings.searchTimeoutSeconds}
                onBlur={(e) => void onUpdate({ searchTimeoutSeconds: Number(e.target.value) })}
              />
            </label>
          </div>
          <button
            disabled={
              busy ||
              !snapshot.desktop ||
              !(enabled ?? settings.searchEnabled) ||
              (selected === 'searxng' ? !settings.searxngEndpoint : !credential?.configured)
            }
            onClick={() =>
              void work(async () => {
                const result = await api.searchProvider({ action: 'test' });
                setTest(result);
                setNote(`${provider?.name}: connection ready · ${result.results.length} results`);
              })
            }
          >
            {busy ? t('Checking…') : t('Test provider')}
          </button>
          <small>{t('Test provider sends one query through the selected provider.')}</small>
          {note ? (
            <p className="search-provider-note" role="status">
              {note}
            </p>
          ) : null}
          {test ? (
            <div className="search-test-results">
              {test.results.slice(0, 3).map((result: any) => (
                <div key={result.url}>
                  <b>{result.title}</b>
                  <small>{result.url}</small>
                  <p>{result.snippet}</p>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
