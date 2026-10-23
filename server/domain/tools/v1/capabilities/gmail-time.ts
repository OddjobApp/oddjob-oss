import { calendarRange } from './calendar-time.js';

/** Gmail date strings use PST; epoch seconds preserve the requested local day. */
export function gmailDayQuery(query: string, timeRange?: 'today', timeZone?: string, now = new Date()) {
  if (!timeRange) return query;
  if (!timeZone) throw new Error('A time_zone is required for today. Use the user-requested IANA time zone; do not assume UTC.');
  if (/\b(?:after|before|newer|older|newer_than|older_than):/i.test(query)) {
    throw new Error('Use time_range and time_zone without date operators in query; the server supplies exact day boundaries.');
  }
  const { time_min, time_max } = calendarRange('today', timeZone, now);
  // after is exclusive: include the exact midnight second as part of today.
  return `${query} after:${Date.parse(time_min) / 1000 - 1} before:${Date.parse(time_max) / 1000}`.trim();
}
