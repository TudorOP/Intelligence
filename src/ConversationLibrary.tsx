import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Entity } from './types';
import Modal from './Modal';
import ActionMenu from './ActionMenu';
import { BulkBar } from './WorkspacePanels';
import { useMarqueeSelection } from './Selection';
export default function ConversationLibrary({
  all,
  onOpen,
  onClose,
  onChanged,
  onError,
}: {
  all: Entity[];
  onOpen: (e: Entity) => void;
  onClose: () => void;
  onChanged: () => Promise<any>;
  onError: (e: any) => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [hasMore, setHasMore] = useState(false);
  const anchor = useRef<string | null>(null),
    generation = useRef(0);
  const marquee = useMarqueeSelection('.conversation-library-list', selected, setSelected, anchor);
  const load = (at = 0) => {
    const seq = ++generation.current;
    return api
      .workspace({ action: 'conversations-list', query, offset: at })
      .then((v) => {
        if (generation.current !== seq) return;
        setRows((old) =>
          at ? [...old, ...v.filter((e: Entity) => !old.some((o) => o.id === e.id))] : v,
        );
        setOffset(at + v.length);
        setHasMore(v.length === 80);
      })
      .catch(onError);
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      setSelected(new Set());
      anchor.current = null;
      void load();
    }, 150);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [query]);
  const choose = (e: Entity, event: React.MouseEvent) => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      anchor.current = e.id;
      onOpen(e);
      return;
    }
    setSelected((old) => {
      const n = new Set(old),
        a = rows.findIndex((v) => v.id === anchor.current),
        b = rows.findIndex((v) => v.id === e.id);
      if (event.shiftKey && a >= 0 && b >= 0)
        rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((v) => n.add(v.id));
      else {
        n.has(e.id) ? n.delete(e.id) : n.add(e.id);
        anchor.current = e.id;
      }
      return n;
    });
  };
  const trash = async (e: Entity) => {
    try {
      await api.mutate({ id: e.id, revision: e.revision, action: 'trash' });
      setSelected((old) => new Set([...old].filter((id) => id !== e.id)));
      await onChanged();
      await load();
    } catch (error) {
      onError(error);
    }
  };
  return (
    <Modal title={t('Recent conversations')} onClose={onClose} className="conversation-library">
      <div className="conversation-library-toolbar">
        <input
          autoFocus
          aria-label={t('Search conversations')}
          placeholder={t('Search conversations…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="conversation-library-list" data-selection-surface>
        {marquee}
        {rows.map((e) => (
          <article
            key={e.id}
            className="conversation-library-row"
            data-selected={selected.has(e.id)}
            data-selection-id={e.id}
          >
            <button aria-pressed={selected.has(e.id)} onClick={(event) => choose(e, event)}>
              <span>◌</span>
              <div>
                <b>{e.title}</b>
                <small>
                  {new Date(e.lastMessage).toLocaleString()} ·{' '}
                  {t(
                    e.data.report
                      ? 'Report conversation'
                      : e.data.task
                        ? 'Task conversation'
                        : e.data.readOnlyMachine
                          ? 'Machine conversation'
                          : 'Chat',
                  )}
                </small>
              </div>
            </button>
            <ActionMenu label={t('Conversation actions')}>
              <button onClick={() => onOpen(e)}>{t('Open')}</button>
              <button onClick={() => void trash(e)}>{t('Move to Trash')}</button>
            </ActionMenu>
          </article>
        ))}
        {!rows.length && <p className="empty">{t('No matching conversations.')}</p>}
        {hasMore && <button onClick={() => void load(offset)}>{t('Load more')}</button>}
      </div>
      {selected.size > 0 && (
        <BulkBar
          items={rows.filter((e) => selected.has(e.id))}
          all={all}
          onError={onError}
          onDone={() => {
            setSelected(new Set());
            void onChanged().then(() => load());
          }}
        />
      )}
      <footer>
        <button onClick={onClose}>{t('Close')}</button>
      </footer>
    </Modal>
  );
}
