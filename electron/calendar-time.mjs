const formatters = new Map();
const offsetCache = new Map();
export function zonedParts(value, timezone = 'UTC') {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timezone, f);
    if (formatters.size > 64) formatters.delete(formatters.keys().next().value);
  }
  return Object.fromEntries(
    f
      .formatToParts(new Date(value))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
}
export function localStamp(value, timezone = 'UTC') {
  const p = zonedParts(value, timezone),
    pad = (v) => String(v).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
export function wallDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value))
    throw Error('Choose a valid local date and time');
  const stamp = value.length === 10 ? value + 'T00:00' : value,
    d = new Date(stamp + ':00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 16) !== stamp)
    throw Error('Invalid calendar date');
  return d;
}
export function wallToUTC(value, timezone = 'UTC', ambiguity = 'earlier') {
  const date = wallDate(value),
    stamp = date.toISOString().slice(0, 16),
    key = timezone + ':' + stamp.slice(0, 10);
  let offsets = offsetCache.get(key);
  if (!offsets) {
    offsets = [
      ...new Set(
        [-36, 0, 36].map((hours) => {
          const at = +date + hours * 3600000,
            p = zonedParts(at, timezone);
          return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
        }),
      ),
    ];
    offsetCache.set(key, offsets);
    if (offsetCache.size > 256) offsetCache.delete(offsetCache.keys().next().value);
  }
  const matches = offsets
    .map((offset) => +date - offset)
    .filter((at) => localStamp(at, timezone) === stamp)
    .sort((a, b) => a - b);
  if (!matches.length)
    throw Error('This local time does not exist because clocks change. Choose another time.');
  return new Date(ambiguity === 'later' ? matches.at(-1) : matches[0]).toISOString();
}
export function validateTiming(value = {}) {
  const r = {
    start: value.start || '',
    timezone: value.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    repeat: value.repeat || 'none',
    interval: value.interval ?? 1,
    until: value.until || '',
    weekdays: value.weekdays || [],
    dates: value.dates || [],
    ambiguity: value.ambiguity || 'earlier',
  };
  if (
    !['none', 'dates', 'daily', 'weekly', 'monthly'].includes(r.repeat) ||
    !Number.isInteger(r.interval) ||
    r.interval < 1 ||
    r.interval > 366 ||
    !['earlier', 'later'].includes(r.ambiguity)
  )
    throw Error('Invalid report/calendar recurrence');
  if (r.start) wallToUTC(r.start, r.timezone, r.ambiguity);
  else zonedParts(Date.now(), r.timezone);
  if (r.until) {
    wallDate(r.until);
    if (r.start && r.until < r.start.slice(0, 10))
      throw Error('End date precedes the first occurrence');
  }
  if (
    !Array.isArray(r.weekdays) ||
    r.weekdays.length > 7 ||
    r.weekdays.some((n) => !Number.isInteger(n) || n < 0 || n > 6)
  )
    throw Error('Invalid weekday selection');
  if (!Array.isArray(r.dates) || r.dates.length > 100)
    throw Error('Choose at most 100 custom dates');
  for (const d of r.dates) wallToUTC(d, r.timezone, r.ambiguity);
  if (r.repeat === 'dates' && !r.dates.length) throw Error('Choose dates for this schedule');
  return r;
}
export function occurrences(rule, from, to, limit = 1000) {
  const r = validateTiming(rule),
    min = +new Date(from),
    max = +new Date(to),
    result = [];
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min || max - min > 367 * 86400000)
    throw Error('Choose a calendar range of at most 366 days');
  const add = (stamp) => {
    if (r.until && stamp.slice(0, 10) > r.until) return;
    let iso;
    try {
      iso = wallToUTC(stamp, r.timezone, r.ambiguity);
    } catch {
      return;
    }
    if (Date.parse(iso) >= min && Date.parse(iso) < max) result.push(iso);
  };
  if (r.repeat === 'dates') {
    for (const d of new Set(r.dates)) add(d);
    return result.sort().slice(0, limit);
  }
  if (!r.start) return result;
  if (r.repeat === 'none') {
    add(r.start);
    return result;
  }
  const origin = wallDate(r.start),
    day = 86400000;
  let index =
    r.repeat === 'monthly'
      ? Math.max(
          0,
          Math.floor(
            (new Date(min).getUTCFullYear() * 12 +
              new Date(min).getUTCMonth() -
              (origin.getUTCFullYear() * 12 + origin.getUTCMonth())) /
              r.interval,
          ) - 2,
        )
      : Math.max(
          0,
          Math.floor((min - +origin) / (day * r.interval * (r.repeat === 'weekly' ? 7 : 1))) - 3,
        );
  for (let i = 0; i < 4000 && result.length < limit; i++, index++) {
    const date = new Date(+origin);
    if (r.repeat === 'monthly') {
      date.setUTCDate(1);
      date.setUTCMonth(origin.getUTCMonth() + index * r.interval);
      date.setUTCDate(
        Math.min(
          origin.getUTCDate(),
          new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(),
        ),
      );
    } else
      date.setUTCDate(origin.getUTCDate() + index * r.interval * (r.repeat === 'weekly' ? 7 : 1));
    if (+date > max + 2 * day) break;
    const stamp = date.toISOString().slice(0, 16);
    if (r.until && stamp.slice(0, 10) > r.until) break;
    if (!r.weekdays.length || r.weekdays.includes(date.getUTCDay())) add(stamp);
  }
  return result.sort();
}
export function nextTiming(rule, after = Date.now()) {
  const r = validateTiming(rule);
  if (!r.start && r.repeat !== 'dates') return null;
  // Monthly/custom intervals can be farther away than the visible Calendar horizon.
  for (let years = 0; years < 32; years++) {
    const begin = after + years * 366 * 86400000,
      found = occurrences(r, begin, begin + 366 * 86400000, 1)[0];
    if (found) return found;
    if (r.repeat === 'none' || (r.until && r.until < new Date(begin).toISOString().slice(0, 10)))
      return null;
  }
  return null;
}
