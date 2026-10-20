import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';
import { t } from './i18n';
import type { Entity, Settings } from './types';
import { resourceLabel } from '../electron/resource-catalog.mjs';
export type ChatAttachment = {
  id: string;
  name: string;
  size: number;
  retention: 'conversation' | 'project';
  project?: string;
  path?: string;
};
const sections: Record<string, string[]> = {
  notebooks: ['notebook', 'chapter', 'note'],
  tasks: ['board', 'list', 'card'],
  other: [
    'project',
    'calendar',
    'calendar-event',
    'vault-folder',
    'vault-file',
    'report',
    'report-template',
    'memory',
    'conversation',
  ],
};
export default function ChatSources({
  conversation,
  resources,
  context,
  onToggle,
  ensureConversation,
  settings,
  onError,
  disabled,
  files,
  onFiles,
}: {
  conversation: Entity | null;
  resources: Entity[];
  context: Entity[];
  onToggle: (e: Entity, checked: boolean) => void;
  ensureConversation: () => Promise<Entity>;
  settings: Settings;
  onError: (text: string) => void;
  disabled: boolean;
  files: ChatAttachment[];
  onFiles: (files: ChatAttachment[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState('external'),
    [query, setQuery] = useState(''),
    [retention, setRetention] = useState('conversation'),
    [project, setProject] = useState(conversation?.project || settings.lastProject || ''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    if (!conversation) {
      onFiles([]);
      return;
    }
    void api
      .workspace({ action: 'chat-attachment-list', conversation: conversation.id })
      .then((next) => {
        if (live) onFiles(next);
      })
      .catch(() => {
        if (live) onFiles([]);
      });
    return () => {
      live = false;
    };
  }, [conversation?.id]);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const attach = (folder: boolean) =>
    void act(async () => {
      const c = await ensureConversation();
      const result = await api.workspace({
        action: 'chat-attachment-add',
        conversation: c.id,
        folder,
        retention,
        project: project || c.project,
      });
      onFiles(result.files);
      setNotice(
        [
          result.skipped?.length
            ? t('Skipped hidden files or symbolic links') + ': ' + result.skipped.length
            : '',
          ...(result.warnings || []),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    });
  const candidates = useMemo(
    () =>
      open && tab !== 'external'
        ? resources.filter((e) => !e.deleted && sections[tab]?.includes(e.kind))
        : [],
    [open, tab, resources],
  );
  const index = useMemo(() => {
    const items = new Map(candidates.map((e) => [e.id, e])),
      children = new Map<string, Entity[]>(),
      matched = new Set<string>();
    for (const entity of candidates) {
      if (entity.parent) {
        const siblings = children.get(entity.parent) || [];
        siblings.push(entity);
        children.set(entity.parent, siblings);
      }
      if (!query || entity.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
        let current: Entity | undefined = entity;
        const seen = new Set<string>();
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          matched.add(current.id);
          current = current.parent ? items.get(current.parent) : undefined;
        }
      }
    }
    return { items, children, matched };
  }, [candidates, query]);
  const matches = (entity: Entity) => index.matched.has(entity.id);
  let rendered = 0;
  const branch = (entity: Entity, seen = new Set<string>()): React.ReactNode => {
    if (seen.has(entity.id) || !matches(entity) || rendered++ >= 300) return null;
    seen.add(entity.id);
    const children = index.children.get(entity.id) || [];
    const label = (
      <label className="source-resource">
        <input
          type="checkbox"
          checked={context.some((e) => e.id === entity.id)}
          disabled={disabled}
          onChange={(e) => onToggle(entity, e.target.checked)}
        />
        <span>
          {entity.title}
          <small>{t(resourceLabel(entity.kind))}</small>
        </span>
      </label>
    );
    return children.length ? (
      <details key={entity.id} open={query ? true : undefined}>
        <summary>{label}</summary>
        <div className="source-tree">{children.map((e) => branch(e, new Set(seen)))}</div>
      </details>
    ) : (
      <div key={entity.id}>{label}</div>
    );
  };
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="icon-button add-sources"
        aria-label={t('Add sources')}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        ＋
      </button>
      {open &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => {
              if (!busy) close();
            }}
          >
            <section
              ref={panel}
              className="sources-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t('Add sources')}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !busy) {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }
                if (e.key === 'Tab') {
                  const elements = Array.from(
                    panel.current!.querySelectorAll<HTMLElement>(
                      'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary',
                    ),
                  );
                  const first = elements[0],
                    last = elements.at(-1);
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <header>
                <h2>{t('Add sources')}</h2>
                <button aria-label={t('Close')} disabled={busy} onClick={close}>
                  ×
                </button>
              </header>
              <nav className="source-tabs" aria-label={t('Source types')}>
                {[
                  ['external', 'Files & images'],
                  ['notebooks', 'Notebooks'],
                  ['tasks', 'Tasks'],
                  ['other', 'Other resources'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={tab === id}
                    onClick={() => {
                      setTab(id);
                      setQuery('');
                    }}
                  >
                    {t(label)}
                  </button>
                ))}
              </nav>
              <div className="source-content">
                {tab === 'external' ? (
                  <>
                    <label>
                      {t('Keep attached files')}
                      <select
                        aria-label={t('Keep attached files')}
                        value={retention}
                        onChange={(e) => setRetention(e.target.value)}
                        disabled={busy}
                      >
                        <option value="conversation">{t('This conversation only')}</option>
                        <option value="project">{t('Keep in project')}</option>
                      </select>
                    </label>
                    <label>
                      {t('Project')}
                      <select
                        aria-label={t('Attachment project')}
                        value={project}
                        onChange={(e) => setProject(e.target.value)}
                        disabled={busy}
                      >
                        <option value="">{t('Choose a project')}</option>
                        {resources
                          .filter((e) => e.kind === 'project')
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="source-actions">
                      <button
                        disabled={busy || (retention === 'project' && !project)}
                        onClick={() => attach(false)}
                      >
                        {t('Attach files and images')}
                      </button>
                      <button
                        disabled={busy || (retention === 'project' && !project)}
                        onClick={() => attach(true)}
                      >
                        {t('Attach folder snapshot')}
                      </button>
                    </div>
                    <small>
                      {t(
                        'Text, PDF, DOCX and images. Up to 25 MB per file; folder snapshots up to 200 files and 100 MB. Originals stay untouched. Scanned documents need page images or a text export.',
                      )}
                    </small>
                    <small>
                      {t(
                        'Conversation-only copies follow the chat into Trash and are removed on permanent deletion when no other chat uses them. Project copies survive. Exported backups keep their own copies.',
                      )}
                    </small>
                    {files.map((file) => (
                      <div className="source-file" key={file.id}>
                        <span>
                          {file.name}
                          <small>
                            {t(
                              file.retention === 'project'
                                ? 'Kept in project'
                                : 'This conversation only',
                            )}
                            {file.path ? ' · ' + file.path : ''}
                          </small>
                        </span>
                        {file.retention === 'conversation' && (
                          <button
                            disabled={busy || !project}
                            onClick={() =>
                              void act(async () => {
                                const c = await ensureConversation();
                                onFiles(
                                  await api.workspace({
                                    action: 'chat-attachment-keep',
                                    conversation: c.id,
                                    id: file.id,
                                    project,
                                  }),
                                );
                              })
                            }
                          >
                            {t('Keep in project')}
                          </button>
                        )}
                        <button
                          disabled={busy}
                          aria-label={t('Remove attachment') + ' ' + file.name}
                          onClick={() =>
                            void act(async () => {
                              const c = await ensureConversation();
                              onFiles(
                                await api.workspace({
                                  action: 'chat-attachment-remove',
                                  conversation: c.id,
                                  id: file.id,
                                }),
                              );
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <input
                      aria-label={t('Find a resource')}
                      placeholder={t('Find a resource')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <small>
                      {t(
                        'Selecting identifies a resource. Its contents still require effective access; ordinary questions can search all permitted resources.',
                      )}
                    </small>
                    {candidates
                      .filter((e) => !e.parent || !index.items.has(e.parent))
                      .map((e) => branch(e))}
                    {index.matched.size > 300 && (
                      <small>{t('Showing up to 300 items. Refine the search to find more.')}</small>
                    )}
                    {!candidates.some((e) => matches(e)) && <p>{t('No matching choices')}</p>}
                  </>
                )}
              </div>
              {notice && <p role="status">{notice}</p>}
              <footer>
                <button disabled={busy} onClick={close}>
                  {busy ? t('Working…') : t('Done')}
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
