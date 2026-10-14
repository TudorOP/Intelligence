import { t } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { Entity, Settings, Snapshot } from './types';
import { api } from './api';
import NoteEditor from './Editor';
import ThemeArt from './ThemeArt';
import ActionMenu from './ActionMenu';
import Icon from './Icon';
import Splitter from './Splitter';
import { HistoryPanel, BulkBar } from './WorkspacePanels';
import './vault.css';
import { useMarqueeSelection } from './Selection';
export default function Vault({
  snapshot,
  onError,
  onSettings,
  onAsk,
  initialId = null,
  onSelect,
}: {
  snapshot: Snapshot;
  onError: (e: any) => void;
  onSettings: (v: Partial<Settings>) => Promise<any>;
  onAsk: (item: Entity) => void;
  initialId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const items = snapshot.entities.filter((e) => e.kind.startsWith('vault-'));
  const sort = snapshot.settings.vaultSort ?? 'manual';
  const ordered = (values: Entity[]) =>
    [...values].sort((a, b) => {
      if (sort === 'manual')
        return (a.data.order ?? Date.parse(a.created)) - (b.data.order ?? Date.parse(b.created));
      if (sort === 'updated') return Date.parse(b.updated) - Date.parse(a.updated);
      if (sort === 'folders' && a.kind !== b.kind) return a.kind === 'vault-folder' ? -1 : 1;
      return (
        a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) *
        (sort === 'name-desc' ? -1 : 1)
      );
    });
  const [selection, setInternalSelection] = useState<string | null>(initialId),
    [document, setDocument] = useState<Entity | null>(null),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [query, setQuery] = useState(''),
    [matches, setMatches] = useState<string[] | null>(null),
    [form, setForm] = useState<{ mode: string; name: string; parent: string | null } | null>(null),
    [busy, setBusy] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const selectionAnchor = useRef<string | null>(null);
  const marquee = useMarqueeSelection(
    '.vault-tree',
    selectedItems,
    setSelectedItems,
    selectionAnchor,
  );
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dropItem, setDropItem] = useState<{ id: string; before: boolean } | null>(null);
  const clearDrag = () => {
    setDragItem(null);
    setDropItem(null);
  };
  const generation = useRef(0),
    setSelection = (id: string | null) => {
      setInternalSelection(id);
      onSelect?.(id);
    },
    selected = items.find((e) => e.id === selection),
    folders = items.filter((e) => e.kind === 'vault-folder');
  useEffect(() => {
    setInternalSelection(initialId);
  }, [initialId]);
  useEffect(() => {
    const version = ++generation.current;
    setDocument((old) => (old?.id === selection ? old : null));
    if (selected?.kind === 'vault-file')
      void api
        .vault({ action: 'read', id: selected.id })
        .then((e) => {
          if (version === generation.current) setDocument(e);
        })
        .catch(onError);
    return () => {
      generation.current++;
    };
  }, [selection, selected?.revision]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setMatches(null);
        return;
      }
      void api
        .vault({ action: 'list', query })
        .then((result) => {
          if (!cancelled) setMatches(result.items.map((e: Entity) => e.id));
        })
        .catch(onError);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, items.length]);
  const act = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!form) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        setForm(null);
      }
      if (event.key === 'Tab') {
        const nodes = Array.from(
          window.document.querySelectorAll<HTMLElement>(
            '.vault-page form[role=dialog] input,.vault-page form[role=dialog] select,.vault-page form[role=dialog] button:not(:disabled)',
          ),
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && window.document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && window.document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [form !== null]);
  const parent = selected?.kind === 'vault-folder' ? selected.id : (selected?.parent ?? null);
  const pathFor = (e: Entity): string => {
    const p = items.find((f) => f.id === e.parent);
    return (p ? pathFor(p) + '/' : '') + e.title;
  };
  const showForm = (mode: string) =>
    setForm({ mode, name: mode === 'rename' ? (selected?.title ?? '') : '', parent });
  const reorder = (item: Entity, direction: number) =>
    void act(async () => {
      const siblings = ordered(items.filter((e) => e.parent === item.parent));
      const index = siblings.findIndex((e) => e.id === item.id);
      const before = direction < 0 ? siblings[index - 1] : siblings[index + 2];
      await api.vault({
        action: 'reorder',
        id: item.id,
        revision: item.revision,
        beforeId: before?.id ?? null,
        beforeRevision: before?.revision,
      });
    });
  const submit = () =>
    void act(async () => {
      if (!form) return;
      const result = await api.vault(
        form.mode === 'file' || form.mode === 'folder'
          ? {
              action: 'create',
              kind: form.mode === 'file' ? 'vault-file' : 'vault-folder',
              parent: form.parent,
              title: form.name,
              content: '',
            }
          : {
              action: 'move',
              id: selected!.id,
              revision: selected!.revision,
              ...(form.mode === 'rename' ? { title: form.name } : { parent: form.parent }),
            },
      );
      setForm(null);
      setSelection(result.id);
      if (result.parent) setExpanded((old) => new Set([...old, result.parent]));
    });
  const row = (e: Entity, depth = 0): React.ReactNode => (
    <div key={e.id}>
      <div
        className={
          'vault-tree-row ' +
          (selection === e.id ? 'selected ' : '') +
          (dropItem?.id === e.id
            ? dropItem.before
              ? 'vault-drop-before'
              : 'vault-drop-after'
            : '')
        }
        style={{ paddingLeft: 12 + depth * 14 }}
        data-selected={selectedItems.has(e.id)}
        data-selection-id={e.id}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('.dropdown,.trash-shortcut,.vault-row-delete'))
            return;
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
            selectionAnchor.current = e.id;
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setSelectedItems((old) => {
            const next = new Set(old),
              visible = [
                ...window.document.querySelectorAll<HTMLElement>('.vault-tree [data-selection-id]'),
              ].map((v) => v.dataset.selectionId);
            if (event.shiftKey) {
              const a = visible.indexOf(selectionAnchor.current ?? ''),
                b = visible.indexOf(e.id);
              if (a >= 0)
                visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((v) => next.add(v!));
              else {
                next.add(e.id);
                selectionAnchor.current = e.id;
              }
            } else {
              next.has(e.id) ? next.delete(e.id) : next.add(e.id);
              selectionAnchor.current = e.id;
            }
            return next;
          });
        }}
        onDragOver={(event) => {
          const source = items.find((v) => v.id === dragItem);
          if (sort !== 'manual' || !source || source.id === e.id || source.parent !== e.parent)
            return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          const rect = event.currentTarget.getBoundingClientRect();
          setDropItem({ id: e.id, before: event.clientY < rect.top + rect.height / 2 });
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropItem(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const source = items.find((v) => v.id === dragItem);
          if (source && source.parent === e.parent && dropItem?.id === e.id) {
            const siblings = ordered(
              items.filter((v) => v.parent === e.parent && v.id !== source.id),
            );
            const before = dropItem.before
              ? e
              : siblings[siblings.findIndex((v) => v.id === e.id) + 1];
            void act(() =>
              api.vault({
                action: 'reorder',
                id: source.id,
                revision: source.revision,
                beforeId: before?.id ?? null,
                beforeRevision: before?.revision,
              }),
            );
          }
          clearDrag();
        }}
      >
        <button
          className="vault-open"
          draggable={sort === 'manual' && !busy}
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-intelligence-vault', e.id);
            event.dataTransfer.effectAllowed = 'move';
            setDragItem(e.id);
          }}
          onDragEnd={clearDrag}
          onClick={() => {
            setSelection(e.id);
            if (e.kind === 'vault-folder')
              setExpanded((old) => {
                const next = new Set(old);
                next.has(e.id) ? next.delete(e.id) : next.add(e.id);
                return next;
              });
          }}
          aria-label={t('Open ') + e.title}
        >
          <span>{e.kind === 'vault-folder' ? (expanded.has(e.id) ? '▾' : '▸') : '▧'}</span>
          {e.title}
        </button>
        <button
          className="vault-row-delete"
          aria-label={t('Move to Trash ') + e.title}
          title={t('Move to Trash')}
          onClick={() =>
            void act(async () => {
              await api.vault({ action: 'trash', id: e.id, revision: e.revision });
              if (selection === e.id) setSelection(null);
            })
          }
        >
          <Icon name="trash" />
        </button>
        <ActionMenu label={t('Vault item actions')}>
          {selectedItems.has(e.id) && selectedItems.size > 1 ? (
            <>
              <button
                onClick={() =>
                  window.document.querySelector<HTMLSelectElement>('.bulk-bar select')?.focus()
                }
              >
                {t('Move selected items')}
              </button>
              <button
                onClick={() =>
                  [...window.document.querySelectorAll<HTMLButtonElement>('.bulk-bar button')]
                    .find((button) => button.textContent === t('Export'))
                    ?.click()
                }
              >
                {t('Export selected items')}
              </button>
              <button
                className="danger"
                onClick={() =>
                  void api
                    .workspace({
                      action: 'bulk',
                      operation: 'trash',
                      items: items
                        .filter((v) => selectedItems.has(v.id))
                        .map((v) => ({ id: v.id, revision: v.revision })),
                    })
                    .then((results) => {
                      const failures = results.filter((v: any) => !v.ok);
                      if (failures.length)
                        throw Error(failures.map((v: any) => v.error).join('\n'));
                      setSelectedItems(new Set());
                    })
                    .catch(onError)
                }
              >
                {t('Move selected items to Trash')}
              </button>
            </>
          ) : null}
          <button onClick={() => setSelection(e.id)}>{t('Open')}</button>
          <button
            onClick={() =>
              void api
                .workspace({
                  action: 'pin',
                  id: e.id,
                  enabled: !(snapshot.settings.pinnedItems ?? []).includes(e.id),
                })
                .catch(onError)
            }
          >
            {t((snapshot.settings.pinnedItems ?? []).includes(e.id) ? 'Unpin' : 'Pin')}
          </button>
          <button
            disabled={
              busy ||
              sort !== 'manual' ||
              ordered(items.filter((v) => v.parent === e.parent))[0]?.id === e.id
            }
            onClick={() => reorder(e, -1)}
          >
            {t('Move up')}
          </button>
          <button
            disabled={
              busy ||
              sort !== 'manual' ||
              ordered(items.filter((v) => v.parent === e.parent)).at(-1)?.id === e.id
            }
            onClick={() => reorder(e, 1)}
          >
            {t('Move down')}
          </button>
          <button
            onClick={() => {
              setSelection(e.id);
              setForm({ mode: 'rename', name: e.title, parent: e.parent });
            }}
          >
            {t('Rename')}
          </button>
          <button
            onClick={() => {
              setSelection(e.id);
              setForm({ mode: 'move', name: e.title, parent: e.parent });
            }}
          >
            {t('Move')}
          </button>
          <button
            className="danger"
            onClick={() =>
              void act(async () => {
                await api.vault({ action: 'trash', id: e.id, revision: e.revision });
                if (selection === e.id) setSelection(null);
              })
            }
          >
            {t('Move to Trash')}
          </button>
        </ActionMenu>
      </div>
      {e.kind === 'vault-folder' && expanded.has(e.id)
        ? ordered(items.filter((child) => child.parent === e.id)).map((child) =>
            row(child, depth + 1),
          )
        : null}
    </div>
  );
  const linked = document
    ? items.filter(
        (e) =>
          e.id !== document.id &&
          e.kind === 'vault-file' &&
          (document.data.content ?? '').includes('[[' + e.title.replace(/\.md$/i, '') + ']]'),
      )
    : [];
  return (
    <div className="vault-page">
      <aside
        className="vault-explorer"
        style={
          {
            '--pane-width': (snapshot.settings.paneWidths?.navigator ?? 265) + 'px',
          } as React.CSSProperties
        }
      >
        <Splitter
          name="Resize navigator"
          value={snapshot.settings.paneWidths?.navigator ?? 265}
          min={210}
          max={450}
          onSave={(v) =>
            void onSettings({ paneWidths: { ...snapshot.settings.paneWidths, navigator: v } })
          }
        />
        <header>
          <b>Vault</b>
          <button aria-label={t('Vault root')} onClick={() => setSelection(null)}>
            ⌂
          </button>
        </header>
        <input
          aria-label={t('Search Vault')}
          placeholder={t('Search files…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="vault-create">
          <button onClick={() => showForm('file')}>{t('＋ File')}</button>
          <button onClick={() => showForm('folder')}>{t('＋ Folder')}</button>
          <button
            onClick={() => void act(() => api.vault({ action: 'import', parent }))}
            aria-label={t('Import Markdown')}
          >
            ↥
          </button>
        </div>
        <div className="vault-tree" data-selection-surface>
          {marquee}
          <label className="vault-sort">
            {t('Order')}
            <select
              aria-label={t('Vault sort order')}
              value={sort}
              onChange={(e) =>
                void onSettings({ vaultSort: e.target.value as Settings['vaultSort'] }).catch(
                  onError,
                )
              }
            >
              <option value="manual">{t('Manual order')}</option>
              <option value="name">{t('Name A–Z')}</option>
              <option value="name-desc">{t('Name Z–A')}</option>
              <option value="folders">{t('Folders first')}</option>
              <option value="updated">{t('Recently modified')}</option>
            </select>
          </label>
          {matches
            ? ordered(items.filter((e) => matches.includes(e.id))).map((e) => row(e))
            : ordered(items.filter((e) => !e.parent)).map((e) => row(e))}
          {!items.length ? <p>{t('Create your first Markdown file.')}</p> : null}
        </div>
        <footer>
          <small>{t('Stored in Intelligence / Vault')}</small>
          <button onClick={() => void onSettings({ vaultAccess: !snapshot.settings.vaultAccess })}>
            {snapshot.settings.vaultAccess
              ? t('◎ Agent access enabled')
              : t('◎ Agent access disabled')}
          </button>
        </footer>
      </aside>
      {selectedItems.size ? (
        <BulkBar
          items={items.filter((e) => selectedItems.has(e.id))}
          all={items}
          onDone={() => setSelectedItems(new Set())}
          onError={onError}
        />
      ) : null}
      <section
        className="vault-document"
        data-vault-font={snapshot.settings.vaultFont ?? 'inter'}
        style={
          {
            '--vault-font': {
              inter: 'Inter Variable',
              lora: 'Lora Variable',
              garamond: 'EB Garamond Variable',
              mono: 'JetBrains Mono Variable',
            }[snapshot.settings.vaultFont ?? 'inter'],
          } as React.CSSProperties
        }
      >
        <header className="vault-heading">
          <div>
            <span className="eyebrow">{t('MARKDOWN VAULT')}</span>
            <h1>{selected ? selected.title : t('A place for your knowledge.')}</h1>
            <small>
              {selected ? pathFor(selected) : t('Files and folders, always within reach.')}
            </small>
          </div>
          <div className="heading-actions">
            <label className="vault-font">
              {t('Document font')}
              <select
                aria-label={t('Vault document font')}
                value={snapshot.settings.vaultFont ?? 'inter'}
                onChange={(e) =>
                  void onSettings({ vaultFont: e.target.value as Settings['vaultFont'] })
                }
              >
                <option value="inter">Inter</option>
                <option value="lora">Lora</option>
                <option value="garamond">EB Garamond</option>
                <option value="mono">JetBrains Mono</option>
              </select>
            </label>
            {selected ? (
              <details className="dropdown">
                <summary aria-label={t('Vault item options')}>···</summary>
                <div className="dropdown-content">
                  <button onClick={() => showForm('rename')}>{t('Rename')}</button>
                  <button onClick={() => showForm('move')}>{t('Move to folder')}</button>
                  <button
                    onClick={() =>
                      void act(async () => {
                        await api.vault({ action: 'trash', id: selected.id });
                        setSelection(null);
                      })
                    }
                  >
                    {t('Move to Trash')}
                  </button>
                </div>
              </details>
            ) : null}
          </div>
        </header>
        {selected ? (
          <div className="vault-permissions">
            <label>
              {t('Agent access')}
              <select
                aria-label={t('Vault item access')}
                value={
                  selected.data.access === false
                    ? 'private'
                    : selected.data.access === true
                      ? selected.data.permission === 'read'
                        ? 'read'
                        : 'edit'
                      : 'inherit'
                }
                onChange={(e) =>
                  void act(() =>
                    api.vault({
                      action: 'permission',
                      id: selected.id,
                      revision: selected.revision,
                      access: e.target.value === 'inherit' ? null : e.target.value !== 'private',
                      permission: e.target.value === 'read' ? 'read' : 'edit',
                    }),
                  )
                }
              >
                <option value="inherit">{t('Inherit from folder')}</option>
                <option value="private">{t('Private')}</option>
                <option value="read">{t('Read')}</option>
                <option value="edit">{t('Read & edit')}</option>
              </select>
            </label>
            <button onClick={() => onAsk(document ?? selected)}>{t('Ask agent ↗')}</button>
            <button
              onClick={() =>
                void act(async () => {
                  const fresh = await api.vault({ action: 'read', id: selected.id });
                  setDocument(fresh);
                  setReloadNonce((v) => v + 1);
                })
              }
            >
              {t('Reload from disk ↻')}
            </button>
          </div>
        ) : null}
        {document?.kind === 'vault-file' ? (
          <>
            <HistoryPanel
              item={document}
              onChanged={() => {
                setReloadNonce((v) => v + 1);
                void api
                  .vault({ action: 'read', id: document.id })
                  .then(setDocument)
                  .catch(onError);
              }}
              onError={onError}
            />
            <NoteEditor
              key={document.id + ':' + reloadNonce}
              vault
              note={document}
              onError={(e) => onError(new Error(e))}
              onSaved={(e) => setDocument(e)}
            />
          </>
        ) : selected?.kind === 'vault-file' ? (
          <p className="page-pad">{t('Opening Markdown…')}</p>
        ) : (
          <div className="vault-empty">
            <ThemeArt category={1} className="section-art" variant="banner" />
            <h2>
              {selected ? t('Add a file to this folder.') : t('Keep ideas in plain Markdown.')}
            </h2>
            <p>
              {t(
                'Create folders, write notes, insert images and tables, and invite your agent to help.',
              )}
            </p>
            <button className="primary" onClick={() => showForm('file')}>
              {t('New Markdown file')}
            </button>
          </div>
        )}
        {linked.length ? (
          <div className="vault-linked">
            <span>{t('Linked files')}</span>
            {linked.map((e) => (
              <button key={e.id} onClick={() => setSelection(e.id)}>
                {e.title} ↗
              </button>
            ))}
          </div>
        ) : null}
      </section>
      {form ? (
        <div className="modal-backdrop">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={t('Vault file or folder')}
            className="form-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <h2>
              {form.mode === 'file'
                ? t('New Markdown file')
                : form.mode === 'folder'
                  ? t('New folder')
                  : form.mode === 'rename'
                    ? t('Rename')
                    : t('Move to folder')}
            </h2>
            {form.mode !== 'move' ? (
              <label>
                {t('Name')}
                <input
                  autoFocus
                  aria-label={t('Vault item name')}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
            ) : null}
            {form.mode !== 'rename' ? (
              <label>
                {t('Folder')}
                <select
                  aria-label={t('Vault destination folder')}
                  value={form.parent ?? ''}
                  onChange={(e) => setForm({ ...form, parent: e.target.value || null })}
                >
                  <option value="">{t('Vault root')}</option>
                  {folders
                    .filter((e) => e.id !== selected?.id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {pathFor(e)}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <footer>
              <button type="button" onClick={() => setForm(null)}>
                {t('Cancel')}
              </button>
              <button
                className="primary"
                disabled={busy || (form.mode !== 'move' && !form.name.trim())}
              >
                {t('Save')}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
