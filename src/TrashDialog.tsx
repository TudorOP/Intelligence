import { t } from './i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { Entity } from './types';

export default function TrashDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Entity[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<Entity | null>(null);
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [bulkPending, setBulkPending] = useState<Entity[] | null>(null);
  const anchor = useRef<string | null>(null);
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const pageSize = 60;
  const group = (item: Entity) =>
    item.kind === 'conversation'
      ? 'conversations'
      : item.kind === 'project'
        ? 'projects'
        : item.kind.startsWith('vault-') ||
            ['notebook', 'chapter', 'note', 'matrix-file'].includes(item.kind)
          ? 'files'
          : 'other';
  const index = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const children = new Map<string, string[]>();
    const counts: Record<string, number> = { all: items.length };
    for (const item of items) {
      const category = group(item);
      counts[category] = (counts[category] ?? 0) + 1;
      if (item.parent) {
        const siblings = children.get(item.parent) ?? [];
        siblings.push(item.id);
        children.set(item.parent, siblings);
      }
    }
    return { byId, children, counts };
  }, [items]);
  const shown = useMemo(
    () =>
      items.filter(
        (item) =>
          (category === 'all' || group(item) === category) &&
          item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [items, category, query],
  );
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = shown.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => {
    list.current?.scrollTo(0, 0);
  }, [currentPage, category, query]);
  useEffect(() => {
    let mounted = true;
    api
      .trash()
      .then((items) => {
        if (mounted) setItems(items);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const act = async (item: Entity, remove: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (remove) {
        const result = await api.deleteTrash(item.id);
        if (result.retainedAssets)
          setError(t('Items deleted. Some attachments could not be removed from storage.'));
      } else await api.mutate({ id: item.id, action: 'restore' });
      setItems(await api.trash());
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const select = (id: string, range = false) => {
    setSelected((old) => {
      const next = new Set(old),
        a = shown.findIndex((e) => e.id === anchor.current),
        b = shown.findIndex((e) => e.id === id);
      if (range && a >= 0)
        shown.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((e) => next.add(e.id));
      else next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    anchor.current = id;
  };
  const affected = (targets: Entity[]) => {
    const all = new Set(targets.map((e) => e.id)),
      queue = [...all];
    while (queue.length) {
      for (const child of index.children.get(queue.pop()!) ?? [])
        if (!all.has(child)) {
          all.add(child);
          queue.push(child);
        }
    }
    return all.size;
  };
  const removeBulk = async () => {
    if (busy || !bulkPending) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.deleteTrash(bulkPending.map((e) => e.id));
      setItems(await api.trash());
      setSelected(new Set());
      setBulkPending(null);
      if (result.failed?.length) setError(result.failed.map((e) => e.error).join(' · '));
      else if (result.retainedAssets)
        setError(t('Items deleted. Some attachments could not be removed from storage.'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const containedCount = useMemo(() => {
    if (!pending) return 0;
    const visited = new Set([pending.id]),
      queue = [...(index.children.get(pending.id) ?? [])];
    while (queue.length) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(...(index.children.get(id) ?? []));
    }
    return visited.size - 1;
  }, [pending, index]);
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        className="trash-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trash-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (!busy) bulkPending ? setBulkPending(null) : pending ? setPending(null) : onClose();
          }
        }}
      >
        <header>
          <h2 id="trash-title">{pending ? t('Delete permanently?') : t('Trash')}</h2>
          <button
            className="icon-button"
            aria-label={t('Close Trash')}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {error ? (
          <p className="inspection-error" role="alert">
            {t(error)}
          </p>
        ) : null}
        {bulkPending ? (
          <>
            <p>
              {t('Permanently delete')} {affected(bulkPending)} {t('items')}?
            </p>
            <p>
              {t(
                'Permanent deletion cannot be undone. Shared images and external project files are kept.',
              )}
            </p>
            <footer>
              <button autoFocus disabled={busy} onClick={() => setBulkPending(null)}>
                {t('Cancel')}
              </button>
              <button className="danger" disabled={busy} onClick={() => void removeBulk()}>
                {busy ? t('Deleting…') : t('Delete permanently')}
              </button>
            </footer>
          </>
        ) : pending ? (
          <>
            <p>
              {t('Delete “')}
              {pending.title}”
              {containedCount ? ` ${t('and its')} ${containedCount} ${t('contained items')}` : ''}{' '}
              {t('from Intelligence?')}
            </p>
            <p>
              {t(
                'This removes their saved revisions, conversation messages, and memories generated from those sources. Images still used elsewhere are kept. Permanent deletion cannot be undone.',
              )}
            </p>
            <footer>
              <button autoFocus disabled={busy} onClick={() => setPending(null)}>
                {t('Cancel')}
              </button>
              <button className="danger" disabled={busy} onClick={() => void act(pending, true)}>
                {busy ? t('Deleting…') : t('Delete permanently')}
              </button>
            </footer>
          </>
        ) : loading ? (
          <p role="status">{t('Loading Trash…')}</p>
        ) : (
          <>
            <p>{t('Restore an item or delete it permanently.')}</p>
            <div className="trash-bulk-actions">
              <button
                disabled={busy || !items.length}
                className="danger"
                onClick={() => setBulkPending(items)}
              >
                {t('Empty Trash')} · {items.length}
              </button>
              <button
                disabled={busy || !selected.size}
                onClick={() => setBulkPending(items.filter((e) => selected.has(e.id)))}
              >
                {t('Delete selected')} · {selected.size}
              </button>
              <button
                disabled={busy || !shown.length}
                onClick={() => setSelected(new Set(shown.map((e) => e.id)))}
              >
                {t('Select results')}
              </button>
              {selected.size ? (
                <button onClick={() => setSelected(new Set())}>{t('Clear selection')}</button>
              ) : null}
            </div>
            <div className="trash-tabs" role="group" aria-label={t('Trash categories')}>
              {[
                ['all', t('All')],
                ['files', t('Files')],
                ['conversations', t('Conversations')],
                ['projects', t('Projects')],
                ['other', t('Other')],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={category === id}
                  className={category === id ? 'selected' : ''}
                  onClick={() => {
                    setCategory(id);
                    setPage(0);
                  }}
                >
                  {t(label)} <small>{index.counts[id] ?? 0}</small>
                </button>
              ))}
            </div>
            <input
              className="trash-search"
              aria-label={t('Search Trash')}
              placeholder={t('Search Trash')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <div className="trash-list" ref={list}>
              {visible.map((item) => {
                const parent = item.parent ? index.byId.get(item.parent) : undefined;
                return (
                  <div
                    key={item.id}
                    className={selected.has(item.id) ? 'trash-item-selected' : ''}
                    onClick={(e) => {
                      if (e.target instanceof HTMLElement && e.target.closest('button,input'))
                        return;
                      if (e.ctrlKey || e.metaKey || e.shiftKey) select(item.id, e.shiftKey);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      disabled={busy}
                      aria-label={t('Select') + ' ' + item.title}
                      onClick={(e) => {
                        e.stopPropagation();
                        select(item.id, e.shiftKey);
                      }}
                      onChange={() => {}}
                    />
                    <span>
                      {item.title}
                      <small>
                        {t(
                          (
                            {
                              'vault-file': 'Markdown file',
                              'vault-folder': 'Folder',
                              note: 'New note',
                              notebook: 'Notebooks',
                              chapter: 'New chapter',
                              conversation: 'Conversations',
                              project: 'Projects',
                              'matrix-file': 'Attachment',
                              card: 'Tasks',
                              board: 'Task board',
                              list: 'Tasks',
                              memory: 'Memory',
                              skill: 'Skills',
                              connection: 'Connections',
                            } as Record<string, string>
                          )[item.kind] ?? item.kind,
                        )}
                        {parent ? t(' · In ') + parent.title : ''}
                      </small>
                    </span>
                    <div className="trash-actions">
                      <button
                        disabled={busy || !!parent}
                        title={parent ? t('Restore ') + parent.title + t(' first') : undefined}
                        aria-label={t('Restore ') + item.title}
                        onClick={() => void act(item, false)}
                      >
                        {t('Restore')}
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        aria-label={t('Delete permanently ') + item.title}
                        onClick={() => {
                          setError('');
                          setPending(item);
                        }}
                      >
                        {t('Delete permanently')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {shown.length > pageSize ? (
              <nav className="trash-pagination" aria-label={t('Trash pages')}>
                <button
                  aria-label={t('Previous page')}
                  disabled={!currentPage || busy}
                  onClick={() => setPage(currentPage - 1)}
                >
                  {t('Previous page')}
                </button>
                <span role="status">
                  {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, shown.length)} / {shown.length}
                </span>
                <button
                  aria-label={t('Next page')}
                  disabled={currentPage === lastPage || busy}
                  onClick={() => setPage(currentPage + 1)}
                >
                  {t('Next page')}
                </button>
              </nav>
            ) : null}
            {!items.length && !error ? <p>{t('Trash is empty.')}</p> : null}
            {items.length > 0 && !shown.length ? <p>{t('No items in this category.')}</p> : null}
            <footer>
              <button autoFocus onClick={onClose}>
                {t('Close')}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
