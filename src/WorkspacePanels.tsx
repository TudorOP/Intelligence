import { useEffect, useState, useRef } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Entity, Snapshot } from './types';
import Switch from './Switch';
import ActionMenu from './ActionMenu';
function ChangePreview({ before, after }: { before: string; after: string }) {
  const [open, setOpen] = useState(false);
  const a = open ? before.slice(0, 64000).split('\n').slice(0, 500) : [],
    b = open ? after.slice(0, 64000).split('\n').slice(0, 500) : [];
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  let lastA = a.length,
    lastB = b.length;
  while (lastA > first && lastB > first && a[lastA - 1] === b[lastB - 1]) {
    lastA--;
    lastB--;
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('Preview changes')}</summary>
      {open ? (
        <>
          <p>
            {t('Removed lines are marked −; added lines are marked +. Large previews are bounded.')}
          </p>
          <pre className="line-diff">
            {a.slice(Math.max(0, first - 3), first).map((line, i) => (
              <span key={'context-' + i}>{'  ' + line + '\n'}</span>
            ))}
            {a.slice(first, lastA).map((line, i) => (
              <del key={'old-' + i}>{'− ' + line + '\n'}</del>
            ))}
            {b.slice(first, lastB).map((line, i) => (
              <ins key={'new-' + i}>{'+ ' + line + '\n'}</ins>
            ))}
            {b.slice(lastB, lastB + 3).map((line, i) => (
              <span key={'end-' + i}>{'  ' + line + '\n'}</span>
            ))}
          </pre>
        </>
      ) : null}
    </details>
  );
}
export function HistoryPanel({
  item,
  onChanged,
  onError,
}: {
  item: Entity;
  onChanged: () => void;
  onError: (e: any) => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) void api.workspace({ action: 'history', id: item.id }).then(setRows).catch(onError);
  }, [open, item.id, item.revision]);
  return (
    <details className="document-history" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('History & restore')}</summary>
      {open ? (
        <>
          <p>{t('Restoring creates a new revision and preserves access and relationships.')}</p>
          <select
            aria-label={t('Document revision')}
            value={selected?.revision ?? ''}
            onChange={(e) => setSelected(rows.find((v) => v.revision === Number(e.target.value)))}
          >
            <option value="">{t('Choose a revision')}</option>
            {rows.map((v) => (
              <option key={v.revision} value={v.revision}>
                {v.revision} · {new Date(v.updated).toLocaleString()} · {t(v.actor)}
              </option>
            ))}
          </select>
          {selected ? (
            <>
              <div className="diff-columns">
                <section>
                  <b>{t('Earlier content')}</b>
                  <pre>{selected.content}</pre>
                </section>
                <section>
                  <b>{t('Current content')}</b>
                  <pre>
                    {(
                      item.data.content ?? t('Open the document to inspect current content.')
                    ).slice(0, 64000)}
                  </pre>
                </section>
              </div>
              <button
                onClick={() =>
                  void api
                    .workspace({
                      action: 'restore',
                      id: item.id,
                      version: selected.revision,
                      revision: item.revision,
                    })
                    .then(() => {
                      setSelected(null);
                      onChanged();
                    })
                    .catch(onError)
                }
              >
                {t('Restore this revision')}
              </button>
            </>
          ) : null}
          {!rows.length ? <p>{t('No earlier revisions.')}</p> : null}
          {rows[0] ? (
            <button
              onClick={() =>
                void api
                  .workspace({
                    action: 'restore',
                    id: item.id,
                    version: rows[0].revision,
                    revision: item.revision,
                  })
                  .then(onChanged)
                  .catch(onError)
              }
            >
              {t('Undo last edit')}
            </button>
          ) : null}
        </>
      ) : null}
    </details>
  );
}
export function ActivityPanel({
  snapshot,
  onOpen,
  onClose,
  onError,
}: {
  snapshot: Snapshot;
  onOpen: (e: Entity) => void;
  onClose: () => void;
  onError: (e: any) => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [filter, setFilter] = useState('all'),
    [undo, setUndo] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0);
  const load = () =>
    void api
      .workspace({ action: 'activity' })
      .then((v) => {
        setRows(v);
        setOffset(80);
      })
      .catch(onError);
  useEffect(() => {
    load();
    return api.onEvent((e) => {
      if (['changed', 'done', 'approval', 'notice', 'report-ready'].includes(e.type)) load();
    });
  }, []);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(timer);
  }, [undo]);
  const remove = async (action: string, id?: string) => {
    setBusy(true);
    try {
      const result = await api.workspace({ action, id });
      setUndo(result);
      load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="activity-panel" aria-label={t('Activity')}>
      <header>
        <h2>{t('Activity')}</h2>
        <button onClick={onClose} aria-label={t('Close activity')}>
          ×
        </button>
      </header>
      <section className="current-work">
        <b>{t('Current work')}</b>
        {(snapshot.activeConversations || []).map((id) => {
          const item = snapshot.entities.find((e) => e.id === id);
          return (
            <button key={id} onClick={() => item && onOpen(item)}>
              {t('Responding')} · {item?.title || t('Conversation')}
            </button>
          );
        })}
        {snapshot.matrixPreparation && <p>{t('Preparing task model')}</p>}
        {(snapshot.approvals || []).map((a) => (
          <button
            key={a.id}
            onClick={() => {
              const item = snapshot.entities.find((e) => e.id === a.conversation);
              if (item) onOpen(item);
            }}
          >
            {t('Awaiting approval')} · {a.summary}
          </button>
        ))}
        {!snapshot.activeConversations?.length && !snapshot.matrixPreparation && (
          <small>
            {t(
              snapshot.settings.backgroundPaused
                ? 'Background AI is paused'
                : 'No active agent work',
            )}
          </small>
        )}
      </section>
      <div className="activity-history-heading">
        <h3>{t('History')}</h3>
        <button
          disabled={busy || !rows.length}
          title={t(
            'Clear all saved Activity history, including hidden entries. Tasks and approvals are preserved.',
          )}
          onClick={() => void remove('activity-clear')}
        >
          {t('Clear history')}
        </button>
      </div>
      <select
        aria-label={t('Activity filter')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="all">{t('All activity')}</option>
        <option value="approval">{t('Approvals')}</option>
        <option value="notice">{t('Errors')}</option>
        <option value="changed">{t('Changes')}</option>
      </select>
      {undo?.count > 0 && (
        <div className="activity-undo" role="status">
          <span>
            {undo.count} {t('entries removed')}
          </span>
          <button
            onClick={() =>
              void api
                .workspace({ action: 'activity-undo', token: undo.token })
                .then(() => {
                  setUndo(null);
                  load();
                })
                .catch(onError)
            }
          >
            {t('Undo')}
          </button>
        </div>
      )}
      {rows
        .filter((r) => filter === 'all' || r.type === filter)
        .map((r) => (
          <div className={'activity-row ' + (r.read ? 'read' : '')} key={r.id}>
            <button
              onClick={() => {
                void api.workspace({ action: 'read-activity', id: r.id });
                if (r.item) onOpen(r.item);
              }}
            >
              <b>
                {t(r.type)} · {r.summary}
              </b>
              <small>{new Date(r.created).toLocaleString()}</small>
              {!r.item && r.entity && <small>{t('Item no longer available')}</small>}
            </button>
            <ActionMenu label={t('Activity entry actions')}>
              <button onClick={() => void remove('activity-delete', r.id)}>
                {t('Delete entry')}
              </button>
            </ActionMenu>
          </div>
        ))}
      {!rows.length && <p className="activity-empty">{t('No activity yet.')}</p>}
      {rows.length >= 80 && (
        <button
          onClick={() =>
            void api
              .workspace({ action: 'activity', offset })
              .then((v) => {
                setRows((old) => [
                  ...old,
                  ...v.filter((r: any) => !old.some((o) => o.id === r.id)),
                ]);
                setOffset(offset + 80);
              })
              .catch(onError)
          }
        >
          {t('Load more')}
        </button>
      )}
    </aside>
  );
}
export function ProjectBrowser({
  project,
  focusRequest = 0,
  onError,
}: {
  project: Entity;
  focusRequest?: number;
  onError: (e: any) => void;
}) {
  const browser = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusRequest) return;
    browser.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
    browser.current?.focus({ preventScroll: true });
  }, [project.id, focusRequest]);
  const [folder, setFolder] = useState('.'),
    [entries, setEntries] = useState<any[]>([]),
    [offset, setOffset] = useState<number | null>(null),
    [file, setFile] = useState<any>(null),
    [draft, setDraft] = useState(''),
    [history, setHistory] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [fileError, setFileError] = useState(''),
    [externalPath, setExternalPath] = useState('');
  const list = async (at = 0) => {
    try {
      const v = await api.workspace({
        action: 'project-files',
        operation: 'list',
        project: project.id,
        path: folder,
        offset: at,
      });
      setEntries((old) => (at ? [...old, ...v.items] : v.items));
      setOffset(v.nextOffset);
    } catch (e) {
      onError(e);
    }
  };
  useEffect(() => {
    setFile(null);
    setHistory([]);
    void list();
  }, [project.id, folder]);
  const open = async (name: string) => {
    setBusy(true);
    setFileError('');
    setExternalPath('');
    try {
      let value: any,
        content = '',
        next: number | null = 0;
      const relative = (folder === '.' ? '' : folder + '/') + name;
      while (next !== null) {
        value = await api.workspace({
          action: 'project-files',
          operation: 'read',
          project: project.id,
          path: relative,
          offset: next,
        });
        content += value.content;
        next = value.nextOffset;
      }
      setFile({ ...value, path: relative, content });
      setDraft(content);
      setHistory([]);
    } catch (e) {
      setFileError((e as Error).message);
      setExternalPath((folder === '.' ? '' : folder + '/') + name);
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      ref={browser}
      className="project-browser"
      tabIndex={-1}
      aria-label={t('Project files')}
    >
      <header>
        <h2>
          {t('Project files')} · {project.title}
        </h2>
        <button onClick={() => void list()}>{t('Refresh')}</button>
      </header>
      {fileError ? (
        <p role="status">
          {t(fileError)}{' '}
          <button
            disabled={busy}
            onClick={() =>
              void api
                .workspace({ action: 'project-open', project: project.id, path: externalPath })
                .catch(onError)
            }
          >
            {t('Open in default app')}
          </button>
        </p>
      ) : null}
      <div className="project-browser-layout">
        <aside>
          <button
            disabled={folder === '.'}
            onClick={() => setFolder(folder.split('/').slice(0, -1).join('/') || '.')}
          >
            {t('Up one folder')}
          </button>
          <small>{folder}</small>
          {entries.map((e) => (
            <button
              disabled={e.symlink || busy}
              key={e.name}
              onClick={() =>
                e.directory
                  ? setFolder((folder === '.' ? '' : folder + '/') + e.name)
                  : void open(e.name)
              }
            >
              {e.directory ? '▸ ' : '▧ '}
              {e.name}
            </button>
          ))}
          {offset !== null ? (
            <button onClick={() => void list(offset)}>{t('Load more')}</button>
          ) : null}
        </aside>
        <div>
          {file ? (
            <>
              <header>
                <b>{file.path}</b>
                <button
                  disabled={busy || draft === file.content}
                  onClick={() => {
                    setBusy(true);
                    void api
                      .workspace({
                        action: 'project-files',
                        operation: 'write',
                        project: project.id,
                        path: file.path,
                        content: draft,
                        revision: file.revision,
                      })
                      .then((v) => setFile({ ...file, content: draft, revision: v.revision }))
                      .catch(onError)
                      .finally(() => setBusy(false));
                  }}
                >
                  {t('Save file')}
                </button>
                <button
                  onClick={() =>
                    void api
                      .workspace({
                        action: 'project-files',
                        operation: 'history',
                        project: project.id,
                        path: file.path,
                      })
                      .then(setHistory)
                      .catch(onError)
                  }
                >
                  {t('History')}
                </button>
              </header>
              <textarea
                className="project-text-editor"
                aria-label={t('Project file content')}
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <ChangePreview before={file.content} after={draft} />
              {history.map((v) => (
                <details key={v.path}>
                  <summary>{new Date(v.time).toLocaleString()}</summary>
                  <pre>{v.content}</pre>
                  <button
                    onClick={() =>
                      void api
                        .workspace({
                          action: 'project-files',
                          operation: 'restore-version',
                          project: project.id,
                          path: file.path,
                          versionPath: v.path,
                          revision: file.revision,
                        })
                        .then(() => open(file.path.split('/').at(-1)))
                        .catch(onError)
                    }
                  >
                    {t('Restore this revision')}
                  </button>
                </details>
              ))}
            </>
          ) : (
            <p>{t('Choose a text file to inspect or edit. Files stay on your machine.')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
export function BulkBar({
  items,
  all,
  onDone,
  onError,
}: {
  items: Entity[];
  all: Entity[];
  onDone: () => void;
  onError: (e: any) => void;
}) {
  const [parent, setParent] = useState(''),
    [busy, setBusy] = useState(false);
  const canMove = items.every((e) =>
    ['note', 'chapter', 'card', 'vault-file', 'vault-folder'].includes(e.kind),
  );
  const act = async (operation: string) => {
    setBusy(true);
    try {
      const result = await api.workspace({
        action: 'bulk',
        operation,
        parent,
        items: items.map((e) => ({ id: e.id, revision: e.revision })),
      });
      if (operation === 'export') {
        const blob = new Blob(
            [
              JSON.stringify(
                { format: 'Intelligence collection export', version: 1, items: result },
                null,
                2,
              ),
            ],
            { type: 'application/json' },
          ),
          url = URL.createObjectURL(blob),
          a = document.createElement('a');
        a.href = url;
        a.download = 'Intelligence-collection.json';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const failures = result.filter((e: any) => !e.ok);
        if (failures.length) throw Error(failures.map((e: any) => e.error).join('\n'));
      }
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bulk-bar" role="toolbar" aria-label={t('Selected item actions')}>
      <b>
        {items.length} {t('selected')}
      </b>
      {canMove && (
        <>
          <select
            aria-label={t('Bulk move destination')}
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">{t('Choose destination')}</option>
            {all
              .filter(
                (e) =>
                  ['notebook', 'chapter', 'list', 'vault-folder'].includes(e.kind) &&
                  !items.some((v) => v.id === e.id) &&
                  items.every((v) =>
                    v.kind.startsWith('vault-')
                      ? e.kind === 'vault-folder'
                      : v.kind === 'card'
                        ? e.kind === 'list'
                        : v.kind === 'note'
                          ? ['notebook', 'chapter'].includes(e.kind)
                          : v.kind === 'chapter' && e.kind === 'notebook',
                  ),
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
          <button disabled={busy || !parent} onClick={() => void act('move')}>
            {t('Move')}
          </button>
        </>
      )}
      <button
        disabled={busy}
        title={t(
          'Exports selected app records as JSON. Complete backup and notebook export include media.',
        )}
        onClick={() => void act('export')}
      >
        {t(items.every((e) => e.kind === 'conversation') ? 'Export records' : 'Export')}
      </button>
      <button disabled={busy} className="danger" onClick={() => void act('trash')}>
        {t('Move to Trash')}
      </button>
      <button onClick={onDone}>{t('Clear selection')}</button>
    </div>
  );
}
export function BackupPanel({
  onChanged,
  onError,
}: {
  onChanged: () => void;
  onError: (e: any) => void;
}) {
  const [includeModelCaches, setIncludeModelCaches] = useState(true),
    [includeModules, setIncludeModules] = useState(true);
  const [preview, setPreview] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const act = async (action: string) => {
    setBusy(true);
    try {
      const v = await api.workspace({
        action,
        includeModelCaches,
        includeModules,
        ...(action === 'backup-restore' ? { directory: preview.directory } : {}),
      });
      if (v) {
        if (action === 'backup-preview') setPreview(v);
        else {
          setResult(v);
          setPreview(null);
          onChanged();
        }
      }
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="backup-panel settings-card">
      <h3>{t('Backup & restore')}</h3>
      {busy ? <p role="status">{t('Verifying and copying backup data…')}</p> : null}
      <p>
        {t(
          'Back up documents, conversations, profiles, tasks, metadata and managed images. Credentials and external project files are excluded; model caches are optional.',
        )}
      </p>
      <button disabled={busy} onClick={() => void act('backup-create')}>
        {t('Create complete backup')}
      </button>
      <label className="setting-switch">
        <span>
          {t('Include installed optional modules')}
          <small>
            {t(
              'Includes engines, dependencies and license notices. With model caches included, compatible local modules reconnect offline after verification.',
            )}
          </small>
        </span>
        <Switch checked={includeModules} onChange={(e) => setIncludeModules(e.target.checked)} />
      </label>
      <label className="setting-switch">
        <span>
          {t('Include downloaded model caches')}
          <small>
            {t(
              'Optional; increases backup size. Credentials and external project files remain excluded.',
            )}
          </small>
        </span>
        <Switch
          checked={includeModelCaches}
          onChange={(e) => setIncludeModelCaches(e.target.checked)}
        />
      </label>
      <button disabled={busy} onClick={() => void act('backup-preview')}>
        {t('Preview a backup')}
      </button>
      {preview ? (
        <div>
          <b>{t('Restore preview')}</b>
          <p>
            {preview.files} {t('files')} · {(preview.bytes / 1024 / 1024).toFixed(1)} MiB ·{' '}
            {new Date(preview.created).toLocaleString()}
          </p>
          {(preview.offlineModules || []).map((module: any) => (
            <p key={module.id}>
              <b>{module.id.toUpperCase()}</b> ·{' '}
              {t(
                module.status === 'ready'
                  ? 'Offline artifacts verified · Linux x64'
                  : module.status === 'remote'
                    ? 'Remote APIs require a connection and credentials'
                    : 'Offline restoration needs attention',
              )}
              {module.missing?.length ? ' · ' + module.missing.map(t).join(', ') : ''}
              {module.archiveDirectory
                ? ' · ' +
                  t('External ZIM directory must be available') +
                  ': ' +
                  module.archiveDirectory
                : ''}
            </p>
          ))}
          <p>
            {t(
              'External project folders, ZIM archives and models managed by other apps are not included.',
            )}
          </p>
          {preview.counts.map((v: any) => (
            <p key={v.kind}>
              {t(v.kind)}: {v.count}
            </p>
          ))}
          <p>
            {t(
              'Restore replaces app work and settings. A recovery copy is saved first. Background AI remains paused afterward; external project files are retained.',
            )}
          </p>
          <button className="primary" disabled={busy} onClick={() => void act('backup-restore')}>
            {t('Restore verified backup')}
          </button>
          <button onClick={() => setPreview(null)}>{t('Cancel')}</button>
        </div>
      ) : null}
      {result ? (
        <p role="status">
          {t(
            result.restored
              ? 'Backup restored. Review your work before resuming background AI.'
              : 'Backup created.',
          )}
          <small>{result.directory ?? result.recovery}</small>
        </p>
      ) : null}
      {result?.moduleRestore?.offlineReady?.length ? (
        <p role="status">
          {t('Local modules reconnected offline')}: {result.moduleRestore.offlineReady.join(', ')}
        </p>
      ) : null}
      {result?.moduleRestore?.attention?.map((item: any) => (
        <p key={item.id} role="status">
          {item.id}: {t(item.error)}
        </p>
      ))}
    </section>
  );
}
export function AutomationPanel({
  snapshot,
  onSettings,
  onError,
}: {
  snapshot: Snapshot;
  onSettings: (v: any) => Promise<any>;
  onError: (e: any) => void;
}) {
  const [info, setInfo] = useState<any>(null),
    [token, setToken] = useState(''),
    [port, setPort] = useState(String(snapshot.settings.externalEventsPort)),
    [portError, setPortError] = useState(''),
    [savingPort, setSavingPort] = useState(false);
  useEffect(() => {
    setPort(String(snapshot.settings.externalEventsPort));
  }, [snapshot.settings.externalEventsPort]);
  const savePort = async () => {
    if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
      setPortError(t('Enter a whole number from 1024 to 65535.'));
      return;
    }
    setPortError('');
    setSavingPort(true);
    try {
      await onSettings({ externalEventsPort: Number(port) });
    } catch (e) {
      onError(e);
    } finally {
      setSavingPort(false);
    }
  };
  useEffect(() => {
    void api.workspace({ action: 'automation-info' }).then(setInfo).catch(onError);
  }, [snapshot.settings.externalEventsPort]);
  return (
    <section className="automation-panel settings-card">
      <h3>{t('Optional event sources')}</h3>
      <label className="setting-switch">
        <span>{t('Local external events')}</span>
        <Switch
          checked={snapshot.settings.externalEventsEnabled}
          onChange={(e) => void onSettings({ externalEventsEnabled: e.target.checked })}
        />
      </label>
      <label className="event-port-field">
        {t('Event port')}
        <input
          aria-label={t('Event port')}
          aria-describedby="event-port-help"
          aria-invalid={!!portError}
          type="number"
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => {
            setPort(e.target.value);
            setPortError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void savePort();
            }
          }}
        />
      </label>
      <p id="event-port-help" className="settings-help settings-visually-hidden">
        {t(
          'The port is the connection number used by the other program. Keep 30091 unless it is already in use. Changing it also means updating the address in that program.',
        )}
      </p>
      {portError && <p role="alert">{portError}</p>}
      <button
        disabled={savingPort || port === String(snapshot.settings.externalEventsPort)}
        onClick={() => void savePort()}
      >
        {t('Save event port')}
      </button>
      {info ? <small>{info.eventUrl}</small> : null}
      <details className="event-connection-help">
        <summary>{t('How to connect another program')}</summary>
        <ol>
          <li>
            {t(
              'In a Matrix task, open Schedule & triggers, choose An external event arrives and set a channel name, such as reminder.',
            )}
          </li>
          <li>
            {t(
              'Enable Local external events here, and enable integration and agent access for that task.',
            )}
          </li>
          <li>
            {t(
              'In the other program, send an HTTP POST to the address shown here, replacing CHANNEL with your channel name. Set the Authorization header to Bearer followed by a space and your event token. The request body can be empty.',
            )}
          </li>
        </ol>
        <p>
          {t(
            'The address works only on this computer while Intelligence is open and background AI is running. Keep your event token private.',
          )}
        </p>
      </details>
      <button
        onClick={() =>
          void api
            .workspace({ action: 'automation-info', reveal: true })
            .then((v) => setToken(v.token))
            .catch(onError)
        }
      >
        {t('Reveal event token')}
      </button>
      {token ? <input readOnly aria-label={t('Event token')} value={token} /> : null}
      <label className="setting-switch">
        <span>{t('Wake laptop for tasks')}</span>
        <Switch
          disabled={!info?.wake.available}
          checked={snapshot.settings.wakeForTasks}
          onChange={(e) => void onSettings({ wakeForTasks: e.target.checked })}
        />
      </label>
      {info?.wake.reason ? <small>{t(info.wake.reason)}</small> : null}
    </section>
  );
}
