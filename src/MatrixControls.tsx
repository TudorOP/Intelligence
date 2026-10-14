import { useEffect, useState } from 'react';
import type { Entity, Settings, Snapshot } from './types';
import { t } from './i18n';
import ModelPicker from './ModelPicker';
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
  const settings = snapshot.settings,
    profile = list.data.modelProfile;
  const [open, setOpen] = useState(embedded),
    [provider, setProvider] = useState<Settings['provider']>(
      profile?.provider ?? settings.provider,
    );
  useEffect(
    () => setProvider(profile?.provider ?? settings.provider),
    [profile?.provider, settings.provider],
  );
  const saved = provider === settings.provider ? settings : settings.providerProfiles?.[provider];
  const draft = {
    ...settings,
    provider,
    endpoint: saved?.endpoint ?? providerDefaults[provider],
    model: provider === profile?.provider ? profile.model : '',
  };
  return (
    <details
      className="matrix-model"
      open={embedded || undefined}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        title={t(
          'Select the provider and model for this list. Provider addresses and API keys come from Model & providers settings.',
        )}
      >
        {t('Task model')} · {profile ? profile.model : t('Use chat model')}
      </summary>
      {open ? (
        <>
          <label className="check-label">
            <Switch
              checked={!profile}
              onChange={(e) =>
                void update({
                  modelProfile: e.target.checked
                    ? null
                    : { provider: settings.provider, model: settings.model || '' },
                })
              }
              disabled={!profile && !settings.model}
            />
            {t('Use chat model')}
          </label>
          <label>
            {t('Inference provider')}
            <select
              value={provider}
              aria-label={t('Provider for ') + list.title}
              onChange={(e) => setProvider(e.target.value as Settings['provider'])}
            >
              {(snapshot.inference?.providers ?? providers).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <ModelPicker
            matrix
            settings={draft}
            onError={onError}
            onUpdate={async ({ model }) =>
              update({ modelProfile: model ? { provider, model } : null })
            }
          />
          <small>
            {t('Provider addresses and API keys come from Model & providers settings.')}
          </small>
          {!settings.matrixPreload ? (
            <small>
              {t('Preloading is off: this list currently uses the loaded chat model instead.')}
            </small>
          ) : null}
        </>
      ) : null}
    </details>
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
              }}
            >
              <option value="time">{t('Scheduled time')}</option>
              <option value="completion">{t('Another task completes')}</option>
              <option value="file">{t('A file or folder changes')}</option>
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
              {kind !== 'external' ? (
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
                {kind === 'file'
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
