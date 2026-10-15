import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import Switch from './Switch';
import { t } from './i18n';

export type AgentChoice = {
  id: string;
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export default function AgentChoicesDialog({
  title,
  choices,
  onClose,
}: {
  title: string;
  choices: AgentChoice[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [capacity, setCapacity] = useState({ rows: 3, columns: 2 });
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rows = Math.max(1, Math.floor(element.clientHeight / 76)),
        columns = element.clientWidth >= 580 ? 2 : 1;
      setCapacity((old) =>
        old.rows === rows && old.columns === columns ? old : { rows, columns },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const matches = choices.filter((choice) =>
      choice.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
    size = capacity.rows * capacity.columns,
    pages = Math.max(1, Math.ceil(matches.length / size)),
    current = Math.min(page, pages - 1);
  return (
    <Modal title={title} className="agent-choices-modal" onClose={onClose}>
      <div className="agent-choices-body">
        <p className="muted">
          {t('Profile choices can only restrict the access granted in the app.')}
        </p>
        <label className="agent-choice-search">
          {t('Search choices')}
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={t('Search…')}
          />
        </label>
        <div
          ref={list}
          className="agent-choice-pages"
          style={{
            gridTemplateColumns: `repeat(${capacity.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${capacity.rows}, minmax(0, 1fr))`,
          }}
        >
          {matches.slice(current * size, (current + 1) * size).map((choice) => (
            <label className="agent-choice-row" key={choice.id}>
              <span data-tooltip={choice.title}>{choice.title}</span>
              <Switch
                aria-label={choice.title}
                checked={choice.checked}
                onChange={(event) => choice.onChange(event.target.checked)}
              />
            </label>
          ))}
          {!matches.length && <p>{t('No items yet.')}</p>}
        </div>
        <nav className="agent-choice-pagination" aria-label={t('Pages')}>
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            {t('Previous page')}
          </button>
          <span role="status" aria-live="polite">
            {current + 1} / {pages}
          </span>
          <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
            {t('Next page')}
          </button>
        </nav>
      </div>
    </Modal>
  );
}
