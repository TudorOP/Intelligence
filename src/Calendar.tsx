import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { Entity, Settings, Snapshot } from './types';
import Modal from './Modal';
import Switch from './Switch';
import ActionMenu from './ActionMenu';
import TimingEditor, { timingDefault } from './TimingEditor';
const DAY = 86400000;
const dateKey = (d: Date) =>
  new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function zoneLocal(value: string, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
}
export default function Calendar({
  snapshot,
  onSettings,
  onChanged,
  onError,
  onOpen,
  initialId,
  onHandled,
}: {
  snapshot: Snapshot;
  onSettings: (s: Partial<Settings>) => Promise<any>;
  onChanged: () => Promise<any>;
  onError: (e: any) => void;
  onOpen: (id: string) => void;
  initialId?: string | null;
  onHandled?: () => void;
}) {
  const { settings, entities } = snapshot,
    calendars = entities.filter((e) => e.kind === 'calendar'),
    profiles = entities.filter((e) => e.kind === 'agent-profile');
  const [date, setDate] = useState(() => dateKey(new Date())),
    [rows, setRows] = useState<any[]>([]),
    [notice, setNotice] = useState(''),
    [editing, setEditing] = useState<any>(null),
    [selected, setSelected] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [calendarName, setCalendarName] = useState(''),
    [occurrenceMode, setOccurrenceMode] = useState('series');
  const view = settings.calendarView || 'week',
    mode = settings.calendarMode || 'combined';
  useEffect(() => {
    if (!initialId) return;
    const e = entities.find((v) => v.id === initialId);
    if (e?.kind === 'calendar-event') {
      setDate(e.data.timing.start.slice(0, 10));
      setSelected(null);
      setOccurrenceMode('series');
      setEditing({
        id: e.id,
        revision: e.revision,
        title: e.title,
        calendarId: e.parent,
        data: structuredClone(e.data),
      });
    }
    onHandled?.();
  }, [initialId]);
  const start = useMemo(() => {
    const d = new Date(date + 'T00:00:00');
    if (view === 'month') {
      d.setDate(1);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    } else if (view === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }, [date, view]);
  const days = view === 'month' ? 42 : view === 'week' ? 7 : 14;
  const end = new Date(+start);
  end.setDate(end.getDate() + days);
  const signature = entities
    .filter((e) =>
      ['calendar', 'calendar-event', 'card', 'matrix-task', 'report-template', 'report'].includes(
        e.kind,
      ),
    )
    .map((e) => e.id + ':' + e.revision)
    .join(',');
  useEffect(() => {
    let live = true;
    void api
      .workspace({
        action: 'calendar-range',
        from: start.toISOString(),
        to: end.toISOString(),
        mode,
        profiles: settings.calendarProfiles || [],
        layers: settings.calendarLayers,
      })
      .then((v) => {
        if (live) {
          setRows(v.items);
          setNotice(
            v.truncated ? t('Showing the first 1,500 entries. Narrow the range or filters.') : '',
          );
        }
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [
    +start,
    days,
    mode,
    JSON.stringify(settings.calendarProfiles),
    JSON.stringify(settings.calendarLayers),
    signature,
    snapshot.activeConversations?.join(','),
  ]);
  const changeDate = (direction: number) => {
    const d = new Date(date + 'T12:00:00');
    if (view === 'month') d.setMonth(d.getMonth() + direction);
    else d.setDate(d.getDate() + direction * (view === 'week' ? 7 : 14));
    setDate(dateKey(d));
  };
  const openNew = (day = date) => {
    const timing = { ...timingDefault(), start: day + 'T09:00' },
      end = new Date(timing.start + ':00');
    setSelected(null);
    end.setHours(end.getHours() + 1);
    setOccurrenceMode('series');
    setEditing({
      title: '',
      calendarId: calendars[0]?.id,
      data: {
        timing,
        endLocal: dateKey(end) + 'T' + String(end.getHours()).padStart(2, '0') + ':00',
        owner: 'user',
        allDay: false,
        description: '',
        location: '',
        reminderMinutes: 10,
      },
    });
  };
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
  const save = async () => {
    const input =
      editing.id && occurrenceMode === 'occurrence' && selected
        ? {
            action: 'calendar-split',
            id: editing.id,
            revision: editing.revision,
            title: editing.title,
            calendarId: editing.calendarId,
            occurrence: selected.start,
            data: editing.data,
          }
        : { action: 'calendar-save', ...editing };
    if (await act(input)) {
      setEditing(null);
      setSelected(null);
    }
  };
  const editEntry = (row: any) => {
    const e = entities.find((v) => v.id === row.source);
    if (e?.kind !== 'calendar-event') {
      onOpen(row.source);
      return;
    }
    setOccurrenceMode('series');
    setSelected(row);
    setEditing({
      id: e.id,
      revision: e.revision,
      title: e.title,
      calendarId: e.parent,
      data: { ...e.data },
    });
  };
  const entry = (r: any) => (
    <div key={r.id} className="calendar-entry-shell">
      <button
        className={'calendar-entry ' + r.kind}
        title={r.title + ' · ' + t(r.status)}
        onClick={() => setSelected(r)}
      >
        <span>{r.kind === 'execution' ? '●' : r.kind === 'event' ? '▢' : '◷'}</span>
        <b>{r.title}</b>
        <small>
          {r.allDay
            ? t('All day')
            : new Date(r.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
          · {t(r.status || 'scheduled')}
        </small>
        {mode !== 'personal' && r.profile && (
          <small>
            {r.agentName || profiles.find((p) => p.id === r.profile)?.title || t('Previous agent')}
          </small>
        )}
      </button>
      <ActionMenu label={t('Calendar entry actions')}>
        <button onClick={() => setSelected(r)}>{t('View details')}</button>
        <button onClick={() => onOpen(r.conversation || r.source)}>{t('Open source')}</button>
        {r.kind === 'event' && (
          <>
            <button onClick={() => editEntry(r)}>{t('Edit event')}</button>
            <button
              className="danger"
              onClick={() => void act({ action: 'calendar-trash', id: r.source })}
            >
              {t('Move to Trash')}
              {entities.find((e) => e.id === r.source)?.data.timing.repeat !== 'none'
                ? ' · ' + t('Entire series')
                : ''}
            </button>
          </>
        )}
      </ActionMenu>
    </div>
  );
  return (
    <div className="page-pad calendar-page">
      <ActionMenu hiddenTrigger label={t('Calendar actions')}>
        <button onClick={() => openNew()}>{t('New event')}</button>
        <button onClick={() => setDate(dateKey(new Date()))}>{t('Today')}</button>
        <button onClick={() => void onSettings({ calendarView: 'agenda' })}>
          {t('View agenda')}
        </button>
      </ActionMenu>
      <header className="planning-header">
        <div>
          <span className="eyebrow">{t('YOUR TIME')}</span>
          <h1>{t('Calendar')}</h1>
          <p>{t('Your day, with room to think.')}</p>
        </div>
        <div>
          <button onClick={() => setDate(dateKey(new Date()))}>{t('Today')}</button>
          <button onClick={() => openNew()} className="primary">
            {t('New event')}
          </button>
        </div>
      </header>
      <div className="calendar-toolbar">
        <div>
          <button aria-label={t('Previous period')} onClick={() => changeDate(-1)}>
            ←
          </button>
          <input
            aria-label={t('Calendar date')}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || date)}
          />
          <button aria-label={t('Next period')} onClick={() => changeDate(1)}>
            →
          </button>
        </div>
        <select
          aria-label={t('Calendar mode')}
          value={mode}
          onChange={(e) => void onSettings({ calendarMode: e.target.value as any })}
        >
          {[
            ['personal', 'Your calendar'],
            ['combined', 'Combined'],
            ['agent', 'Agent Calendar'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {t(l)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('Calendar view')}
          value={view}
          onChange={(e) => void onSettings({ calendarView: e.target.value as any })}
        >
          {[
            ['agenda', 'Agenda'],
            ['week', 'Week'],
            ['month', 'Month'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {t(l)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('Calendar agent filter')}
          value={settings.calendarProfiles?.[0] || ''}
          onChange={(e) =>
            void onSettings({ calendarProfiles: e.target.value ? [e.target.value] : [] })
          }
        >
          <option value="">{t('All agents')}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <details className="calendar-layer-menu">
          <summary>{t('Layers & access')}</summary>
          {[
            ['tasks', 'Tasks'],
            ['matrix', 'Cognition Matrix'],
            ['reports', 'Reports'],
            ['execution', 'Actual execution'],
            ['events', 'Calendar events'],
          ].map(([id, label]) => (
            <label key={id}>
              {t(label)}
              <Switch
                data-tooltip={t(
                  'Show or hide this layer in the calendar. This does not start or stop work.',
                )}
                checked={settings.calendarLayers?.includes(id) || false}
                onChange={(e) =>
                  void onSettings({
                    calendarLayers: e.target.checked
                      ? [...settings.calendarLayers, id]
                      : settings.calendarLayers.filter((v) => v !== id),
                  })
                }
              />
            </label>
          ))}
          {calendars.map((c) => (
            <label key={c.id}>
              {c.title} · {t('Agent access')}
              <Switch
                data-tooltip={t(
                  'Allow agents to use this calendar with the permission selected beside it.',
                )}
                checked={c.data.access === true}
                onChange={(e) =>
                  void api
                    .mutate({
                      id: c.id,
                      revision: c.revision,
                      data: { access: e.target.checked },
                    })
                    .then(onChanged)
                    .catch(onError)
                }
              />
              <select
                data-tooltip={t(
                  'Choose whether agents may only read this calendar or also change its events.',
                )}
                aria-label={t('Calendar permission') + ' · ' + c.title}
                value={c.data.permission || 'read'}
                onChange={(e) =>
                  void api
                    .mutate({
                      id: c.id,
                      revision: c.revision,
                      data: { permission: e.target.value },
                    })
                    .then(onChanged)
                    .catch(onError)
                }
              >
                <option value="read">{t('Read only')}</option>
                <option value="edit">{t('Read & edit')}</option>
              </select>
            </label>
          ))}
          <input
            aria-label={t('New calendar name')}
            placeholder={t('New calendar name')}
            value={calendarName}
            onChange={(e) => setCalendarName(e.target.value)}
          />
          <button
            disabled={!calendarName.trim()}
            onClick={() =>
              void api
                .mutate({ kind: 'calendar', title: calendarName, data: { access: false } })
                .then(() => {
                  setCalendarName('');
                  return onChanged();
                })
                .catch(onError)
            }
          >
            {t('Create calendar')}
          </button>
        </details>
      </div>
      <div className="calendar-legend">
        <span>▢ {t('Your events')}</span>
        <span>◷ {t('Planned work')}</span>
        <span>● {t('Actual execution')}</span>
        <small>{t('Calendar layers display source schedules; they never run work.')}</small>
      </div>
      {notice && <p role="status">{notice}</p>}
      {view === 'agenda' ? (
        <div className="calendar-agenda">
          {rows.slice(0, 300).map((r) => (
            <div key={r.id}>
              <time>{new Date(r.start).toLocaleDateString()}</time>
              {entry(r)}
            </div>
          ))}
          {!rows.length && <p>{t('Nothing scheduled in this period.')}</p>}
        </div>
      ) : (
        <div className={'calendar-grid ' + view}>
          {Array.from({ length: days }, (_, i) => {
            const d = new Date(+start);
            d.setDate(d.getDate() + i);
            const next = new Date(+d);
            next.setDate(next.getDate() + 1);
            const dayRows = rows
              .filter(
                (r) =>
                  Date.parse(r.start) < +next &&
                  (r.end ? Date.parse(r.end) > +d : Date.parse(r.start) >= +d),
              )
              .slice(0, view === 'month' ? 4 : 60);
            return (
              <section
                key={i}
                className={'calendar-day ' + (dateKey(d) === dateKey(new Date()) ? 'today' : '')}
              >
                <ActionMenu label={t('Day actions')}>
                  <button onClick={() => openNew(dateKey(d))}>{t('New event')}</button>
                  <button
                    onClick={() => {
                      setDate(dateKey(d));
                      void onSettings({ calendarView: 'agenda' });
                    }}
                  >
                    {t('View agenda')}
                  </button>
                </ActionMenu>
                <header>
                  <small>{d.toLocaleDateString([], { weekday: 'short' })}</small>
                  <b>{d.getDate()}</b>
                </header>
                <div className="calendar-day-events">
                  {dayRows.map(entry)}
                  {rows.filter(
                    (r) =>
                      Date.parse(r.start) < +next &&
                      (r.end ? Date.parse(r.end) > +d : Date.parse(r.start) >= +d),
                  ).length > dayRows.length && (
                    <button
                      onClick={() => {
                        setDate(dateKey(d));
                        void onSettings({ calendarView: 'agenda' });
                      }}
                    >
                      {t('View agenda')}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {selected && !editing && (
        <Modal title={selected.title} onClose={() => setSelected(null)} className="event-reader">
          <article>
            <p>
              {t(selected.kind)} · {t(selected.status)}
            </p>
            <p>
              {new Date(selected.start).toLocaleString()}
              {selected.end ? ' — ' + new Date(selected.end).toLocaleString() : ''}
            </p>
            <p>{selected.description}</p>
            <p>{selected.location}</p>
            <small>
              {selected.kind === 'execution'
                ? t('Actual execution history is read-only.')
                : t('Editing planned work opens its source.')}
            </small>
          </article>
          <footer>
            <button
              onClick={() => {
                setSelected(null);
                onOpen(selected.conversation || selected.source);
              }}
            >
              {t('Open source')}
            </button>
            {selected.kind === 'event' && (
              <>
                <button onClick={() => editEntry(selected)}>{t('Edit event')}</button>
                <button
                  className="danger"
                  onClick={() =>
                    void act({ action: 'calendar-trash', id: selected.source }).then(() =>
                      setSelected(null),
                    )
                  }
                >
                  {t('Move to Trash')}
                </button>
              </>
            )}
          </footer>
        </Modal>
      )}
      {editing && (
        <Modal
          title={t(editing.id ? 'Edit event' : 'New event')}
          onClose={() => setEditing(null)}
          className="event-editor"
        >
          <div className="planning-form">
            <label>
              {t('Title')}
              <input
                aria-label={t('Event title')}
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </label>
            <label>
              {t('Calendar')}
              <select
                value={editing.calendarId}
                onChange={(e) => setEditing({ ...editing, calendarId: e.target.value })}
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            {editing.id && editing.data.timing.repeat !== 'none' && (
              <label>
                {t('Edit recurrence')}
                <select
                  value={occurrenceMode}
                  onChange={(e) => {
                    setOccurrenceMode(e.target.value);
                    if (e.target.value === 'occurrence' && selected)
                      setEditing({
                        ...editing,
                        data: {
                          ...editing.data,
                          timing: {
                            ...editing.data.timing,
                            start: zoneLocal(selected.start, editing.data.timing.timezone),
                          },
                          endLocal: zoneLocal(selected.end, editing.data.timing.timezone),
                        },
                      });
                  }}
                >
                  <option value="series">{t('Entire series')}</option>
                  <option value="occurrence" disabled={!selected}>
                    {t('This occurrence')}
                  </option>
                </select>
              </label>
            )}
            <TimingEditor
              value={editing.data.timing}
              onChange={(v) => setEditing({ ...editing, data: { ...editing.data, timing: v } })}
            />
            <label className="switch-line">
              {t('All day')}
              <Switch
                checked={editing.data.allDay}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    data: {
                      ...editing.data,
                      allDay: e.target.checked,
                      startDate: editing.data.timing.start.slice(0, 10),
                      endDate: editing.data.timing.start.slice(0, 10),
                    },
                  })
                }
              />
            </label>
            {editing.data.allDay ? (
              <label>
                {t('Last all-day date')}
                <input
                  type="date"
                  value={editing.data.endDate}
                  onChange={(e) =>
                    setEditing({ ...editing, data: { ...editing.data, endDate: e.target.value } })
                  }
                />
              </label>
            ) : (
              <label>
                {t('End date & time')}
                <input
                  type="datetime-local"
                  value={editing.data.endLocal}
                  onChange={(e) =>
                    setEditing({ ...editing, data: { ...editing.data, endLocal: e.target.value } })
                  }
                />
              </label>
            )}
            <label>
              {t('Description')}
              <textarea
                value={editing.data.description}
                rows={3}
                onChange={(e) =>
                  setEditing({ ...editing, data: { ...editing.data, description: e.target.value } })
                }
              />
            </label>
            <label>
              {t('Location / link')}
              <input
                value={editing.data.location}
                onChange={(e) =>
                  setEditing({ ...editing, data: { ...editing.data, location: e.target.value } })
                }
              />
            </label>
            <div className="form-grid">
              <label>
                {t('Calendar owner')}
                <select
                  value={editing.data.owner}
                  onChange={(e) =>
                    setEditing({ ...editing, data: { ...editing.data, owner: e.target.value } })
                  }
                >
                  <option value="user">{t('User')}</option>
                  <option value="agent">{t('Agent')}</option>
                </select>
              </label>
              {editing.data.owner === 'agent' && (
                <label>
                  {t('Agent')}
                  <select
                    value={editing.data.agentProfile || ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        data: { ...editing.data, agentProfile: e.target.value },
                      })
                    }
                  >
                    <option value="">{t('Choose agent')}</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {t('Reminder minutes')}
                <input
                  type="number"
                  min="0"
                  max="10080"
                  value={editing.data.reminderMinutes || 0}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      data: { ...editing.data, reminderMinutes: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
          </div>
          <footer>
            <button onClick={() => setEditing(null)}>{t('Cancel')}</button>
            <button
              className="primary"
              disabled={busy || !editing.title.trim()}
              onClick={() => void save()}
            >
              {t('Save event')}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
