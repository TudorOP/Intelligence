import ProviderHelp from './ProviderHelp';
import { useEffect, useState } from 'react';
import { t } from './i18n';
import type { Settings } from './types';
import './setup.css';
export type HelpArticle = {
  id: string;
  title: string;
  paragraphs: string[];
  setting?: string;
  page?: string;
  lesson?: string[];
};
export default function HelpGuide({
  settings,
  onSetting,
  onLesson,
  lessons = false,
}: {
  settings: Settings;
  onSetting: (section: string) => void;
  onLesson: (article: HelpArticle) => void;
  lessons?: boolean;
}) {
  const [articles, setArticles] = useState<HelpArticle[]>([]),
    [selected, setSelected] = useState('start'),
    [query, setQuery] = useState('');
  useEffect(() => {
    let current = true;
    setArticles([]);
    void (settings.language === 'ro' ? import('./help/ro.json') : import('./help/en.json')).then(
      (m) => {
        if (current) setArticles(m.default);
      },
    );
    return () => {
      current = false;
    };
  }, [settings.language]);
  const matches = articles.filter(
    (a) =>
      (!lessons || a.lesson) &&
      (a.title + ' ' + a.paragraphs.join(' '))
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const article = matches.find((a) => a.id === selected) || matches[0];
  return (
    <section className="settings-section help-guide">
      <span className="eyebrow">{t('HELP & SETUP')}</span>
      <h2>{t(lessons ? 'Feature lessons' : 'Your guide to Intelligence')}</h2>
      <label className="help-search">
        {t('Find help')}
        <input
          aria-label={t('Find help')}
          placeholder={t('Search the written guide…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="help-layout">
        <nav aria-label={t('Guide contents')}>
          {matches.map((a) => (
            <button
              aria-current={a.id === article?.id ? 'page' : undefined}
              key={a.id}
              onClick={() => setSelected(a.id)}
            >
              {a.title}
            </button>
          ))}
        </nav>
        <article>
          {!articles.length ? (
            <p role="status">{t('Opening guide…')}</p>
          ) : !article ? (
            <p role="status">{t('No help matches. Try another word.')}</p>
          ) : (
            <>
              <h3>{article.title}</h3>
              {article.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {article.id === 'models' && <ProviderHelp provider={settings.provider} />}
              <div className="help-actions">
                {article.setting && (
                  <button onClick={() => onSetting(article.setting!)}>
                    {t('Open this setting')}
                  </button>
                )}
                {article.lesson && (
                  <button onClick={() => onLesson(article)}>
                    {t(
                      (settings.onboarding?.lessons[article.id] || 0) > 0 &&
                        (settings.onboarding?.lessons[article.id] || 0) < article.lesson.length
                        ? 'Continue lesson'
                        : 'Start lesson',
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </article>
      </div>
      <p className="settings-note">
        {t(
          'This guide works offline and does not use a model. Lessons are optional; they never change your work automatically.',
        )}
      </p>
    </section>
  );
}
