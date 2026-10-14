import { lazy, Suspense, useState, type ReactNode } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Entity, Settings } from './types';
const Report = lazy(() => import('./ReportReader').then((m) => ({ default: m.TaskReportReader })));
export default function TaskDetail({
  card,
  settings,
  entities,
  menu,
  onPatch,
  onBack,
  onOpen,
  onAttach,
  onConversation,
  onError,
}: {
  card: Entity;
  settings: Settings;
  entities: Entity[];
  menu: ReactNode;
  onPatch: (data: any) => Promise<any>;
  onBack: () => void;
  onOpen: (e: Entity) => void;
  onAttach: () => void;
  onConversation: (id: string) => void;
  onError: (e: any) => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [tab, setTab] = useState('details');
  const agentAccess = card.agentAccess === true;
  const local = (value: string) => {
    const d = new Date(value);
    return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const action = (fn: () => Promise<any>) => void fn().catch(onError);
  return (
    <section className="task-detail-expanded" data-agent-access={agentAccess}>
      <div className="card-status">
        <span className="pill">{t(card.data.status || 'queued')}</span>
        {menu}
        <button className="quiet-button" onClick={onBack}>
          {t('Back to board ↗')}
        </button>
      </div>
      <nav className="task-detail-tabs">
        {[['details', 'Task details'], ...(agentAccess ? [['report', 'Agent Report']] : [])].map(
          ([v, l]) => (
            <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)}>
              {t(l)}
            </button>
          ),
        )}
      </nav>
      <div className="task-detail-layout" data-tab={agentAccess ? tab : 'details'}>
        <section className="task-detail-form">
          <label>
            {t('Instructions')}
            <textarea
              key={card.id + 'content'}
              defaultValue={card.data.content || ''}
              rows={4}
              onBlur={(e) => action(() => onPatch({ content: e.target.value }))}
              placeholder={t('What should be done?')}
            />
          </label>
          <label>
            {t('Completion criteria')}
            <textarea
              key={card.id + 'criteria'}
              defaultValue={card.data.criteria || ''}
              rows={2}
              onBlur={(e) => action(() => onPatch({ criteria: e.target.value }))}
              placeholder={t('What does a good result look like?')}
            />
          </label>
          {agentAccess && (
            <label>
              {t('Assignment')}
              <select
                aria-label={t('Card assignment')}
                value={card.data.assigned == null ? 'inherit' : card.data.assigned ? 'yes' : 'no'}
                onChange={(e) =>
                  action(() =>
                    onPatch({
                      assigned: e.target.value === 'inherit' ? null : e.target.value === 'yes',
                    }),
                  )
                }
              >
                <option value="inherit">{t('Inherit assignment')}</option>
                <option value="yes">{t('Agent task')}</option>
                <option value="no">{t('Manual only')}</option>
              </select>
              <small>
                {t(
                  'Board and list assignment applies when inherited. Manual only prevents automatic work.',
                )}
              </small>
            </label>
          )}
          <div className="schedule-grid">
            <label>
              {t('Start at')}
              <input
                type="datetime-local"
                value={card.data.schedule?.start ? local(card.data.schedule.start) : ''}
                onChange={(e) =>
                  action(() =>
                    onPatch({
                      schedule: {
                        start: e.target.value ? new Date(e.target.value).toISOString() : null,
                      },
                    }),
                  )
                }
              />
            </label>
            <label>
              {t('Repeat')}
              <select
                aria-label={t('Repeat')}
                value={card.data.schedule?.repeat || 'none'}
                onChange={(e) => action(() => onPatch({ schedule: { repeat: e.target.value } }))}
              >
                <option value="none">{t('Once')}</option>
                <option value="daily">{t('Every day')}</option>
                <option value="weekly">{t('Every week')}</option>
              </select>
            </label>
            <label>
              {t('Estimated minutes')}
              <input
                type="number"
                min="1"
                value={card.data.schedule?.estimate || ''}
                onChange={(e) =>
                  action(() => onPatch({ schedule: { estimate: Number(e.target.value) } }))
                }
              />
            </label>
            {agentAccess && (
              <label>
                {t('Maximum running minutes')}
                <input
                  type="number"
                  min="1"
                  max="480"
                  value={card.data.schedule?.maxMinutes || 30}
                  onChange={(e) =>
                    action(() => onPatch({ schedule: { maxMinutes: Number(e.target.value) } }))
                  }
                />
              </label>
            )}
          </div>
          <small className="muted">
            {t('Times use')} {Intl.DateTimeFormat().resolvedOptions().timeZone}
            {t('. The computer and Intelligence must be running.')}
          </small>
          {agentAccess && (
            <div className="task-actions">
              <button
                className="primary"
                disabled={!card.agentEditable || !card.agentAssigned}
                onClick={() => action(() => api.runTask(card.id))}
              >
                {t('▶ Run now')}
              </button>
              <button onClick={() => action(() => api.stopTask(card.id))}>{t('Pause')}</button>
              <button onClick={() => action(() => onPatch({ status: 'queued' }))}>
                {t('Queue again')}
              </button>
              <button onClick={() => action(() => api.completeTask(card.id))}>
                {t('Mark complete')}
              </button>
              <button onClick={onAttach}>{t('＋ Attach context')}</button>
            </div>
          )}
          <div className="task-linked-context">
            {(card.data.links || [])
              .map((id: string) => entities.find((e) => e.id === id))
              .filter(Boolean)
              .map((e: Entity) => (
                <button key={e.id} onClick={() => onOpen(e)}>
                  {e.title} ↗
                </button>
              ))}
          </div>
        </section>
        {agentAccess && (
          <aside className="task-agent-report">
            <header>
              <h2>{t('Agent Report')}</h2>
              <button onClick={() => setExpanded(true)}>{t('Expand Report')} ↗</button>
            </header>
            <small>
              {t(
                card.data.status === 'running'
                  ? 'Previous output · new run in progress'
                  : 'Latest saved output',
              )}
            </small>
            <article className="task-report-preview">
              {card.data.result ? (
                <p>{String(card.data.result).slice(0, 6000)}</p>
              ) : (
                <p className="empty">{t('No agent report yet.')}</p>
              )}
              {String(card.data.result || '').length > 6000 && (
                <small>{t('Expand to read more')}</small>
              )}
            </article>
            <footer>
              {card.data.conversation && (
                <button onClick={() => onConversation(card.data.conversation)}>
                  {t('Open task conversation ↗')}
                </button>
              )}
              <small>
                {t(
                  'The preview may be a completion summary. Expand shows the saved final response when available.',
                )}
              </small>
            </footer>
          </aside>
        )}
      </div>
      {agentAccess && expanded && (
        <Suspense fallback={<p>{t('Opening report…')}</p>}>
          <Report
            task={card}
            onClose={() => setExpanded(false)}
            onConversation={(id) => {
              setExpanded(false);
              onConversation(id);
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
