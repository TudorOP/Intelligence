import { t } from './i18n';
import type { ReactNode } from 'react';
import type { Entity } from './types';
import { art } from './api';
import ThemeArt from './ThemeArt';
import { coverColor } from './coverColors';
export default function NotebookCover({
  notebook,
  notes,
  shared,
  menu,
  onOpen,
  selected,
  onSelect,
}: {
  notebook: Entity;
  notes: number;
  shared: boolean;
  menu: ReactNode;
  onOpen: () => void;
  selected?: boolean;
  onSelect?: React.MouseEventHandler<HTMLElement>;
}) {
  return (
    <article
      className="book-notebook"
      data-selection-id={notebook.id}
      data-selected={selected}
      onClickCapture={onSelect}
    >
      <div className="book-object">
        <span className="book-pages" aria-hidden="true" />
        <button
          className={'book-cover ' + (notebook.data.cover === 'night' ? 'dark-cover' : '')}
          style={{ backgroundColor: coverColor(notebook.data.cover) }}
          aria-label={notebook.title}
          title={notebook.data.description}
          onClick={onOpen}
        >
          {coverColor(notebook.data.cover) ? null : notebook.data.cover?.startsWith(
              'intelligence-media:',
            ) || notebook.data.cover?.startsWith('data:') ? (
            <img src={art(notebook.data.cover)} alt="" />
          ) : (
            <ThemeArt category={1} className="book-theme-art" />
          )}
          <span className="book-gutter" aria-hidden="true" />
          <span className="book-label">
            <span className="book-icon" aria-hidden="true">
              {notebook.data.icon ?? '✳'}
            </span>
            <span className="book-label-rule" />
            <strong>{notebook.title}</strong>
            <small>{t('NOTEBOOK')}</small>
          </span>
          <span className="book-elastic" aria-hidden="true" />
        </button>
        <div className="book-menu">{menu}</div>
      </div>
      <footer className="book-meta">
        <span>
          {notes} {t(notes === 1 ? 'note' : 'notes')}
        </span>
        <span className={shared ? 'shared' : ''}>
          {shared ? t('◎ Agent access') : t('◎ Just yours')}
        </span>
      </footer>
    </article>
  );
}
