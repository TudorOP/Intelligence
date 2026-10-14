import { t } from './i18n';
export function nowLocal() {
  const d = new Date(Date.now() + 3600000);
  d.setMinutes(0, 0, 0);
  return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function timingDefault() {
  return {
    start: nowLocal(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    repeat: 'none',
    interval: 1,
    weekdays: [],
    until: '',
    dates: [],
    ambiguity: 'earlier',
  };
}
export default function TimingEditor({
  value,
  onChange,
}: {
  value: any;
  onChange: (v: any) => void;
}) {
  const patch = (p: any) => onChange({ ...value, ...p });
  return (
    <div className="timing-editor form-grid">
      <label>
        {t('Starting date & time')}
        <input
          aria-label={t('Starting date & time')}
          type="datetime-local"
          value={value.start || ''}
          onChange={(e) => patch({ start: e.target.value })}
        />
      </label>
      <label>
        {t('Timezone')}
        <input
          aria-label={t('Timezone')}
          value={value.timezone || ''}
          onChange={(e) => patch({ timezone: e.target.value })}
          list="planning-timezones"
        />
        <datalist id="planning-timezones">
          {[
            'Europe/Bucharest',
            'Europe/London',
            'Europe/Paris',
            'America/New_York',
            'America/Los_Angeles',
            'Asia/Tokyo',
            'UTC',
          ].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </label>
      <label>
        {t('Repeat')}
        <select
          aria-label={t('Repeat')}
          value={value.repeat || 'none'}
          onChange={(e) => patch({ repeat: e.target.value, weekdays: [] })}
        >
          {[
            ['none', 'Once / on demand'],
            ['dates', 'Selected dates'],
            ['daily', 'Daily'],
            ['weekly', 'Weekly'],
            ['monthly', 'Monthly'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {t(l)}
            </option>
          ))}
        </select>
      </label>
      {!['none', 'dates'].includes(value.repeat) && (
        <label>
          {t('Every')}
          <input
            aria-label={t('Recurrence interval')}
            type="number"
            min="1"
            max="366"
            value={value.interval || 1}
            onChange={(e) => patch({ interval: Number(e.target.value) })}
          />
          <small>{t('Monthly dates clamp to the last day when needed.')}</small>
        </label>
      )}
      {value.repeat === 'daily' && (
        <fieldset className="weekday-picks">
          <legend>{t('Selected weekdays (optional)')}</legend>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, i) => (
            <button
              type="button"
              key={i}
              aria-pressed={value.weekdays?.includes(i) || false}
              onClick={() =>
                patch({
                  weekdays: value.weekdays?.includes(i)
                    ? value.weekdays.filter((v: number) => v !== i)
                    : [...(value.weekdays || []), i],
                })
              }
            >
              {t(name)}
            </button>
          ))}
        </fieldset>
      )}
      {value.repeat === 'dates' && (
        <label className="full-width">
          {t('Dates, one per line')}
          <textarea
            rows={3}
            aria-label={t('Custom report dates')}
            placeholder="2026-10-12T08:00"
            value={(value.dates || []).join('\n')}
            onChange={(e) => patch({ dates: e.target.value.split('\n').filter(Boolean) })}
          />
        </label>
      )}
      {value.repeat !== 'none' && (
        <label>
          {t('End date (optional)')}
          <input
            type="date"
            value={value.until || ''}
            onChange={(e) => patch({ until: e.target.value })}
          />
        </label>
      )}
      <details className="full-width">
        <summary>{t('Clock changes')}</summary>
        <label>
          {t('Repeated local time')}
          <select
            value={value.ambiguity || 'earlier'}
            onChange={(e) => patch({ ambiguity: e.target.value })}
          >
            <option value="earlier">{t('First occurrence')}</option>
            <option value="later">{t('Second occurrence')}</option>
          </select>
        </label>
        <small>
          {t(
            'Nonexistent starting times are rejected. Recurrences skip nonexistent clock-change times.',
          )}
        </small>
      </details>
    </div>
  );
}
