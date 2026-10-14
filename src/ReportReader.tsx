import { useEffect, useState, useRef, useMemo } from 'react';
import { reportView } from '../electron/report-format.mjs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from './api';
import { t } from './i18n';
import type { Entity, Settings } from './types';
import Modal from './Modal';
export function Markdown({
  text,
  images = false,
  onImage,
}: {
  text: string;
  images?: boolean;
  onImage?: (src: string) => void;
}) {
  let imageCount = 0;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        img: ({ src, alt }) =>
          images &&
          src &&
          /^(https:\/\/|intelligence-media:\/\/)/.test(src) &&
          ++imageCount <= 12 ? (
            <button className="report-image" onClick={() => onImage?.(src)}>
              <img loading="lazy" src={src} alt={alt || t('Report image')} />
            </button>
          ) : (
            <span className="muted">
              {alt || t('Image')} · {t('Images disabled')}
            </span>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
export default function ReportReader({
  report,
  settings,
  onClose,
  onAsk,
  onOpen,
}: {
  report: Entity;
  settings: Settings;
  onClose: () => void;
  onAsk: (report: Entity) => void;
  onOpen: (id: string) => void;
}) {
  const [item, setItem] = useState<Entity | null>(null),
    [section, setSection] = useState(0),
    [error, setError] = useState(''),
    [image, setImage] = useState(''),
    [animate, setAnimate] = useState(settings.reportAnimations);
  useEffect(() => {
    let live = true;
    setItem(null);
    setSection(0);
    setError('');
    void api
      .workspace({ action: 'reports-read', id: report.id })
      .then((e) => {
        if (live) setItem(e);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    void api.workspace({ action: 'reports-read-mark', id: report.id }).catch(() => {});
    return () => {
      live = false;
    };
  }, [report.id]);
  const scroll = useRef<HTMLElement>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [section]);
  const view = useMemo(() => reportView(item?.data), [item]),
    rows = view.sections,
    labels = [t('Overview'), t('Report'), t('Source references'), ...rows.map((v) => v.title)],
    content =
      section === 0
        ? view.summary || item?.data.error || t('Open Report to read the full result.')
        : section === 2
          ? ''
          : section === 1
            ? view.content
            : rows[section - 3]?.content || '';
  return (
    <Modal
      title={report.title}
      onClose={onClose}
      className={'report-reader ' + (animate ? 'report-animated' : '')}
    >
      <div className="report-meta">
        <span>
          {report.data.agentName} · {new Date(report.created).toLocaleString()} ·{' '}
          {t(report.data.status || '')}
        </span>
        <div>
          <button onClick={() => onAsk(item || report)}>{t('Ask agent')}</button>
          <button
            onClick={() => {
              setAnimate(false);
              setSection(1);
            }}
          >
            {t('Show all')}
          </button>
          <button onClick={() => void api.copy(view.content).catch((e) => setError(e.message))}>
            {t('Copy report')}
          </button>
        </div>
      </div>
      <div className="report-reader-layout">
        <nav aria-label={t('Report sections')}>
          {labels.map((name, i) => (
            <div key={i}>
              {i === 3 && <h2 className="report-chapters-label">{t('Chapters')}</h2>}
              <button
                key={i}
                aria-current={section === i ? 'page' : undefined}
                onClick={() => setSection(i)}
              >
                {name}
              </button>
            </div>
          ))}
        </nav>
        <article className="report-scroll" ref={scroll} tabIndex={0}>
          <h1 className="report-heading" key={section}>
            <span className="sr-only">{labels[section]}</span>
            <span aria-hidden="true">
              {[...labels[section]].map((letter, i) => (
                <span key={i} style={{ animationDelay: Math.min(i * 15, 350) + 'ms' }}>
                  {letter}
                </span>
              ))}
            </span>
          </h1>
          {error && <p role="alert">{error}</p>}
          {item?.data.staleSources && (
            <p className="notice">{t('Source changed since this report was generated.')}</p>
          )}
          {!item ? (
            <p>{t('Opening report…')}</p>
          ) : section === 2 ? (
            <div className="report-sources">
              {(item.data.webSources || []).map((s: any) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              ))}
              {(item.data.sources || []).map((s: any) => (
                <button key={s.id} onClick={() => onOpen(s.id)}>
                  {t('Open source')} · {s.title || s.id.slice(0, 8)} · r{s.revision}
                </button>
              ))}
              <small>
                {t('Source references reflect supplied context; they do not prove every claim.')}
              </small>
            </div>
          ) : (
            <Markdown
              text={content.replace(
                /^\s{0,3}#{1,6}\s+([^\n]+)\n+/,
                (match: string, title: string) =>
                  title.trim() === labels[section].trim() ? '' : match,
              )}
              images={settings.reportImages && item.data.images}
              onImage={setImage}
            />
          )}
        </article>
      </div>
      <footer>
        <button disabled={!section} onClick={() => setSection(section - 1)}>
          {t('Previous section')}
        </button>
        <span>
          {section + 1} / {labels.length}
        </span>
        <button disabled={section === labels.length - 1} onClick={() => setSection(section + 1)}>
          {t('Next section')}
        </button>
      </footer>
      {image && (
        <Modal title={t('Report image')} onClose={() => setImage('')} className="image-reader">
          <img src={image} alt={t('Report image')} />
        </Modal>
      )}
    </Modal>
  );
}
export function TaskReportReader({
  task,
  onClose,
  onConversation,
}: {
  task: Entity;
  onClose: () => void;
  onConversation: (id: string) => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void api
      .workspace({ action: 'task-report', id: task.id })
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [task.id]);
  return (
    <Modal
      title={t('Agent Report') + ' · ' + task.title}
      onClose={onClose}
      className="task-report-modal"
    >
      <div className="report-meta">
        <span>{t(task.data.status || 'queued')}</span>
        {data?.conversation && (
          <button onClick={() => onConversation(data.conversation)}>
            {t('Open task conversation ↗')}
          </button>
        )}
      </div>
      <article className="report-scroll">
        {error ? (
          <p role="alert">{error}</p>
        ) : data ? (
          <>
            {data.content && (
              <small>{t(data.full ? 'Saved final response' : 'Saved completion summary')}</small>
            )}
            <Markdown text={data.content || t('No agent report yet.')} />
          </>
        ) : (
          <p>{t('Opening report…')}</p>
        )}
      </article>
    </Modal>
  );
}
