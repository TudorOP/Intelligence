import { Markdown } from './ReportReader';
import type { Entity } from './types';
import { api } from './api';
import { t } from './i18n';
import { useState } from 'react';
export default function ChapterContent({
  chapter,
  onCreated,
  onError,
}: {
  chapter: Entity;
  onCreated: (note: Entity) => void;
  onError: (error: any) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!chapter.data.content?.trim()) return null;
  return (
    <details className="chapter-stored-content">
      <summary>{t('Saved chapter content')}</summary>
      <p>
        {t(
          'This text is stored on the chapter, rather than in a note. You can read it here or copy it into a child note; the original stays saved.',
        )}
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api
            .workspace({
              action: 'chapter-content-note',
              id: chapter.id,
              revision: chapter.revision,
            })
            .then(onCreated)
            .catch(onError)
            .finally(() => setBusy(false));
        }}
      >
        {t('Create note from this content')}
      </button>
      <article>
        <Markdown text={chapter.data.content} />
      </article>
    </details>
  );
}
