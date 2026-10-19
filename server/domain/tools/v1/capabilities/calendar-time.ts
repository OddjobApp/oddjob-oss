/** Convert calendar-local midnight to an instant, including DST transitions. */
export function calendarRange(range: 'today' | 'this_week' | 'next_week', zone: string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  const local = parts(now);
  let start = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day));
  if (range !== 'today') start -= ((new Date(start).getUTCDay() + 6) % 7) * 86400000;
  if (range === 'next_week') start += 7 * 86400000;
  const midnight = (target: number) => {
    let guess = target;
    for (let i = 0; i < 4; i++) {
      const p = parts(new Date(guess));
      const rendered = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
      guess += target - rendered;
    }
    return new Date(guess).toISOString();
  };
  return { time_min: midnight(start), time_max: midnight(start + (range === 'today' ? 1 : 7) * 86400000) };
}
