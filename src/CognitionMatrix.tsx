import ApprovalCard from './ApprovalCard';
import { locale } from './i18n';
import { t } from './i18n';
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from './api';
import type { Entity, Settings, Snapshot } from './types';
import './matrix.css';
import ThemeArt from './ThemeArt';
import Switch from './Switch';
import { MatrixModel, MatrixTaskSchedule, FileQueueHistory } from './MatrixControls';

const stateName: Record<string, string> = {
  queued: 'Queued',
  running: 'Working',
  done: 'Done',
  failed: 'Failed',
  needs_input: 'Needs input',
  paused: 'Paused',
  idle: 'Ready',
};
function MatrixPreview({
  task,
  onConversation,
}: {
  task: Entity;
  onConversation: (e: Entity) => void;
}) {
  const [value, setValue] = useState<any>(null);
  return (
    <details
      className="matrix-preview"
      onToggle={(e) => {
        if (e.currentTarget.open)
          void api
            .workspace({ action: 'matrix-preview', id: task.id })
            .then(setValue)
            .catch(() => {});
      }}
    >
      <summary>{t('Upcoming & execution history')}</summary>
      {value ? (
        <>
          <small>
            {value.provider} · {value.model || t('No model selected')} · {value.timezone}
          </small>
          <p>
            {value.paused
              ? t('Background AI is paused')
              : !value.integrated
                ? t('List is not integrated')
                : !value.accessible
                  ? t('Edit access is required')
                  : t('Ready for its schedule and dependencies')}
          </p>
          {value.trigger !== 'time' ? (
            <p>
              {t('Event-based trigger')} · {t(value.trigger)}
            </p>
          ) : (
            value.occurrences.map((v: any) => (
              <p key={v.start}>
                {new Date(v.start).toLocaleString()}
                {v.preparation ? (
                  <small>
                    {t('Preparation')} · {new Date(v.preparation).toLocaleString()}
                  </small>
                ) : null}
              </p>
            ))
          )}
          {value.timeline.map((run: any) => (
            <button
              key={run.id}
              onClick={() =>
                void api.bootstrap().then((s) => {
                  const e = s.entities.find((e) => e.id === run.conversation);
                  if (e) onConversation(e);
                })
              }
            >
              {t(run.status)} · {new Date(run.start).toLocaleString()}
              {run.agentName && (
                <small>
                  {run.agentName} · {run.provider} · {run.model}
                </small>
              )}
            </button>
          ))}
        </>
      ) : null}
    </details>
  );
}
function Marker({ state, settings }: { state: string; settings: Settings }) {
  const color =
    state === 'running'
      ? settings.matrixWorkingColor
      : state === 'done'
        ? settings.matrixDoneColor
        : state === 'failed'
          ? settings.matrixFailedColor
          : ['needs_input', 'paused'].includes(state)
            ? settings.matrixAttentionColor
            : settings.matrixQueuedColor;
  const symbol =
    state === 'done'
      ? '✓'
      : state === 'failed'
        ? '✕'
        : ['needs_input', 'paused'].includes(state)
          ? '='
          : state === 'running'
            ? '◌'
            : '○';
  return (
    <span
      className={'matrix-marker ' + (state === 'running' ? 'working' : '')}
      style={{ color }}
      aria-label={t(stateName[state] ?? state)}
      title={t(stateName[state] ?? state)}
    >
      {symbol}
    </span>
  );
}

