import { expect, it } from 'vitest';
import { gmailDayQuery } from './gmail-time.js';

it('uses the Los Angeles day when UTC is already tomorrow', () => {
  const query = gmailDayQuery('in:inbox', 'today', 'America/Los_Angeles', new Date('2026-10-22T00:16:04Z'));
  expect(query).toBe(`in:inbox after:${Date.parse('2026-10-21T07:00:00Z') / 1000 - 1} before:${Date.parse('2026-10-22T07:00:00Z') / 1000}`);
});
it('handles the 25-hour fall DST day', () => {
  expect(gmailDayQuery('', 'today', 'America/Los_Angeles', new Date('2026-11-01T20:00:00Z'))).toBe(`after:${Date.parse('2026-11-01T07:00:00Z') / 1000 - 1} before:${Date.parse('2026-11-02T08:00:00Z') / 1000}`);
});
it('preserves ordinary queries and rejects ambiguous today boundaries', () => {
  expect(gmailDayQuery('subject:invoice')).toBe('subject:invoice');
  expect(() => gmailDayQuery('', 'today')).toThrow('time_zone');
  expect(() => gmailDayQuery('after:2026/10/22', 'today', 'America/Los_Angeles')).toThrow('without date operators');
  expect(() => gmailDayQuery('', 'today', 'not-a-zone')).toThrow();
});
