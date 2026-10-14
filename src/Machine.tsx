import { locale } from './i18n';
import { t } from './i18n';
import { useState } from 'react';
import type { Entity } from './types';
import ContainerView from './ContainerView';
import LogViewer from './LogViewer';
import ThemeArt from './ThemeArt';
export default function Machine({
  report,
  name,
  profile,
  onRefresh,
  onPrepare,
  onDisconnect,
  onShareLogs,
}: {
  report: any;
  name: string;
  profile: Entity | null;
  onRefresh: () => Promise<void>;
  onPrepare: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onShareLogs: (context: any) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState('overview'),
    [logTarget, setLogTarget] = useState<{ engine: string; id: string; name: string } | null>(null);
  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  if (!report)
    return (
      <div className="page-pad machine-page">
        <span className="eyebrow">{t('YOUR MACHINE')}</span>
        <h1>{name}</h1>
        <div className="empty-state">
          <span>⌘</span>
          <h2>{t('A clearer picture of your computer.')}</h2>
          <p>{t('Read the machine’s resources and available capabilities.')}</p>
          <button className="primary" onClick={() => void action(onRefresh)} disabled={busy}>
            {busy ? t('Inspecting…') : t('Inspect this machine')} ↗
          </button>
        </div>
      </div>
    );
  const total = report.memory.total,
    available = report.memory.available,
    usedPercent = Math.min(100, Math.max(0, (1 - available / Math.max(1, total)) * 100));
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1) + ' GB';
  const hours = Math.floor(report.uptime / 3600),
    uptime =
      hours >= 24
        ? Math.floor(hours / 24) + t(' days ') + (hours % 24) + t(' hours')
        : hours + t(' hours');
  const prepared =
    !!profile &&
    profile.data.ready &&
    profile.data.access &&
    profile.data.snapshot?.hostname === report.hostname;
  const families: Record<string, string> = {
    arch: t('Arch family'),
    debian: t('Debian / Ubuntu family'),
    fedora: t('Fedora family'),
    suse: t('SUSE family'),
    nixos: 'NixOS',
    other: 'Linux',
  };
  const family = families[report.distro.family] ?? report.osName;
  return (
    <div className="page-pad machine-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">{t('YOUR MACHINE, UNDERSTOOD')}</span>
          <h1>{report.displayName}</h1>
          <p>
            {report.osName} · {report.architecture} · {report.desktop}
            {report.session ? ' / ' + report.session : ''}
          </p>
        </div>
        <div className="heading-actions">
          <span className="readonly-pill">{t('◎ Read-only')}</span>
          <button onClick={() => void action(onRefresh)} disabled={busy}>
            {busy ? t('Inspecting…') : t('Refresh readings')} ↻
          </button>
        </div>
      </header>
      <div className="machine-tabs" role="group" aria-label={t('Machine section')}>
        <button
          className={section === 'overview' ? 'selected' : ''}
          aria-pressed={section === 'overview'}
          onClick={() => setSection('overview')}
        >
          {t('Overview')}
        </button>
        <button
          className={section === 'containers' ? 'selected' : ''}
          aria-pressed={section === 'containers'}
          onClick={() => setSection('containers')}
        >
          {t('Containers')}
        </button>
        <button
          className={section === 'logs' ? 'selected' : ''}
          aria-pressed={section === 'logs'}
          onClick={() => {
            setLogTarget(null);
            setSection('logs');
          }}
        >
          {t('Logs')}
        </button>
      </div>
      {section === 'containers' ? (
        <ContainerView
          onLogs={(engine, id, name) => {
            setLogTarget({ engine, id, name });
            setSection('logs');
          }}
        />
      ) : section === 'logs' ? (
        <LogViewer
          key={logTarget?.id ?? 'journal'}
          platform={report.platform}
          target={logTarget}
          onShare={onShareLogs}
        />
      ) : (
        <>
          <div className="machine-resource-layout">
            <div className="machine-left-column">
              <section className="machine-overview">
                <ThemeArt category={3} className="section-art" variant="banner" />
                <div>
                  <span className="eyebrow">{family}</span>
                  <h2>{report.cpu.model}</h2>
                  <p>
                    {report.cpu.threads} {t('processing threads · Up for')} {uptime}
                  </p>
                  <div className="machine-tags">
                    <span>
                      {t('Kernel')} {report.kernel}
                    </span>
                    {report.packageManager ? <span>{report.packageManager}</span> : null}
                    {report.gpuDrivers.map((driver: string) => (
                      <span key={driver}>{driver}</span>
                    ))}
                    {report.environment.container ? (
                      <span>{t('Container environment')}</span>
                    ) : null}
                  </div>
                </div>
              </section>
              <section className="machine-quick-actions">
                <h2>{t('Inspect your computer')}</h2>
                <p>
                  {t(
                    'Open a current inventory or select log entries to discuss with the assistant. Nothing changes on your machine.',
                  )}
                </p>
                <div>
                  <button onClick={() => setSection('containers')}>{t('Containers')}</button>
                  <button
                    onClick={() => {
                      setLogTarget(null);
                      setSection('logs');
                    }}
                  >
                    {t('Logs')}
                  </button>
                </div>
                <small>
                  {prepared
                    ? t('Your machine assistant is ready.')
                    : t('Prepare the assistant below to discuss these readings.')}
                </small>
              </section>
            </div>
            <div className="machine-readings">
              <section>
                <span className="eyebrow">{t('MEMORY')}</span>
                <h2>
                  {gb(available)} <small>{t('available')}</small>
                </h2>
                <div
                  className="resource-meter"
                  role="meter"
                  aria-label={t('Memory in use')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(usedPercent)}
                >
                  <span style={{ width: usedPercent + '%' }} />
                </div>
                <p>
                  {gb(total)} {t('total ·')} {Math.round(usedPercent)}
                  {t('% in use')}
                </p>
              </section>
              <section>
                <span className="eyebrow">{t('STORAGE')}</span>
                <h2>
                  {report.storage ? gb(report.storage.available) : t('Unavailable')}{' '}
                  {report.storage ? <small>{t('available')}</small> : null}
                </h2>
                {report.storage ? (
                  <>
                    <div
                      className="resource-meter"
                      role="meter"
                      aria-label={t('Filesystem space in use')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(
                        (1 - report.storage.available / Math.max(1, report.storage.total)) * 100,
                      )}
                    >
                      <span
                        style={{
                          width:
                            Math.max(
                              0,
                              Math.min(
                                100,
                                (1 - report.storage.available / Math.max(1, report.storage.total)) *
                                  100,
                              ),
                            ) + '%',
                        }}
                      />
                    </div>
                    <p>
                      {gb(report.storage.total)} {t('total · Home filesystem')}
                    </p>
                  </>
                ) : (
                  <p>{t('The host did not provide filesystem capacity.')}</p>
                )}
              </section>
              <section>
                <span className="eyebrow">{t('CONNECTIVITY')}</span>
                <h2>
                  {report.network.externalInterfaceCount} <small>{t('interface entries')}</small>
                </h2>
                <p>{report.network.manager}</p>
              </section>
            </div>
          </div>
          <details className="machine-capabilities">
            <summary>
              {t('Inspection capabilities')} ·{' '}
              {report.capabilities.filter((cap: any) => cap.available).length}/
              {report.capabilities.length}
            </summary>
            <div className="capability-checklist">
              {report.capabilities.map((cap: any) => (
                <article key={cap.id} className={!cap.available ? 'unavailable' : ''}>
                  <span aria-label={cap.available ? t('Available') : t('Limited')}>
                    {cap.available ? '✓' : '–'}
                  </span>
                  <div>
                    <b>{t(cap.title)}</b>
                    <small>
                      {t(cap.provider)} · {t(cap.detail)}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </details>
          <section className="machine-assistant-setup">
            <span className="machine-assistant-icon">✦</span>
            <div>
              <span className="eyebrow">
                {prepared ? t('READY TO THINK TOGETHER') : t('WHEN YOU WANT A HAND')}
              </span>
              <h2>
                {prepared
                  ? t('Your machine assistant is ready.')
                  : t('Give Intelligence the right context.')}
              </h2>
              <p>
                {t(
                  'Open a conversation with this machine profile and the supported inspection tools.',
                )}
              </p>
            </div>
            <div>
              <button className="primary" disabled={busy} onClick={() => void action(onPrepare)}>
                {busy
                  ? t('Preparing…')
                  : prepared
                    ? t('Open machine conversation')
                    : t('Prepare assistant')}{' '}
                ↗
              </button>
              {prepared ? (
                <button
                  className="quiet-button"
                  disabled={busy}
                  onClick={() => void action(onDisconnect)}
                >
                  {t('Disable machine tools')}
                </button>
              ) : null}
            </div>
          </section>
        </>
      )}
      <footer className="machine-footer">
        <span>
          {t('Readings captured')} {new Date(report.collectedAt).toLocaleTimeString(locale())}
        </span>
      </footer>
    </div>
  );
}
