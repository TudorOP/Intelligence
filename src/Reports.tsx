import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api, allowed } from './api';
import { t } from './i18n';
import type { Entity, Settings, Snapshot } from './types';
import Modal from './Modal';
import Switch from './Switch';
import ActionMenu from './ActionMenu';
import TimingEditor, { timingDefault } from './TimingEditor';
import { useMarqueeSelection } from './Selection';
const Reader = lazy(() => import('./ReportReader'));
const types = [
  ['calendar', 'Calendar agenda'],
  ['tasks', 'Task progress'],
  ['projects', 'Project digest'],
  ['research', 'Online briefing'],
  ['custom', 'Custom section'],
];
function preset(name: string, agent: string) {
  const timing = {
    ...timingDefault(),
    repeat: name === 'topic' ? 'none' : name === 'weekly' ? 'weekly' : 'daily',
  };
  const sections =
    name === 'topic'
      ? [
          {
            id: crypto.randomUUID(),
            type: 'research',
            title: 'Topic research',
            prompt: '',
            sources: [],
            enabled: true,
          },
        ]
      : [
          {
            id: crypto.randomUUID(),
            type: 'calendar',
            title: 'Your day',
            prompt: '',
            sources: [],
            enabled: true,
            calendarMode: 'personal',
          },
          {
            id: crypto.randomUUID(),
            type: 'tasks',
            title: 'Task progress',
            prompt: 'Summarize recorded progress and items needing review.',
            sources: [],
            enabled: true,
          },
        ];
  if (name === 'morning')
    sections.push({
      id: crypto.randomUUID(),
      type: 'research',
      title: 'Topic research',
      prompt: '',
      sources: [],
      enabled: true,
    } as any);
  return {
    title:
      name === 'evening'
        ? 'Evening review'
        : name === 'weekly'
          ? 'Weekly project review'
          : name === 'topic'
            ? 'Topic research'
            : 'Morning briefing',
    data: {
      agentProfile: agent,
      enabled: false,
      access: true,
      permission: 'read',
      timing,
      sections,
      coverage: { mode: name === 'weekly' ? 'week' : 'today' },
      length: 'standard',
      preferences: '',
      delivery: 'notify',
      images: false,
    },
  };
}
function blankReport(agent: string, title: string) {
  const v = preset('topic', agent);
  return {
    ...v,
    title,
    data: {
      ...v.data,
      sections: [
        {
          id: crypto.randomUUID(),
          type: 'custom',
          title: t('Custom section'),
          prompt: '',
          sources: [],
          enabled: true,
        },
      ],
    },
  };
}
export default function Reports({
  snapshot,
  onChanged,
  onSettings,
  onError,
  onOpen,
  initialId,
  initialTemplate,
  onTemplateHandled,
  onHandled,
  onAsk,
}: {
  snapshot: Snapshot;
  onChanged: () => Promise<any>;
  onSettings: (s: Partial<Settings>) => Promise<any>;
  onError: (e: any) => void;
  onOpen: (id: string) => void;
  initialId?: string | null;
  initialTemplate?: string | null;
  onTemplateHandled?: () => void;
  onHandled?: () => void;
  onAsk: (e: Entity) => void;
}) {
  const profiles = snapshot.entities.filter((e) => e.kind === 'agent-profile'),
    templates = snapshot.entities.filter((e) => e.kind === 'report-template');
  const [rows, setRows] = useState<Entity[]>([]),
    [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [reader, setReader] = useState<Entity | null>(null),
    [draft, setDraft] = useState<any>(null),
    [tab, setTab] = useState('content'),
    [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [gallery, setGallery] = useState(false),
    [templateQuery, setTemplateQuery] = useState(''),
    [oneOff, setOneOff] = useState(false),
    [profileFilter, setProfileFilter] = useState(''),
    [dateFrom, setDateFrom] = useState(''),
    [dateTo, setDateTo] = useState('');
  const anchor = useRef<string | null>(null);
  const marquee = useMarqueeSelection('.report-selection-list', selected, setSelected, anchor);
  const listInput = {
    action: 'reports-list',
    outputs: true,
    query,
    filter,
    profile: profileFilter,
    from: dateFrom,
    to: dateTo,
  };
  const signature = snapshot.entities
    .filter((e) => e.kind === 'report')
    .map((e) => e.id + ':' + e.revision)
    .join(',');
  useEffect(() => {
    let live = true;
    setSelected(new Set());
    const timer = setTimeout(() => {
      void api
        .workspace({ ...listInput, offset: 0 })
        .then((v) => {
          if (live) {
            setRows(v.filter((e: Entity) => e.kind === 'report'));
            setOffset(80);
          }
        })
        .catch(onError);
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [signature, query, filter, profileFilter, dateFrom, dateTo]);
  useEffect(() => {
    if (initialId) {
      const e = snapshot.entities.find((e) => e.id === initialId && e.kind === 'report');
      if (e) {
        setReader(e);
        onHandled?.();
      }
    }
  }, [initialId]);
  const edit = (v: any, custom = false) => {
    setGallery(false);
    setOneOff(custom);
    setDraft(structuredClone(v));
    setTab('content');
    setPreview(null);
  };
  useEffect(() => {
    if (!initialTemplate) return;
    const e = templates.find((v) => v.id === initialTemplate);
    if (e) edit(e);
    onTemplateHandled?.();
  }, [initialTemplate]);
  const patch = (v: any) => setDraft({ ...draft, data: { ...draft.data, ...v } });
  const act = async (input: any) => {
    setBusy(true);
    try {
      const result = await api.workspace(input);
      await onChanged();
      return result;
    } catch (e) {
      onError(e);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const openRow = (e: Entity, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setSelected((old) => {
        const n = new Set(old);
        const a = rows.findIndex((v) => v.id === anchor.current),
          b = rows.findIndex((v) => v.id === e.id);
        if (event.shiftKey && a >= 0)
          rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((v) => n.add(v.id));
        else {
          n.has(e.id) ? n.delete(e.id) : n.add(e.id);
          anchor.current = e.id;
        }
        return n;
      });
    } else {
      anchor.current = e.id;
      setReader(e);
    }
  };
  const visible = rows;
  const sectionPatch = (i: number, v: any) =>
    patch({
      sections: draft.data.sections.map((s: any, n: number) => (i === n ? { ...s, ...v } : s)),
    });
  return (
    <div className="page-pad reports-page">
      <header className="planning-header">
        <div>
          <span className="eyebrow">{t('YOUR BRIEFINGS')}</span>
          <h1>{t('Reports')}</h1>
          <p>{t('Turn your work into clear, useful summaries.')}</p>
        </div>
        <div>
          <button className="primary" onClick={() => setGallery(true)}>
            {t('New report')}
          </button>
        </div>
      </header>
      <div className="reports-workspace">
        <aside className="report-library-nav">
          {[
            ['all', 'All reports'],
            ['unread', 'Unread'],
            ['daily', 'Daily briefings'],
            ['custom', 'Custom reports'],
          ].map(([v, l]) => (
            <button
              key={v}
              aria-current={filter === v ? 'page' : undefined}
              onClick={() => {
                setFilter(v);
                setSelected(new Set());
              }}
            >
              {t(l)}
            </button>
          ))}
          <label className="switch-line">
            {t('Automatic reports')}
            <Switch
              aria-label={t('Automatic reports')}
              checked={snapshot.settings.reportsAutomation}
              onChange={(e) => void onSettings({ reportsAutomation: e.target.checked })}
            />
          </label>
        </aside>
        <section className="report-library">
          <div className="collection-heading">
            <input
              aria-label={t('Search reports')}
              placeholder={t('Search reports…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label={t('Report agent filter')}
              value={profileFilter}
              onChange={(e) => setProfileFilter(e.target.value)}
            >
              <option value="">{t('All agents')}</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div className="report-date-filters">
            <label>
              {t('From')}
              <input
                type="date"
                aria-label={t('Reports from date')}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label>
              {t('To')}
              <input
                type="date"
                aria-label={t('Reports to date')}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </div>
          {selected.size > 0 && (
            <div className="local-bulk-bar">
              <span>
                {selected.size} {t('selected')}
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  void api
                    .workspace({
                      action: 'bulk',
                      operation: 'trash',
                      items: rows
                        .filter((e) => selected.has(e.id))
                        .map((e) => ({ id: e.id, revision: e.revision })),
                    })
                    .then(() => {
                      setSelected(new Set());
                      return onChanged();
                    })
                    .catch(onError)
                }
              >
                {t('Move to Trash')}
              </button>
              <button onClick={() => setSelected(new Set())}>{t('Clear selection')}</button>
            </div>
          )}
          <div className="report-selection-list" data-selection-surface>
            {marquee}
            {visible.map((e) => (
              <article
                key={e.id}
                className="report-library-row"
                data-selection-id={e.id}
                data-selected={selected.has(e.id)}
              >
                <button onClick={(event) => openRow(e, event)}>
                  <span>{e.data.unread ? '●' : '▤'}</span>
                  <div>
                    <b>{e.title}</b>
                    <small>
                      {new Date(e.created).toLocaleString()} · {e.data.agentName} ·{' '}
                      {t(e.data.status)}
                    </small>
                    <p>{e.data.summary?.slice(0, 160) || e.data.error}</p>
                  </div>
                </button>
                <ActionMenu label={t('Report actions')}>
                  <button onClick={() => setReader(e)}>{t('Open report')}</button>
                  <button onClick={() => onAsk(e)}>{t('Ask agent')}</button>
                  <button
                    className="danger"
                    onClick={() => void act({ action: 'reports-trash', id: e.id })}
                  >
                    {t('Move to Trash')}
                  </button>
                </ActionMenu>
              </article>
            ))}
            {!visible.length && (
              <p className="empty">
                {t('No reports yet. Create a template and run it when ready.')}
              </p>
            )}
          </div>
          {rows.length >= offset && rows.length > 0 && (
            <button
              onClick={() =>
                void api
                  .workspace({ ...listInput, offset })
                  .then((v) => {
                    setRows((old) => [
                      ...old,
                      ...v.filter(
                        (e: Entity) => e.kind === 'report' && !old.some((r) => r.id === e.id),
                      ),
                    ]);
                    setOffset(offset + 80);
                  })
                  .catch(onError)
              }
            >
              {t('Load more')}
            </button>
          )}
        </section>
        <aside className="report-schedules">
          <h2>{t('Report schedules')}</h2>
          {templates.map((p) => (
            <article key={p.id}>
              <label className="switch-line">
                <b>{p.title}</b>
                <Switch
                  checked={p.data.enabled}
                  aria-label={p.title + ' ' + t('Enabled')}
                  data-tooltip={t(
                    'Enable this report schedule. Automatic reports must also be on, Intelligence open, and background AI running.',
                  )}
                  onChange={(e) =>
                    void act({
                      action: 'reports-save',
                      id: p.id,
                      revision: p.revision,
                      title: p.title,
                      data: { ...p.data, enabled: e.target.checked },
                    })
                  }
                />
              </label>
              <small>
                {profiles.find((a) => a.id === p.data.agentProfile)?.title ||
                  t('Agent unavailable')}
              </small>
              <p>
                {p.data.enabled && p.data.nextRun
                  ? new Date(p.data.nextRun).toLocaleString()
                  : t('On demand')}
              </p>
              {p.data.attention && (
                <p className="notice" role="status">
                  {t(p.data.attention)}
                </p>
              )}
              <div>
                <button onClick={() => edit(p)}>{t('Configure')}</button>
                {p.data.attention && (
                  <button onClick={() => void act({ action: 'reports-skip', id: p.id })}>
                    {t('Skip occurrence')}
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => void act({ action: 'reports-run', id: p.id })}
                >
                  {t('Run now')}
                </button>
                <ActionMenu label={t('Schedule actions')}>
                  <button onClick={() => edit(p)}>{t('Edit schedule')}</button>
                  <button
                    onClick={() =>
                      edit({
                        ...p,
                        id: undefined,
                        revision: undefined,
                        title: p.title + ' · ' + t('Copy'),
                        data: { ...p.data, enabled: false, nextRun: null, attention: '' },
                      })
                    }
                  >
                    {t('Duplicate')}
                  </button>
                  <button
                    onClick={() =>
                      void act({
                        action: 'reports-save',
                        id: p.id,
                        revision: p.revision,
                        title: p.title,
                        data: { ...p.data, enabled: false, attention: '' },
                      })
                    }
                  >
                    {t('Disable')}
                  </button>
                  <button
                    className="danger"
                    onClick={() => void act({ action: 'reports-trash', id: p.id })}
                  >
                    {t('Move to Trash')}
                  </button>
                </ActionMenu>
              </div>
            </article>
          ))}
        </aside>
      </div>
      {gallery && (
        <Modal
          title={t('New report')}
          className="report-template-library"
          onClose={() => setGallery(false)}
        >
          <div className="template-library-toolbar">
            <input
              aria-label={t('Search templates')}
              placeholder={t('Search templates…')}
              value={templateQuery}
              onChange={(e) => setTemplateQuery(e.target.value)}
            />
            <button
              onClick={() => edit(blankReport(snapshot.settings.activeAgent, t('New template')))}
            >
              {t('Create template')}
            </button>
            <button
              className="primary"
              onClick={() =>
                edit(blankReport(snapshot.settings.activeAgent, t('Custom report')), true)
              }
            >
              {t('New custom report')}
            </button>
          </div>
          <div className="template-library-content">
            <h3>{t('Your templates')}</h3>
            <div className="report-template-grid">
              {templates
                .filter((e) =>
                  e.title.toLocaleLowerCase().includes(templateQuery.toLocaleLowerCase()),
                )
                .map((e) => (
                  <article key={e.id}>
                    <h4>{e.title}</h4>
                    <small>
                      {profiles.find((p) => p.id === e.data.agentProfile)?.title ||
                        t('Agent unavailable')}
                    </small>
                    <p>
                      {e.data.sections.length}{' '}
                      {t(e.data.sections.length === 1 ? 'section' : 'sections')} ·{' '}
                      {t(e.data.enabled ? 'Scheduled' : 'On demand')}
                    </p>
                    <div>
                      <button onClick={() => edit(e)}>{t('Edit template')}</button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act({ action: 'reports-run', id: e.id }).then((result) => {
                            if (result) setGallery(false);
                          })
                        }
                      >
                        {t('Run now')}
                      </button>
                    </div>
                  </article>
                ))}
            </div>
            {!templates.length && <p className="empty">{t('No saved templates yet.')}</p>}
            <h3>{t('Starting points')}</h3>
            <div className="report-template-grid">
              {['morning', 'evening', 'weekly', 'topic']
                .map((name) => preset(name, snapshot.settings.activeAgent))
                .filter((e) =>
                  t(e.title).toLocaleLowerCase().includes(templateQuery.toLocaleLowerCase()),
                )
                .map((e) => (
                  <article key={e.title}>
                    <h4>{t(e.title)}</h4>
                    <p>{e.data.sections.map((s) => t(s.title)).join(' · ')}</p>
                    <button onClick={() => edit({ ...e, title: t(e.title) })}>
                      {t('Use template')}
                    </button>
                  </article>
                ))}
            </div>
          </div>
          <footer>
            <button onClick={() => setGallery(false)}>{t('Close')}</button>
          </footer>
        </Modal>
      )}
      {reader && (
        <Suspense fallback={<p>{t('Opening report…')}</p>}>
          <Reader
            report={reader}
            settings={snapshot.settings}
            onClose={() => setReader(null)}
            onAsk={(e) => {
              setReader(null);
              onAsk(e);
            }}
            onOpen={(id) => {
              setReader(null);
              onOpen(id);
            }}
          />
        </Suspense>
      )}
      {draft && (
        <Modal
          title={t(oneOff ? 'New custom report' : 'Configure report')}
          onClose={() => setDraft(null)}
          className="report-editor"
        >
          <nav className="form-tabs">
            {[
              ['content', 'Content'],
              ['schedule', oneOff ? 'Reporting period' : 'Schedule'],
              ['delivery', 'Delivery'],
            ].map(([v, l]) => (
              <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)}>
                {t(l)}
              </button>
            ))}
          </nav>
          <div className="planning-form">
            {tab === 'content' && (
              <>
                <div className="form-grid">
                  <label>
                    {t('Report name')}
                    <input
                      aria-label={t('Report name')}
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                  </label>
                  <label>
                    {t('Agent')}
                    <select
                      aria-label={t('Report agent')}
                      value={draft.data.agentProfile}
                      onChange={(e) => patch({ agentProfile: e.target.value })}
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  {t('Length')}
                  <select
                    value={draft.data.length}
                    onChange={(e) => patch({ length: e.target.value })}
                  >
                    {['brief', 'standard', 'detailed'].map((v) => (
                      <option key={v} value={v}>
                        {t(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <h3>{t('Include in report')}</h3>
                {draft.data.sections.map((s: any, i: number) => (
                  <section className="report-section-editor" key={s.id}>
                    <header>
                      <label className="switch-line">
                        <b>{t(s.title)}</b>
                        <Switch
                          data-tooltip={t(
                            'Include this section when the agent creates the report.',
                          )}
                          checked={s.enabled}
                          onChange={(e) => sectionPatch(i, { enabled: e.target.checked })}
                        />
                      </label>
                      <div>
                        <button
                          disabled={!i}
                          aria-label={t('Move section up')}
                          onClick={() => {
                            const sections = [...draft.data.sections];
                            [sections[i - 1], sections[i]] = [sections[i], sections[i - 1]];
                            patch({ sections });
                          }}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={t('Remove section')}
                          onClick={() =>
                            patch({
                              sections: draft.data.sections.filter((_: any, n: number) => n !== i),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    </header>
                    <div className="form-grid">
                      <label>
                        {t('Section title')}
                        <input
                          value={s.title}
                          onChange={(e) => sectionPatch(i, { title: e.target.value })}
                        />
                      </label>
                      <label>
                        {t('Section type')}
                        <select
                          value={s.type}
                          onChange={(e) => sectionPatch(i, { type: e.target.value, sources: [] })}
                        >
                          {types.map(([v, l]) => (
                            <option key={v} value={v}>
                              {t(l)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      {t('What should this section cover?')}
                      <textarea
                        rows={2}
                        value={s.prompt}
                        onChange={(e) => sectionPatch(i, { prompt: e.target.value })}
                        placeholder={t('Describe the question or focus in plain language.')}
                      />
                    </label>
                    {s.type === 'calendar' && (
                      <label>
                        {t('Calendar content')}
                        <select
                          value={s.calendarMode || 'personal'}
                          onChange={(e) => sectionPatch(i, { calendarMode: e.target.value })}
                        >
                          <option value="personal">{t('Your calendar')}</option>
                          <option value="combined">{t('Combined')}</option>
                          <option value="agent">{t('Agent Calendar')}</option>
                        </select>
                      </label>
                    )}
                    <details>
                      <summary>
                        {t('Sources')} · {s.sources.length}
                      </summary>
                      <div className="report-source-choices">
                        {snapshot.entities
                          .filter((e) =>
                            s.type === 'calendar'
                              ? e.kind === 'calendar'
                              : s.type === 'tasks'
                                ? ['board', 'list', 'card', 'matrix-list', 'matrix-task'].includes(
                                    e.kind,
                                  )
                                : [
                                    'project',
                                    'notebook',
                                    'note',
                                    'vault-folder',
                                    'vault-file',
                                  ].includes(e.kind),
                          )
                          .slice(0, 200)
                          .map((e) => (
                            <label className="switch-line" key={e.id}>
                              <span>
                                {e.title}
                                {!allowed(e, snapshot.entities, snapshot.settings)
                                  ? ' · ' + t('Access required')
                                  : ''}
                              </span>
                              <Switch
                                data-tooltip={t(
                                  'Use this item as a source for the report. Agent access must be granted separately.',
                                )}
                                checked={s.sources.includes(e.id)}
                                onChange={(ev) =>
                                  sectionPatch(i, {
                                    sources: ev.target.checked
                                      ? [...s.sources, e.id]
                                      : s.sources.filter((id: string) => id !== e.id),
                                  })
                                }
                              />
                            </label>
                          ))}
                      </div>
                    </details>
                  </section>
                ))}
                <button
                  disabled={draft.data.sections.length >= 12}
                  onClick={() =>
                    patch({
                      sections: [
                        ...draft.data.sections,
                        {
                          id: crypto.randomUUID(),
                          type: 'custom',
                          title: t('Custom section'),
                          prompt: '',
                          sources: [],
                          enabled: true,
                        },
                      ],
                    })
                  }
                >
                  {t('Add section')}
                </button>
                <label>
                  {t('Additional preferences')}
                  <textarea
                    rows={2}
                    value={draft.data.preferences}
                    onChange={(e) => patch({ preferences: e.target.value })}
                  />
                </label>
              </>
            )}
            {tab === 'schedule' && (
              <>
                {!oneOff && (
                  <>
                    <label className="switch-line">
                      {t('Enabled')}
                      <Switch
                        data-tooltip={t(
                          'Enable this report schedule. Automatic reports must also be on, Intelligence open, and background AI running.',
                        )}
                        checked={draft.data.enabled}
                        onChange={(e) => patch({ enabled: e.target.checked })}
                      />
                    </label>
                    <TimingEditor
                      value={draft.data.timing}
                      onChange={(v) => patch({ timing: v })}
                    />
                  </>
                )}
                <h3>{t('Reporting period')}</h3>
                <select
                  aria-label={t('Reporting period')}
                  value={draft.data.coverage.mode}
                  onChange={(e) => patch({ coverage: { mode: e.target.value, days: 7 } })}
                >
                  {[
                    ['today', 'Today'],
                    ['tomorrow', 'Tomorrow'],
                    ['week', 'Past seven days'],
                    ['past', 'Past number of days'],
                    ['since', 'Since last successful report'],
                    ['custom', 'Custom date range'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {t(l)}
                    </option>
                  ))}
                </select>
                {draft.data.coverage.mode === 'past' && (
                  <label>
                    {t('Coverage days')}
                    <input
                      type="number"
                      min="1"
                      max="366"
                      value={draft.data.coverage.days || 7}
                      onChange={(e) =>
                        patch({
                          coverage: { ...draft.data.coverage, days: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                )}
                {draft.data.coverage.mode === 'custom' && (
                  <div className="form-grid">
                    {['from', 'to'].map((k) => (
                      <label key={k}>
                        {t(k === 'from' ? 'From' : 'To')}
                        <input
                          type="date"
                          value={draft.data.coverage[k] || ''}
                          onChange={(e) =>
                            patch({ coverage: { ...draft.data.coverage, [k]: e.target.value } })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
                {!oneOff && (
                  <button
                    onClick={() =>
                      void api
                        .workspace({ action: 'reports-preview', data: draft.data })
                        .then(setPreview)
                        .catch(onError)
                    }
                  >
                    {t('Preview next occurrences')}
                  </button>
                )}
                {preview && (
                  <div role="status">
                    {preview.next.length ? (
                      preview.next.map((v: string) => <p key={v}>{new Date(v).toLocaleString()}</p>)
                    ) : (
                      <p>{t('On demand / no future occurrence')}</p>
                    )}
                    <small>
                      {t('Coverage')} · {new Date(preview.coverage.from).toLocaleDateString()} —{' '}
                      {new Date(preview.coverage.to).toLocaleDateString()}
                    </small>
                  </div>
                )}
              </>
            )}
            {tab === 'delivery' && (
              <>
                <label>
                  {t('When ready')}
                  <select
                    value={draft.data.delivery}
                    onChange={(e) => patch({ delivery: e.target.value })}
                  >
                    {[
                      ['quiet', 'Save quietly'],
                      ['notify', 'Notify when ready'],
                      ['present', 'Present when the app is idle'],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {t(l)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="switch-line">
                  {t('Include available images')}
                  <Switch
                    checked={draft.data.images}
                    onChange={(e) => patch({ images: e.target.checked })}
                  />
                </label>
                <label className="switch-line">
                  {t('Report animations')}
                  <Switch
                    checked={snapshot.settings.reportAnimations}
                    onChange={(e) => void onSettings({ reportAnimations: e.target.checked })}
                  />
                </label>
                <label className="switch-line">
                  {t('Display report images')}
                  <Switch
                    checked={snapshot.settings.reportImages}
                    onChange={(e) => void onSettings({ reportImages: e.target.checked })}
                  />
                </label>
              </>
            )}
          </div>
          <details className="report-run-limits">
            <summary>{t('Advanced execution limits')}</summary>
            <div className="form-grid">
              <label>
                {t('Maximum running minutes')}
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={draft.data.maxMinutes || 30}
                  onChange={(e) => patch({ maxMinutes: Number(e.target.value) })}
                />
              </label>
              <label>
                {t('Maximum tool steps')}
                <input
                  type="number"
                  min="1"
                  max="48"
                  value={draft.data.maxSteps || 12}
                  onChange={(e) => patch({ maxSteps: Number(e.target.value) })}
                />
              </label>
            </div>
          </details>
          <footer>
            <button onClick={() => setDraft(null)}>{t('Cancel')}</button>
            <button
              className="primary"
              disabled={busy || !draft.title.trim()}
              onClick={() =>
                void act({
                  action: oneOff ? 'reports-custom' : 'reports-save',
                  id: draft.id,
                  revision: draft.revision,
                  title: draft.title,
                  data: draft.data,
                }).then((result) => {
                  if (result) setDraft(null);
                })
              }
            >
              {t(oneOff ? 'Create report' : 'Save template')}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
