import { t } from './i18n';
import { useState } from 'react';
import { api } from './api';
const levels: Record<string, string> = {
  '0': 'Emergency',
  '1': 'Alert',
  '2': 'Critical',
  '3': 'Error',
  '4': 'Warning',
  '5': 'Notice',
  '6': 'Info',
  '7': 'Debug',
};
export default function LogViewer({
  platform,
  target,
  onShare,
}: {
  platform: string;
  target: { engine: string; id: string; name: string } | null;
  onShare: (context: any) => Promise<void>;
}) {
  const [scope, setScope] = useState('user'),
    [since, setSince] = useState('1h'),
    [priority, setPriority] = useState('warning'),
    [limit, setLimit] = useState('100'),
    [unit, setUnit] = useState(''),
    [result, setResult] = useState<any>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [sharing, setSharing] = useState(false),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('');
  const load = async () => {
    setBusy(true);
    setError('');
    setSelected(new Set());
    try {
      setResult(
        await api.logs({
          source: target ? 'container' : 'journal',
          scope,
          since,
          priority,
          limit: Number(limit),
          ...(target ? { engine: target.engine, id: target.id } : { unit }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rows = (result?.entries ?? []).filter((row: any) =>
    (row.message + ' ' + row.unit).toLowerCase().includes(filter.toLowerCase()),
  );
  const chosen = (result?.entries ?? []).filter((row: any) => selected.has(row.id));
  const share = async () => {
    setSharing(true);
    setError('');
    try {
      const context = {
        source: result.sourceName,
        collectedAt: result.collectedAt,
        entries: chosen.map(({ timestamp, priority, unit, message, eventId }: any) => ({
          timestamp,
          priority,
          unit,
          message,
          eventId,
        })),
      };
      if (JSON.stringify(context).length > 30000)
        throw new Error(t('Choose fewer entries to keep the conversation context manageable.'));
      await onShare(context);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSharing(false);
    }
  };
  return (
    <section className="machine-logs">
      <header className="inspection-heading">
        <div>
          <span className="eyebrow">
            {target ? t('CONTAINER LOGS') : t('SYSTEM & SESSION LOGS')}
          </span>
          <h2>{target ? target.name : t('A little more context.')}</h2>
          <p>
            {t(
              'Choose a source and time window, then select entries to discuss with Intelligence.',
            )}
          </p>
        </div>
        <button className="primary" disabled={busy} onClick={() => void load()}>
          {busy ? t('Reading logs…') : result ? t('Refresh logs') : t('Load logs')} ↻
        </button>
      </header>
      <div className="log-filters">
        {!target ? (
          <label>
            {t('Source')}
            <select
              aria-label={t('Log source')}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="user">{t('User / session journal')}</option>
              <option value="system">{t('System journal')}</option>
            </select>
          </label>
        ) : (
          <div className="log-source-chip">
            {target.engine} · {target.id.slice(0, 12)}
          </div>
        )}
        <label>
          {t('Time window')}
          <select
            aria-label={t('Log time window')}
            value={since}
            onChange={(e) => setSince(e.target.value)}
          >
            <option value="15m">{t('Last 15 minutes')}</option>
            <option value="1h">{t('Last hour')}</option>
            <option value="24h">{t('Last 24 hours')}</option>
            <option value="boot">{target ? t('Container history') : t('Since boot')}</option>
          </select>
        </label>
        {!target ? (
          <label>
            {t('Level')}
            <select
              aria-label={t('Log level')}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="warning">{t('Warnings & errors')}</option>
              <option value="error">{t('Errors only')}</option>
              <option value="all">{t('All levels')}</option>
            </select>
          </label>
        ) : null}
        <label>
          {t('Entries')}
          <select
            aria-label={t('Log entry limit')}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          >
            {['50', '100', '200', '500'].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {!target && platform === 'linux' ? (
          <label className="unit-filter">
            {t('Service / unit (optional)')}
            <input
              aria-label={t('Log unit')}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. sshd.service"
            />
          </label>
        ) : null}
      </div>
      <p className="log-privacy">
        {t(
          'Common credential patterns are redacted, but logs can still contain private information. Only the entries you select are added to a chat; logs aren’t automatically indexed into memory.',
        )}
      </p>
      {error ? (
        <p role="alert" className="inspection-error">
          {t(error)}
        </p>
      ) : null}
      {!result ? (
        <div className="inspection-empty">
          <span>☷</span>
          <h3>{t('Load the context you need.')}</h3>
          <p>{t('Choose a source and load its recent entries.')}</p>
        </div>
      ) : !result.available ? (
        <div className="inspection-empty">
          <span>☷</span>
          <h3>{t('This source isn’t readable.')}</h3>
          <p>{result.message}</p>
        </div>
      ) : (
        <>
          <div className="log-toolbar">
            <label>
              <input
                type="checkbox"
                aria-label={t('Select visible log entries')}
                checked={rows.length > 0 && rows.every((r: any) => selected.has(r.id))}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelected((previous) => {
                    const next = new Set(previous);
                    rows.forEach((r: any) => (checked ? next.add(r.id) : next.delete(r.id)));
                    return next;
                  });
                }}
              />{' '}
              {t('Select visible')}
            </label>
            <input
              aria-label={t('Filter loaded logs')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('Find text in these entries…')}
            />
            <span>
              {result.entries.length} {t('entries')}
            </span>
          </div>
          <div className="log-list">
            {rows.map((row: any) => (
              <article className="log-entry" key={row.id}>
                <input
                  type="checkbox"
                  aria-label={t('Include log entry ') + row.id}
                  checked={selected.has(row.id)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelected((previous) => {
                      const next = new Set(previous);
                      checked ? next.add(row.id) : next.delete(row.id);
                      return next;
                    });
                  }}
                />
                <div>
                  <header>
                    <time>
                      {row.timestamp
                        ? new Date(row.timestamp).toLocaleString()
                        : t('Timestamp unavailable')}
                    </time>
                    <span className="log-level">{t(levels[row.priority] ?? row.priority)}</span>
                    <span>
                      {row.unit}
                      {row.eventId ? ' · ' + row.eventId : ''}
                    </span>
                  </header>
                  <pre>{row.message}</pre>
                </div>
              </article>
            ))}
          </div>
          {!rows.length ? (
            <p className="inventory-empty">
              {t('No entries match these filters. Try a broader time window or all levels.')}
            </p>
          ) : null}
          <footer className="log-share">
            <div>
              <b>
                {chosen.length} {t('selected')}
              </b>
              <small>
                {result.sourceName} {t('· Snapshot')}{' '}
                {new Date(result.collectedAt).toLocaleTimeString()}
              </small>
            </div>
            <button
              className="primary"
              disabled={!chosen.length || sharing}
              onClick={() => void share()}
            >
              {sharing ? t('Adding context…') : t('Discuss selected logs')} ↗
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
