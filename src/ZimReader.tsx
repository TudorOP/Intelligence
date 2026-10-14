import { useEffect, useState } from 'react';
import Modal from './Modal';
import { api } from './api';
import { t } from './i18n';
export default function ZimReader({
  reference,
  onClose,
}: {
  reference: string;
  onClose: () => void;
}) {
  const [article, setArticle] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async (offset = 0) => {
    setBusy(true);
    try {
      const url = new URL(reference),
        parts = url.pathname.split('/').filter(Boolean),
        archive = decodeURIComponent(parts.shift() || ''),
        path = decodeURIComponent(parts.join('/'));
      if (url.hostname !== 'archive') throw Error('Invalid archive reference');
      const result = await api.workspace({
        action: 'module-zim',
        id: 'zim',
        request: {
          action: 'read',
          archive,
          path,
          archiveId: url.searchParams.get('uuid') || undefined,
          offset,
        },
      });
      setArticle((old: any) =>
        offset ? { ...result, content: (old?.content || '') + result.content } : result,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [reference]);
  return (
    <Modal title={article?.title || t('Archive source')} onClose={onClose} className="zim-reader">
      <small>{article?.archive}</small>
      {error ? <p role="alert">{t(error)}</p> : null}
      <pre>{article?.content || t('Loading…')}</pre>
      {article?.nextOffset !== null && article?.nextOffset !== undefined ? (
        <button disabled={busy} onClick={() => void load(article.nextOffset)}>
          {t('Load more')}
        </button>
      ) : null}
      <button
        disabled={!article?.content}
        onClick={() =>
          void api.copy(article.content + '\n\n' + reference).catch((e) => setError(e.message))
        }
      >
        {t('Copy excerpt & source')}
      </button>
    </Modal>
  );
}
