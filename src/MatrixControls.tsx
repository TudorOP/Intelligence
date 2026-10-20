import { useEffect, useState } from 'react';
import type { Entity, Settings, Snapshot } from './types';
import { t } from './i18n';
import AgentPicker from './AgentPicker';
import { api } from './api';
import Switch from './Switch';

import { providerDefaults, providers } from './providers';

export function MatrixModel({
  list,
  snapshot,
  update,
  onError,
  embedded = false,
}: {
  list: Entity;
  snapshot: Snapshot;
  update: (data: any) => Promise<any>;
  onError: (e: any) => void;
  embedded?: boolean;
}) {
  return (
    <div className="matrix-model">
      <label>{t('List agent')}</label>
      <AgentPicker
        entities={snapshot.entities}
        settings={snapshot.settings}
        value={list.data.assignedAgent || snapshot.settings.activeAgent}
        onChange={(id) => void update({ assignedAgent: id, modelProfile: null }).catch(onError)}
      />
      <small>
        {t('Tasks inherit the agent from this list. Assignment does not grant access.')}
      </small>
    </div>
  );
}

export function MatrixTaskSchedule({
  task,
  snapshot,
  update,
}: {
  task: Entity;
  snapshot: Snapshot;
  update: (data: any) => Promise<any>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = task.data.trigger ?? { kind: 'time' };
  const schedule = task.data.schedule ?? { repeat: 'none' };
  const [kind, setKind] = useState(trigger.kind),
    [metric, setMetric] = useState(trigger.metric ?? 'memory'),
    [threshold, setThreshold] = useState(trigger.threshold ?? 90),
    [gitEvent, setGitEvent] = useState(trigger.event ?? 'commit'),
    [channel, setChannel] = useState(trigger.channel ?? ''),
    [source, setSource] = useState(trigger.source ?? ''),
    [directory, setDirectory] = useState(trigger.directory || ''),
    [fileMode, setFileMode] = useState(trigger.mode || 'changes'),
    [includeExisting, setIncludeExisting] = useState(trigger.includeExisting === true),
    [watchPath, setWatchPath] = useState(trigger.path ?? '.'),
    [cooldown, setCooldown] = useState(trigger.cooldownSeconds ?? 60),
    [start, setStart] = useState(''),
    [repeat, setRepeat] = useState(schedule.repeat ?? 'none'),
    [weekdays, setWeekdays] = useState<number[]>(schedule.weekdays ?? []);
  useEffect(() => {
    setKind(trigger.kind);
    setMetric(trigger.metric ?? 'memory');
    setThreshold(trigger.threshold ?? 90);
    setGitEvent(trigger.event ?? 'commit');
    setChannel(trigger.channel ?? '');
    setSource(trigger.source ?? '');
    setDirectory(trigger.directory || '');
    setFileMode(trigger.mode || 'changes');
    setIncludeExisting(trigger.includeExisting === true);
    setWatchPath(trigger.path ?? '.');
    setCooldown(trigger.cooldownSeconds ?? 60);
    setRepeat(schedule.repeat ?? 'none');
    setWeekdays(schedule.weekdays ?? []);
    const date = schedule.start ? new Date(schedule.start) : null;
    setStart(
      date
        ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : '',
    );
  }, [JSON.stringify(task.data.trigger), JSON.stringify(task.data.schedule)]);
  const sources = snapshot.entities.filter(
    (e) =>
      !e.deleted &&
      e.id !== task.id &&
      (kind === 'completion'
        ? ['matrix-task', 'card'].includes(e.kind)
        : kind === 'git'
          ? e.kind === 'project'
          : kind === 'system'
            ? e.kind === 'machine'
            : ['project', 'vault-folder', 'vault-file'].includes(e.kind)),
  );
  return (
    <details className="matrix-trigger-controls" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('Schedule & triggers')}</summary>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value =
              kind === 'time'
                ? { kind }
                : {
                    kind,
                    source,
                    path: watchPath,
                    cooldownSeconds: Number(cooldown),
                    ...(kind === 'file'
                      ? {
                          mode: fileMode,
                          includeExisting,
                          ...(directory ? { directory, source: undefined } : {}),
                        }
                      : {}),
                    ...(kind === 'system'
                      ? { metric, threshold: Number(threshold) }
                      : kind === 'git'
                        ? { event: gitEvent }
                        : kind === 'external'
                          ? { channel }
                          : {}),
                  };
            void update({
              trigger: value,
              triggerPending: false,
              lastTriggerToken: null,
              schedule: {
                start: kind === 'time' && start ? new Date(start).toISOString() : null,
                repeat: kind === 'time' ? repeat : 'none',
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                weekdays:
                  kind === 'time' && repeat === 'daily' && weekdays.length ? weekdays : undefined,
              },
            });
          }}
        >
          <label>
            {t('Run when')}
            <select
              aria-label={t('Trigger for ') + task.title}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setSource('');
                if (e.target.value === 'file') setFileMode('inbox');
              }}
            >
              <option value="time">{t('Scheduled time')}</option>
              <option value="completion">{t('Another task completes')}</option>
              <option value="file">{t('File monitoring')}</option>
              <option value="git">{t('A Git commit or branch changes')}</option>
              <option value="system">{t('A machine threshold is crossed')}</option>
              <option value="external">{t('An external event arrives')}</option>
            </select>
          </label>
          {kind === 'time' ? (
            <>
              <label>
                {t('Start at')}
                <input
                  type="datetime-local"
                  required={repeat !== 'none'}
                  aria-label={t('Start at for ') + task.title}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
              <label>
                {t('Repeat')}
                <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
                  <option value="none">{t('Once')}</option>
                  <option value="daily">{t('Daily')}</option>
                  <option value="weekly">{t('Weekly')}</option>
                </select>
              </label>
              {repeat === 'daily' ? (
                <fieldset className="matrix-weekdays">
                  <legend>{t('Days of the week')}</legend>
                  {[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ].map((day, i) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        checked={weekdays.includes(i)}
                        onChange={(e) =>
                          setWeekdays((v) =>
                            e.target.checked ? [...v, i] : v.filter((d) => d !== i),
                          )
                        }
                      />
                      {t(day)}
                    </label>
                  ))}
                  <small>{t('No days selected means every day.')}</small>
                </fieldset>
              ) : null}
            </>
          ) : (
            <>
              {kind === 'file' && (
                <>
                  <label>
                    {t('Monitor for')}
                    <select
                      aria-label={t('Monitor for')}
                      value={fileMode}
                      onChange={(e) => {
                        setFileMode(e.target.value);
                        if (e.target.value !== 'inbox') setDirectory('');
                      }}
                    >
                      <option value="inbox">{t('New completed files continuously')}</option>
                      <option value="changes">{t('Any file or folder change')}</option>
                    </select>
                  </label>
                  {fileMode === 'inbox' && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void api.directory().then((value) => {
                            if (value) {
                              setDirectory(value);
                              setSource('');
                            }
                          })
                        }
                      >
                        {t('Choose computer folder')}
                      </button>
                      {directory && (
                        <div>
                          <code>{directory}</code>
                          <button type="button" onClick={() => setDirectory('')}>
                            {t('Use workspace source instead')}
                          </button>
                        </div>
                      )}
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={includeExisting}
                          onChange={(e) => setIncludeExisting(e.target.checked)}
                        />
                        {t('Also process files already present when monitoring starts')}
                      </label>
                      <small>
                        {t(
                          'Authorize the folder in Agent access. Monitoring runs while Intelligence is open or in the tray, queues arrivals while busy and catches up after resume. Partial downloads wait until settled.',
                        )}
                      </small>
                    </>
                  )}
                </>
              )}
              {kind !== 'external' && !directory ? (
                <label>
                  {t('Trigger source')}
                  <select required value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="">{t('Choose a source')}</option>
                    {sources.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} · {t(item.kind)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {kind === 'git' ? (
                <label>
                  {t('Git event')}
                  <select value={gitEvent} onChange={(e) => setGitEvent(e.target.value)}>
                    <option value="commit">{t('Commit')}</option>
                    <option value="branch">{t('Branch')}</option>
                  </select>
                </label>
              ) : null}
              {kind === 'system' ? (
                <>
                  <label>
                    {t('Metric')}
                    <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                      <option value="memory">{t('Memory used (%)')}</option>
                      <option value="cpu">{t('CPU load per core (%)')}</option>
                    </select>
                  </label>
                  <label>
                    {t('Threshold')}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                    />
                  </label>
                  <small>
                    {t(
                      'Checks every 15 seconds while integrated. Runs once when the threshold is crossed, with a cooldown.',
                    )}
                  </small>
                </>
              ) : null}
              {kind === 'external' ? (
                <label>
                  {t('Event channel')}
                  <input
                    required
                    pattern="[a-zA-Z0-9_-]{1,60}"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                  />
                  <small>
                    {t('Use the local authenticated event endpoint configured in Settings.')}
                  </small>
                </label>
              ) : null}
              {kind === 'file' &&
              !directory &&
              snapshot.entities.find((e) => e.id === source)?.kind === 'project' ? (
                <label>
                  {t('Path within project')}
                  <input value={watchPath} onChange={(e) => setWatchPath(e.target.value)} />
                </label>
              ) : null}
              <label>
                {t('Trigger cooldown (seconds)')}
                <input
                  type="number"
                  min={5}
                  max={86400}
                  value={cooldown}
                  onChange={(e) => setCooldown(Number(e.target.value))}
                />
              </label>
              <small>
                {kind === 'file' && fileMode === 'inbox'
                  ? t(
                      'New arrivals stay queued while the agent is busy. Each execution is bounded; monitoring continues until paused. Download readiness uses temporary-file exclusions and a stability delay.',
                    )
                  : kind === 'file'
                    ? t(
                        'Watches the selected file or direct folder children. Changes during Matrix work are ignored to prevent loops. Monitoring stops when integration or access is disabled.',
                      )
                    : t(
                        'Runs after a verified Matrix completion or a task card marked complete. Failed or unverified results do not trigger work.',
                      )}
              </small>
            </>
          )}
          <button type="submit">{t('Save trigger')}</button>
        </form>
      ) : null}
      {task.data.lastTriggeredAt ? (
        <small>
          {t('Last triggered')} · {new Date(task.data.lastTriggeredAt).toLocaleString()}{' '}
          {task.data.triggerDetail}
        </small>
      ) : null}
    </details>
  );
}

export function FileQueueHistory({ task }: { task: Entity }) {
  const [events, setEvents] = useState<any[]>([]),
    [error, setError] = useState('');
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open)
          void api
            .workspace({ action: 'matrix-file-queue', id: task.id })
            .then(setEvents)
            .catch((e) => setError(e.message));
      }}
    >
      <summary>{t('File processing history')}</summary>
      {error && <p role="status">{error}</p>}
      {events.map((event) => (
        <p key={event.id}>
          <code>{event.file}</code> · {t(event.state)}
          <small>{event.result}</small>
        </p>
      ))}
      {!events.length && <small>{t('No files have been queued yet.')}</small>}
    </details>
  );
}
