export function nextOccurrence(schedule, from = new Date()) {
  if (!schedule?.start || !['daily', 'weekly'].includes(schedule.repeat)) return null;
  if (
    schedule.weekdays?.length &&
    (schedule.repeat !== 'daily' ||
      schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
  )
    throw Error('Weekday selection uses valid days and daily recurrence');
  const next = new Date(schedule.start);
  if (!Number.isFinite(next.getTime())) throw new Error('Invalid schedule');
  const days = schedule.repeat === 'weekly' ? 7 : 1;
  if (schedule.timezone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: schedule.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = (date) =>
      Object.fromEntries(
        formatter
          .formatToParts(date)
          .filter((p) => p.type !== 'literal')
          .map((p) => [p.type, Number(p.value)]),
      );
    const original = parts(next),
      target = new Date(
        Date.UTC(
          original.year,
          original.month - 1,
          original.day,
          original.hour,
          original.minute,
          original.second,
        ),
      );
    while (true) {
      const wall = target.getTime();
      let guess = wall;
      for (let n = 0; n < 4; n++) {
        const actual = parts(new Date(guess));
        const encoded = Date.UTC(
          actual.year,
          actual.month - 1,
          actual.day,
          actual.hour,
          actual.minute,
          actual.second,
        );
        guess += wall - encoded;
      }
      if (
        guess > from.getTime() &&
        (!schedule.weekdays?.length || schedule.weekdays.includes(target.getUTCDay()))
      )
        return new Date(guess).toISOString();
      target.setUTCDate(target.getUTCDate() + days);
    }
  }
  while (next <= from || (schedule.weekdays?.length && !schedule.weekdays.includes(next.getDay())))
    next.setDate(next.getDate() + days);
  return next.toISOString();
}
