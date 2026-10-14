import { validateTiming, wallToUTC, wallDate } from './calendar-time.mjs';
const bounded = (value, max, name) => {
  if (typeof value !== 'string' || value.length > max) throw Error('Invalid ' + name);
  return value;
};
export function validateEvent(data) {
  const timing = validateTiming(data.timing),
    allDay = data.allDay === true;
  if (!timing.start) throw Error('Choose an event starting time');
  let duration;
  if (allDay) {
    timing.start = timing.start.slice(0, 10) + 'T00:00';
    const start = wallDate(timing.start.slice(0, 10)),
      end = wallDate(data.endDate || timing.start.slice(0, 10));
    duration = +end - +start + 86400000;
  } else {
    if (!data.endLocal) throw Error('Choose an event end time');
    duration =
      Date.parse(wallToUTC(data.endLocal, timing.timezone, timing.ambiguity)) -
      Date.parse(wallToUTC(timing.start, timing.timezone, timing.ambiguity));
  }
  if (duration <= 0 || duration > 366 * 86400000)
    throw Error('Event end must follow its start within one year');
  if (data.owner && !['user', 'agent'].includes(data.owner)) throw Error('Invalid event ownership');
  if (data.agentProfile && typeof data.agentProfile !== 'string')
    throw Error('Invalid event agent');
  for (const key of ['description', 'location'])
    if (data[key] !== undefined) bounded(data[key], 12000, key);
  if (
    data.exceptions &&
    (!Array.isArray(data.exceptions) ||
      data.exceptions.length > 366 ||
      data.exceptions.some(
        (v) => typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v),
      ))
  )
    throw Error('Invalid recurrence exceptions');
  if (
    data.reminderMinutes !== undefined &&
    (!Number.isInteger(data.reminderMinutes) ||
      data.reminderMinutes < 0 ||
      data.reminderMinutes > 10080)
  )
    throw Error('Invalid reminder lead');
  return {
    ...data,
    timing,
    allDay,
    duration,
    startDate: allDay ? timing.start.slice(0, 10) : data.startDate,
    owner: data.owner || 'user',
    description: data.description || '',
    location: data.location || '',
  };
}
export function validateReportTemplate(data) {
  const timing = validateTiming(data.timing || {});
  if (typeof data.agentProfile !== 'string' || !data.agentProfile)
    throw Error('Choose an agent for this report');
  if (typeof data.enabled !== 'boolean') throw Error('Invalid report enable state');
  if (data.enabled && !timing.start && timing.repeat !== 'dates')
    throw Error('Choose a starting date for automatic reports');
  if (!Array.isArray(data.sections) || !data.sections.length || data.sections.length > 12)
    throw Error('Choose between 1 and 12 report sections');
  const sections = data.sections.map((s) => {
    if (!['calendar', 'tasks', 'projects', 'research', 'custom'].includes(s.type))
      throw Error('Invalid report section');
    const sources = s.sources || [];
    if (
      !Array.isArray(sources) ||
      sources.length > 32 ||
      sources.some((id) => typeof id !== 'string')
    )
      throw Error('Choose at most 32 section sources');
    return {
      ...s,
      id: s.id || s.type,
      title: bounded(s.title || s.type, 150, 'section title'),
      prompt: bounded(s.prompt || '', 12000, 'section request'),
      sources,
      enabled: s.enabled !== false,
    };
  });
  if (!sections.some((s) => s.enabled)) throw Error('Enable at least one report section');
  for (const [key, fallback, max] of [
    ['maxMinutes', 30, 120],
    ['maxSteps', 12, 48],
  ]) {
    const value = data[key] ?? fallback;
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw Error('Invalid report execution limit');
  }
  if (!['brief', 'standard', 'detailed'].includes(data.length || 'standard'))
    throw Error('Invalid report length');
  if (
    !['today', 'tomorrow', 'week', 'past', 'since', 'custom'].includes(
      data.coverage?.mode || 'today',
    )
  )
    throw Error('Invalid coverage period');
  if (
    data.coverage?.mode === 'past' &&
    (!Number.isInteger(data.coverage.days) || data.coverage.days < 1 || data.coverage.days > 366)
  )
    throw Error('Choose 1–366 coverage days');
  if (data.coverage?.mode === 'custom') {
    const from = wallDate(data.coverage.from),
      to = wallDate(data.coverage.to);
    if (+to < +from || +to - +from > 366 * 86400000) throw Error('Invalid report coverage range');
  }
  if (data.delivery && !['quiet', 'notify', 'present'].includes(data.delivery))
    throw Error('Invalid report delivery');
  if (data.preferences !== undefined) bounded(data.preferences, 12000, 'report preferences');
  return {
    ...data,
    timing,
    sections,
    length: data.length || 'standard',
    coverage: data.coverage || { mode: 'today' },
    preferences: data.preferences || '',
    delivery: data.delivery || 'notify',
    images: data.images === true,
  };
}
