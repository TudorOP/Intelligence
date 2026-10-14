import { useEffect, useState } from 'react';
import { api } from './api';
import { t, locale } from './i18n';
import type { Entity, API } from './types';

export default function MemoryDetails({
  memory,
  onOpen,
}: {
  memory: Entity;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [info, setInfo] = useState<Awaited<ReturnType<API['memoryInspect']>> | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let current = true;
    setInfo(null);
    setError('');
    api
      .memoryInspect(memory.id)
      .then((result) => {
        if (current) setInfo(result);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [open, memory]);
  return (
    <details className="memory-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('Stored details & sources')}</summary>
      {open ? (
        <div className="memory-detail-body">
          <p className="memory-availability" role="status">
            {error ? t(error) : info ? t(info.reason) : t('Loading…')}
          </p>
          {memory.data.model ? (
            <p>
              <b>{t('Created with')}</b> {memory.data.model}
            </p>
          ) : null}
          {memory.data.key && memory.data.type === 'fact' ? (
            <p>
              <b>{t('Fact key')}</b> <code>{memory.data.key}</code>
            </p>
          ) : null}
          {info?.sources.length ? (
            <div className="memory-source-links">
              <b>{t('Linked sources')}</b>
              {info.sources.map((source) => (
                <button
                  key={source.id}
                  className="quiet-button"
                  disabled={source.deleted}
                  onClick={() => onOpen(source.id)}
                >
                  {source.title || t('Missing source')} ·{' '}
                  {t(
                    source.deleted
                      ? 'Removed'
                      : source.available
                        ? 'Available'
                        : 'Outside agent access',
                  )}{' '}
                  ↗
                </button>
              ))}
            </div>
          ) : info ? (
            <p>{t('No source links were recorded for this memory.')}</p>
          ) : null}
          {info?.messages.length ? (
            <div className="memory-source-messages">
              <b>
                {t('Source message excerpts')} · {info.messageCount}
              </b>
              <p>
                {t(
                  'Original message excerpts for context; these are separate from the saved memory above.',
                )}
              </p>
              {info.messages.map((message) => (
                <blockquote key={message.id}>
                  <small>
                    {t(message.role === 'user' ? 'You' : 'Assistant')} ·{' '}
                    {new Date(message.created).toLocaleString(locale())}
                  </small>
                  <p>
                    {message.content}
                    {message.truncated ? '…' : ''}
                  </p>
                </blockquote>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