export default function CognitionMatrix({
  snapshot,
  onError,
  onSettings,
  onConversation,
  initialTask = null,
  onFocus,
}: {
  snapshot: Snapshot;
  onError: (error: any) => void;
  onSettings: () => void;
  onConversation: (conversation: Entity) => void;
  initialTask?: string | null;
  onFocus?: (id: string | null) => void;
}) {
  const items = snapshot.entities.filter((e) => !e.deleted),
    settings = snapshot.settings;
  const lists = ['core', 'secondary', 'tertiary']
    .map((slot) => items.find((e) => e.id === 'matrix-' + slot))
    .filter(Boolean) as Entity[];
  const [integration, setIntegration] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setIntegration((pending) => {
      const confirmed = Object.keys(pending).filter(
        (id) => snapshot.entities.find((e) => e.id === id)?.data.integrated === pending[id],
      );
      if (!confirmed.length) return pending;
      const next = { ...pending };
      confirmed.forEach((id) => delete next[id]);
      return next;
    });
  }, [snapshot.entities]);
  const integrate = async (list: Entity, value: boolean) => {
    setIntegration((pending) => ({ ...pending, [list.id]: value }));
    try {
      await api.mutate({ id: list.id, revision: list.revision, data: { integrated: value } });
    } catch (error) {
      setIntegration((pending) => {
        const next = { ...pending };
        delete next[list.id];
        return next;
      });
      onError(error);
    }
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!initialTask) return;
    setExpanded((old) => {
      const next = new Set(old);
      let item = items.find((e) => e.id === initialTask);
      next.add(initialTask);
      const seen = new Set<string>();
      while (item?.kind === 'matrix-task' && !seen.has(item.id)) {
        seen.add(item.id);
        next.add(item.id);
        item = items.find((e) => e.id === item!.parent);
      }
      return next;
    });
    const timer = setTimeout(
      () =>
        document
          .querySelector(`[data-task-id="${CSS.escape(initialTask)}"]`)
          ?.scrollIntoView({ block: 'nearest' }),
      100,
    );
    return () => clearTimeout(timer);
  }, [initialTask]);
  const [titles, setTitles] = useState<Record<string, string>>({}),
    [replies, setReplies] = useState<Record<string, string>>({});
  const children = (id: string) => items.filter((e) => e.parent === id);
  const descendantTasks = (id: string): Entity[] =>
    children(id)
      .filter((e) => e.kind === 'matrix-task')
      .flatMap((e) => [e, ...descendantTasks(e.id)]);
  const work = async (id: string, fn: () => Promise<any>) => {
    setBusy(id);
    try {
      return await fn();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(null);
    }
  };
  const update = (item: Entity, data: any) =>
    work(item.id, () => api.mutate({ id: item.id, revision: item.revision, data }));
  const action = (id: string, action: string, content?: string) =>
    work(id, () => api.matrixAction({ id, action, content }));
  const add = (parent: string) =>
    work(parent, async () => {
      const title = (titles[parent] ?? '').trim();
      if (!title) return;
      let list = items.find((e) => e.id === parent);
      while (list?.parent) list = items.find((e) => e.id === list?.parent);
      await api.mutate({
        kind: 'matrix-task',
        parent,
        title,
        project: null,
        data: {
          content: '',
          enabled: true,
          status: list?.data.integrated ? 'paused' : 'queued',
          ...(list?.data.integrated
            ? { result: t('Add the task details, then queue it when ready.') }
            : {}),
        },
      });
      setTitles((prior) => ({ ...prior, [parent]: '' }));
    });
  const addForm = (parent: string, subtask = false) => (
    <form
      className="matrix-add"
      onSubmit={(e) => {
        e.preventDefault();
        void add(parent);
      }}
    >
      <input
        aria-label={
          (subtask ? t('New subtask for ') : t('New task in ')) +
          (items.find((e) => e.id === parent)?.title ?? '')
        }
        placeholder={subtask ? t('Add a subtask…') : t('Add a task…')}
        value={titles[parent] ?? ''}
        onChange={(e) => setTitles((v) => ({ ...v, [parent]: e.target.value }))}
      />
      <button
        aria-label={subtask ? t('Add subtask') : t('Add task')}
        disabled={busy === parent || !(titles[parent] ?? '').trim()}
      >
        <span className="add-symbol" aria-hidden="true" />
      </button>
    </form>
  );
  const renderTask = (task: Entity, depth = 0): React.ReactNode => {
    let owner = task;
    while (owner.parent && owner.kind !== 'matrix-list')
      owner = snapshot.entities.find((e) => e.id === owner.parent) || { ...owner, parent: null };
    const isOpen = expanded.has(task.id),
      state = task.data.status ?? 'queued';
    const subtasks = children(task.id).filter((e) => e.kind === 'matrix-task');
    const files = children(task.id).filter((e) => e.kind === 'matrix-file');
    const responses = children(task.id).filter((e) => e.kind === 'matrix-entry');
    const pending = (snapshot.approvals ?? []).filter(
      (e) => e.conversation === task.data.conversation,
    );
    const toggle = () => {
      onFocus?.(isOpen ? null : task.id);
      setExpanded((v) => {
        const next = new Set(v);
        next.has(task.id) ? next.delete(task.id) : next.add(task.id);
        return next;
      });
    };
    return (
      <article
        key={task.id}
        data-task-id={task.id}
        className={
          'matrix-task ' + (depth ? 'subtask ' : '') + (state === 'running' ? 'active-task' : '')
        }
      >
        <div className="matrix-task-row">
          <button
            className="matrix-check"
            aria-label={
              (state === 'done'
                ? t('Reopen ')
                : state === 'queued'
                  ? t('Mark complete ')
                  : t('Open task ')) + task.title
            }
            disabled={busy === task.id || snapshot.matrixActive?.task === task.id}
            onClick={() => {
              if (['queued', 'done'].includes(state))
                void action(task.id, state === 'done' ? 'retry' : 'complete');
              else toggle();
            }}
          >
            <Marker state={state} settings={settings} />
          </button>
          <button className="matrix-task-title" onClick={toggle} aria-expanded={isOpen}>
            <span>{task.title}</span>
            <small>
              {task.data.trigger?.mode === 'inbox' && ['done', 'queued'].includes(state)
                ? t(
                    owner.data.integrated &&
                      task.data.enabled !== false &&
                      !settings.backgroundPaused
                      ? 'Monitoring'
                      : 'Paused',
                  )
                : state === 'paused' && !task.data.startedAt
                  ? t('Draft')
                  : t(stateName[state])}
              {subtasks.length
                ? ` · ${subtasks.filter((e) => e.data.status === 'done').length}/${subtasks.length} subtasks`
                : ''}
              {files.length ? ` · ${files.length} files` : ''}
            </small>
          </button>
          <button
            className="matrix-expand"
            aria-label={(isOpen ? t('Collapse ') : t('Expand ')) + task.title}
            onClick={toggle}
          >
            {isOpen ? '⌃' : '⌄'}
          </button>
        </div>
        {isOpen ? (
          <div className="matrix-task-details">
            <label>
              {t('Task name')}
              <input
                aria-label={t('Task name for ') + task.title}
                key={task.id + task.title}
                defaultValue={task.title}
                onBlur={(e) => {
                  if (e.target.value.trim() !== task.title)
                    void work(task.id, () =>
                      api.mutate({ id: task.id, revision: task.revision, title: e.target.value }),
                    );
                }}
              />
            </label>
            <label>
              {t('Description')}
              <textarea
                aria-label={t('Description for ') + task.title}
                key={task.id + (task.data.content ?? '')}
                defaultValue={task.data.content ?? ''}
                rows={4}
                placeholder={t('What should Intelligence do? Include the expected result.')}
                onBlur={(e) => {
                  if (e.target.value !== (task.data.content ?? ''))
                    void update(task, { content: e.target.value });
                }}
              />
            </label>
            {task.data.schedule?.start ? (
              <p className="matrix-schedule">
                <b>{t('Next scheduled run')}</b> ·{' '}
                {new Date(task.data.schedule.start).toLocaleString(locale(), {
                  timeZone: task.data.schedule.timezone,
                })}{' '}
                · {task.data.schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}{' '}
                · {t(task.data.schedule.repeat ?? 'none')}
              </p>
            ) : null}
            <label>
              {t('Result format')}
              <select
                aria-label={t('Result format for ') + task.title}
                value={task.data.output ?? 'auto'}
                onChange={(e) => void update(task, { output: e.target.value })}
              >
                <option value="auto">{t('Agent chooses')}</option>
                <option value="answer">{t('Answer on task')}</option>
                <option value="report">{t('Attached report file')}</option>
              </select>
            </label>
            <MatrixPreview task={task} onConversation={onConversation} />
            {task.data.trigger?.mode === 'inbox' && <FileQueueHistory task={task} />}
            <MatrixTaskSchedule
              task={task}
              snapshot={snapshot}
              update={(data) => update(task, data)}
            />
            <div className="matrix-task-actions">
              <button
                disabled={busy === task.id || !snapshot.desktop}
                onClick={() => void work(task.id, () => api.matrixAttach(task.id))}
              >
                {t('Attach files / images')}
              </button>
              <button
                disabled={busy === task.id || !snapshot.desktop}
                onClick={() =>
                  void work(task.id, async () =>
                    onConversation(await api.matrixAction({ action: 'conversation', id: task.id })),
                  )
                }
              >
                {t('Conversation ↗')}
              </button>
              {snapshot.matrixActive?.task === task.id ||
              (task.data.trigger?.mode === 'inbox' && ['queued', 'done'].includes(state)) ? (
                <button onClick={() => void action(task.id, 'pause')}>{t('Pause')}</button>
              ) : ['failed', 'needs_input', 'paused'].includes(state) ? (
                <button onClick={() => void action(task.id, 'retry')}>
                  {state === 'paused' && !task.data.startedAt
                    ? t('Queue task')
                    : state === 'failed'
                      ? t('Retry task')
                      : t('Resume task')}
                </button>
              ) : null}
              <button
                className="danger"
                disabled={snapshot.matrixActive?.task === task.id}
                onClick={() =>
                  void work(task.id, () => api.mutate({ id: task.id, action: 'trash' }))
                }
              >
                {t('Move to Trash')}
              </button>
            </div>
            {files.length ? (
              <div className="matrix-files">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className={file.data.generated ? 'matrix-file output' : 'matrix-file'}
                  >
                    {String(file.data.mime).startsWith('image/') ? (
                      <img src={'intelligence-media://matrix/' + file.id} alt={file.title} />
                    ) : (
                      <span>{file.data.generated ? '↗' : '▧'}</span>
                    )}
                    <button onClick={() => void work(file.id, () => api.matrixOpenFile(file.id))}>
                      {file.title}
                      <small>
                        {file.data.generated ? t('Report') : t('Attachment')} ·{' '}
                        {(file.data.size / 1024).toFixed(0)} KB
                      </small>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t('Remove attachment ') + file.title}
                      onClick={() =>
                        void work(file.id, () => api.mutate({ id: file.id, action: 'trash' }))
                      }
                    >
                      ×
                    </button>
                    <button
                      className="icon-button"
                      title={t('Save copy')}
                      aria-label={t('Save a copy of ') + file.title}
                      disabled={!snapshot.desktop}
                      onClick={() => void work(file.id, () => api.matrixExportFile(file.id))}
                    >
                      ↓
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {pending.map((request) => (
              <ApprovalCard
                key={request.id}
                request={request}
                onError={(message) => onError(new Error(message))}
              />
            ))}
            {task.data.result && task.data.result !== responses.at(-1)?.data.content ? (
              <div className={'matrix-result ' + state}>
                <b>{t(stateName[state])}</b>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.data.result}</ReactMarkdown>
                {task.data.verification ? (
                  <small>
                    {t('Verification:')} {task.data.verification}
                  </small>
                ) : null}
              </div>
            ) : null}
            {responses.length ? (
              <div className="matrix-responses">
                <h4>{t('Latest response')}</h4>
                {responses.slice(-1).map((response) => (
                  <div
                    key={response.id}
                    className={response.data.role === 'user' ? 'user-response' : ''}
                  >
                    <small>
                      {response.data.role === 'user' ? t('You') : settings.agentName} ·{' '}
                      {new Date(response.created).toLocaleTimeString(locale())}
                    </small>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {response.data.content}
                    </ReactMarkdown>
                  </div>
                ))}
                {responses.length > 1 ? (
                  <details className="matrix-response-history">
                    <summary>
                      {responses.length - 1} {t('earlier responses')}
                    </summary>
                    {responses.slice(0, -1).map((response) => (
                      <div key={response.id}>
                        <small>
                          {response.data.role === 'user' ? t('You') : settings.agentName} ·{' '}
                          {new Date(response.created).toLocaleString(locale())}
                        </small>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {response.data.content}
                        </ReactMarkdown>
                      </div>
                    ))}
                  </details>
                ) : null}
              </div>
            ) : null}
            {task.data.verification && task.data.result === responses.at(-1)?.data.content ? (
              <small className="matrix-verification">
                {t('Verification:')} {task.data.verification}
              </small>
            ) : null}
            {['needs_input', 'failed', 'paused', 'done'].includes(state) &&
            snapshot.matrixActive?.task !== task.id ? (
              <form
                className="matrix-reply"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = replies[task.id] ?? '';
                  if (text.trim())
                    void work(task.id, async () => {
                      await api.matrixAction({ action: 'reply', id: task.id, content: text });
                      setReplies((v) => ({ ...v, [task.id]: '' }));
                    });
                }}
              >
                <textarea
                  aria-label={t('Reply to ') + task.title}
                  value={replies[task.id] ?? ''}
                  rows={2}
                  placeholder={t('Answer a question or give follow-up instructions…')}
                  onChange={(e) => setReplies((v) => ({ ...v, [task.id]: e.target.value }))}
                />
                <button disabled={busy === task.id || !(replies[task.id] ?? '').trim()}>
                  {t('Send & queue')}
                </button>
              </form>
            ) : null}
            <section className="matrix-subtasks">
              <h4>{t('Subtasks')}</h4>
              {subtasks.map((subtask) => renderTask(subtask, depth + 1))}
              {depth < 7 ? addForm(task.id, true) : null}
            </section>
          </div>
        ) : null}
      </article>
    );
  };
  const activeTask = items.find((e) => e.id === snapshot.matrixActive?.task),
    activeList = items.find((e) => e.id === snapshot.matrixActive?.list);
  return (
    <div
      className={'page-pad matrix-page' + (settings.matrixCompactRows ? ' compact' : '')}
      style={{ '--matrix-working': settings.matrixWorkingColor } as React.CSSProperties}
    >
      <header className="page-heading">
        <ThemeArt category={2} className="section-art" variant="banner" />
        <div>
          <span className="eyebrow">{t('GLOBAL WORKSPACE')}</span>
          <h1>{t('Cognition Matrix')}</h1>
          <p>{t('Three lists. A shared queue. Answers and reports stay with their tasks.')}</p>
        </div>
        <button onClick={onSettings}>{t('Matrix settings ↗')}</button>
      </header>
      <div className="matrix-monitor" role="status">
        <span
          className={'status-dot ' + (lists.some((e) => e.data.integrated) ? 'connected' : '')}
        />
        {activeTask
          ? `${activeTask.data.awaitingApproval ? t('Awaiting approval') : t('Working')} · ${activeList?.title} / ${activeTask.title}`
          : !snapshot.desktop && lists.some((e) => e.data.integrated)
            ? t('Queue ready · Open the desktop app to run it')
            : !settings.matrixAccess && lists.some((e) => e.data.integrated)
              ? t('Enable Matrix access in Settings to run these lists')
              : lists.some((e) => e.data.integrated)
                ? snapshot.matrixPreparation
                  ? t('Preparing task model')
                  : t('Waiting for scheduled times and triggers')
                : t('Enable Integrate Matrix on a list to start its queue')}
        <small>
          {settings.matrixScheduling === 'priority'
            ? t('Core-first priority')
            : t('Lists take turns')}
        </small>
      </div>
      <div className="matrix-columns">
        {lists.map((list) => {
          const tasks = children(list.id).filter((e) => e.kind === 'matrix-task'),
            allTasks = descendantTasks(list.id);
          const state =
            snapshot.matrixActive?.list === list.id
              ? activeTask?.data.awaitingApproval
                ? 'needs_input'
                : 'running'
              : list.data.attention ||
                  allTasks.some((e) => ['needs_input', 'paused'].includes(e.data.status))
                ? 'needs_input'
                : allTasks.some((e) => e.data.status === 'running')
                  ? 'running'
                  : allTasks.some((e) => e.data.status === 'failed')
                    ? 'failed'
                    : tasks.length && tasks.every((e) => e.data.status === 'done')
                      ? 'done'
                      : tasks.length
                        ? 'queued'
                        : 'idle';
          return (
            <section
              className={
                'matrix-list ' + (snapshot.matrixActive?.list === list.id ? 'active-list' : '')
              }
              key={list.id}
              aria-label={list.title + t(' Matrix list')}
            >
              <header>
                <div>
                  <Marker state={state} settings={settings} />
                  <h2>{list.title}</h2>
                  <small>
                    {tasks.filter((e) => e.data.status === 'done').length}/{tasks.length}
                  </small>
                </div>
                <label className="matrix-integrate">
                  <Switch
                    aria-label={t('Integrate Matrix ') + list.title}
                    checked={integration[list.id] ?? list.data.integrated === true}
                    onChange={(e) => void integrate(list, e.target.checked)}
                  />
                  {t('Integrate Matrix')}
                </label>
              </header>
              <details className="matrix-configuration">
                <summary>{t('Configuration')}</summary>
                <MatrixModel
                  embedded
                  list={list}
                  snapshot={snapshot}
                  update={(data) => update(list, data)}
                  onError={onError}
                />
                {list.data.modelNotice ? (
                  <p className="matrix-model-notice" role="status">
                    {list.data.modelNotice}
                  </p>
                ) : null}
                {list.data.description ? (
                  <p className="matrix-list-description">{list.data.description}</p>
                ) : null}
                <details className="matrix-list-edit" open>
                  <summary>{t('Edit list context')}</summary>
                  {list.data.slot !== 'core' ? (
                    <label>
                      {t('Name')}
                      <input
                        aria-label={t('Name for ') + list.data.slot}
                        key={list.id + list.title}
                        defaultValue={list.title}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== list.title)
                            void work(list.id, () =>
                              api.mutate({
                                id: list.id,
                                revision: list.revision,
                                title: e.target.value,
                              }),
                            );
                        }}
                      />
                    </label>
                  ) : null}
                  <label>
                    {t('Description')}
                    <textarea
                      aria-label={t('List description for ') + list.title}
                      key={list.id + (list.data.description ?? '')}
                      defaultValue={list.data.description ?? ''}
                      rows={3}
                      placeholder={t('Context the agent should use for every task in this list.')}
                      onBlur={(e) => {
                        if (e.target.value !== (list.data.description ?? ''))
                          void update(list, { description: e.target.value });
                      }}
                    />
                  </label>
                </details>
              </details>
              {list.data.attention ? (
                <div className="matrix-list-attention">
                  <Marker state="needs_input" settings={settings} />
                  <p>{list.data.attention.message}</p>
                  <button onClick={() => void action(list.id, 'clear-attention')}>
                    {t('Resume list')}
                  </button>
                </div>
              ) : null}
              <div className="matrix-task-list">
                {tasks
                  .filter((task) => settings.matrixShowCompleted || task.data.status !== 'done')
                  .map((task) => renderTask(task))}
              </div>
              {!settings.matrixShowCompleted &&
              tasks.some((task) => task.data.status === 'done') ? (
                <p className="matrix-empty">
                  {tasks.filter((task) => task.data.status === 'done').length}{' '}
                  {t('completed tasks hidden')}
                </p>
              ) : null}
              {!tasks.length ? <p className="matrix-empty">{t('Add the first task.')}</p> : null}
              {addForm(list.id)}
            </section>
          );
        })}
      </div>
    </div>
  );
}
