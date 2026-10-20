import { useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Settings } from './types';
import type { HelpArticle } from './HelpGuide';
import { initialSetup } from '../electron/onboarding.mjs';
import './setup.css';
export default function FeatureLesson({
  article,
  settings,
  onClose,
  onChanged,
}: {
  article: HelpArticle;
  settings: Settings;
  onClose: () => void;
  onChanged: () => Promise<any>;
}) {
  const steps = article.lesson || [];
  const saved = settings.onboarding?.lessons[article.id] || 0;
  const [step, setStep] = useState(saved < steps.length ? saved : 0),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const move = async (next: number, close = false) => {
    setBusy(true);
    try {
      const current = (await api.bootstrap()).settings.onboarding || {
        ...initialSetup,
        status: settings.onboardingComplete ? ('completed' as const) : ('deferred' as const),
      };
      await api.settings({
        onboarding: { ...current, lessons: { ...current.lessons, [article.id]: next } },
      });
      await onChanged();
      if (close) onClose();
      else setStep(next);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="feature-lesson" role="region" aria-label={t('Feature lesson')}>
      <header>
        <b>{article.title}</b>
        <button aria-label={t('Close lesson')} onClick={() => void move(step, true)}>
          ×
        </button>
      </header>
      <small>
        {step + 1} / {steps.length}
      </small>
      <p>{steps[step]}</p>
      <small>
        {t(
          'Try the action yourself, then continue. Your current drafts and conversation stay available.',
        )}
      </small>
      {notice && <p role="alert">{t(notice)}</p>}
      <footer>
        <button disabled={!step || busy} onClick={() => void move(step - 1)}>
          {t('Back')}
        </button>
        <button disabled={busy} onClick={() => void move(step, true)}>
          {t('Save & exit')}
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void move(step + 1, step === steps.length - 1)}
        >
          {t(step === steps.length - 1 ? 'Finish lesson' : 'Next')}
        </button>
      </footer>
    </aside>
  );
}
