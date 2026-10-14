import { locale } from './i18n';
import { t } from './i18n';
import { useState } from 'react';
import { api } from './api';
export default function ContainerView({
  onLogs,
}: {
  onLogs: (engine: string, id: string, name: string) => void;
}) {
  const [inventory, setInventory] = useState<any>(null),
    [engine, setEngine] = useState('docker'),
    [kind, setKind] = useState('containers'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('');
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setInventory(await api.containers());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selected = inventory?.engines.find((e: any) => e.engine === engine),
    section = selected?.sections[kind];
  const rows = (section?.items ?? []).filter((row: any) =>
    Object.values(row).join(' ').toLowerCase().includes(filter.toLowerCase()),
  );
  const columns: Record<string, [string, string][]> = {
    containers: [
      ['name', t('Container')],
      ['image', t('Image')],
      ['status', t('Status')],
      ['ports', t('Ports')],
    ],
    images: [
      ['repository', t('Image')],
      ['tag', t('Tag')],
      ['size', t('Size')],
      ['created', t('Created')],
    ],
    volumes: [
      ['name', t('Volume')],
      ['driver', t('Driver')],
      ['scope', t('Scope')],
    ],
    networks: [
      ['name', t('Network')],
      ['driver', t('Driver')],
      ['scope', t('Scope')],
    ],
  };
  const size = (value: any) =>
    typeof value === 'number' ? (value / 1024 ** 2).toFixed(1) + ' MB' : value || '—';
  return (
    <section className="machine-workloads">
      <header className="inspection-heading">
        <div>
          <span className="eyebrow">{t('CONTAINER ENVIRONMENT')}</span>
          <h2>{t('What’s running. What’s stored.')}</h2>
          <p>{t('Browse containers, images, volumes, and networks through Docker or Podman.')}</p>
        </div>
        <button className="primary" disabled={busy} onClick={() => void load()}>
          {busy
            ? t('Reading inventory…')
            : inventory
              ? t('Refresh inventory')
              : t('Load inventory')}{' '}
          ↻
        </button>
      </header>
      <div className="engine-picker" role="group" aria-label={t('Container engine')}>
        {['docker', 'podman'].map((name) => (
          <button
            key={name}
            aria-pressed={engine === name}
            className={engine === name ? 'selected' : ''}
            onClick={() => setEngine(name)}
          >
            <span>{name === 'docker' ? '◈' : '⌑'}</span>
            <b>{name === 'docker' ? 'Docker' : 'Podman'}</b>
            <small>
              {inventory
                ? inventory.supported === false
                  ? t('Available on Linux')
                  : inventory.engines.find((e: any) => e.engine === name)?.available
                    ? t('Readable')
                    : inventory.engines.find((e: any) => e.engine === name)?.installed
                      ? t('Connection unavailable')
                      : t('Not installed')
                : t('Not checked')}
            </small>
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="inspection-error">
          {t(error)}
        </p>
      ) : null}
      {!inventory ? (
        <div className="inspection-empty">
          <span>⌑</span>
          <h3>{t('A clear view of your containers.')}</h3>
          <p>
            {t('Load an inventory when you want to see containers, images, volumes, and networks.')}
          </p>
        </div>
      ) : inventory.supported === false ? (
        <div className="inspection-empty">
          <span>⌑</span>
          <h3>{t('Linux-only container integration.')}</h3>
          <p>{inventory.message}</p>
        </div>
      ) : !selected?.available ? (
        <div className="inspection-empty">
          <span>⌑</span>
          <h3>
            {selected?.installed
              ? t('This connection isn’t available.')
              : (engine === 'docker' ? 'Docker' : 'Podman') + t(' isn’t installed here.')}
          </h3>
          <p>{selected?.message}</p>
        </div>
      ) : (
        <>
          <div className="inventory-tabs" role="group" aria-label={t('Inventory category')}>
            {['containers', 'images', 'volumes', 'networks'].map((category) => (
              <button
                key={category}
                aria-pressed={kind === category}
                className={kind === category ? 'selected' : ''}
                onClick={() => setKind(category)}
              >
                {category[0].toUpperCase() + category.slice(1)}{' '}
                <small>
                  {selected.sections[category]?.available ? selected.sections[category].total : '—'}
                </small>
              </button>
            ))}
          </div>
          <div className="inventory-toolbar">
            <input
              aria-label={t('Filter container inventory')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('Find by name, image, driver…')}
            />
            <span>{selected.scope}</span>
          </div>
          {section?.available ? (
            <>
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      {columns[kind].map(([key, label]) => (
                        <th key={key}>{t(label)}</th>
                      ))}
                      {kind === 'containers' ? <th>{t('Logs')}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row: any, index: number) => (
                      <tr key={(row.id || row.name) + index}>
                        {columns[kind].map(([key]) => (
                          <td key={key}>
                            {key === 'size' ? size(row[key]) : String(row[key] || '—')}
                            {key === columns[kind][0][0] && row.id ? (
                              <small>{row.id.slice(0, 20)}</small>
                            ) : null}
                          </td>
                        ))}
                        {kind === 'containers' ? (
                          <td>
                            <button
                              onClick={() =>
                                onLogs(engine, row.id, row.name || row.id.slice(0, 12))
                              }
                            >
                              {t('View logs ↗')}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length ? (
                <p className="inventory-empty">
                  {filter
                    ? t('No matching items.')
                    : t('No ') + kind + t(' returned by this connection.')}
                </p>
              ) : null}
              {section.limited ? (
                <p className="muted">{t('Showing the first 500 items.')}</p>
              ) : null}
            </>
          ) : (
            <p className="inspection-error">
              {section?.message ?? t('This inventory section is unavailable.')}
            </p>
          )}
          <footer className="machine-footer">
            {t('Snapshot')} {new Date(inventory.collectedAt).toLocaleTimeString(locale())}{' '}
            {t('· Read-only listing')}
          </footer>
        </>
      )}
    </section>
  );
}
