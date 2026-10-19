/**
 * Recurrence expansion.
 *
 * The failure modes here are quiet: a series that backfills before it started,
 * an anchor that appears on a day its own rule excludes, an occurrence that
 * loses its duration, or an open-ended rule that never terminates. Each of those
 * still renders a calendar that looks fine.
 */

import { describe, expect, it } from 'vitest';
import {
  expandOccurrences,
  nextOccurrence,
  isValidRecurrence,
  type RecurringEventInput,
} from './project-event-recurrence.js';

const iso = (s: string) => new Date(s);

const event = (over: Partial<RecurringEventInput> = {}): RecurringEventInput => ({
  id: 1,
  startsAt: '2026-03-02T09:00:00.000Z', // a Monday
  ...over,
});

describe('isValidRecurrence', () => {
  it.each(['0 9 * * 1', '*/15 * * * *', '0 0 1 * *'])('accepts %s', expr => {
    expect(isValidRecurrence(expr)).toBe(true);
  });

  it.each(['not a cron', '99 * * * *', ''])('rejects %s', expr => {
    expect(isValidRecurrence(expr)).toBe(false);
  });
});

describe('one-off events', () => {
  it('yields itself when inside the window', () => {
    const result = expandOccurrences(event(), iso('2026-03-01'), iso('2026-03-31'));
    expect(result).toHaveLength(1);
    expect(result[0].isRecurrence).toBe(false);
  });

  it('yields nothing when outside it', () => {
    expect(expandOccurrences(event(), iso('2026-04-01'), iso('2026-04-30'))).toHaveLength(0);
  });
});

describe('recurring events', () => {
  const weekly = event({ recurrence: '0 9 * * 1' }); // every Monday 09:00

  it('generates one occurrence per period', () => {
    // 2 Mar to 30 Mar 2026 inclusive contains five Mondays.
    const result = expandOccurrences(weekly, iso('2026-03-01'), iso('2026-03-31T23:59:59Z'));
    expect(result).toHaveLength(5);
    for (const o of result) expect(o.startsAt.getUTCDay()).toBe(1);
  });

  it('never backfills before the anchor', () => {
    // The rule matches Mondays in February too, but the series starts in March.
    const result = expandOccurrences(weekly, iso('2026-01-01'), iso('2026-03-31T23:59:59Z'));
    for (const o of result) expect(o.startsAt >= new Date(weekly.startsAt as string)).toBe(true);
  });

  it('marks the anchor date itself as not a repeat', () => {
    const result = expandOccurrences(weekly, iso('2026-03-01'), iso('2026-03-31T23:59:59Z'));
    const anchorOccurrence = result.find(
      o => o.startsAt.getTime() === new Date(weekly.startsAt as string).getTime(),
    );
    expect(anchorOccurrence?.isRecurrence).toBe(false);
    expect(result.filter(o => o.isRecurrence)).toHaveLength(4);
  });

  it('does not emit the anchor on a day its own rule excludes', () => {
    // Anchored on a Wednesday, recurring Mondays: the Wednesday is the series
    // start, not an occurrence, and showing it would be a phantom entry.
    const wednesdayAnchor = event({ startsAt: '2026-03-04T09:00:00.000Z', recurrence: '0 9 * * 1' });
    const result = expandOccurrences(wednesdayAnchor, iso('2026-03-01'), iso('2026-03-31T23:59:59Z'));

    expect(result.every(o => o.startsAt.getUTCDay() === 1)).toBe(true);
  });

  it('stops at recurrenceUntil', () => {
    const bounded = event({ recurrence: '0 9 * * 1', recurrenceUntil: '2026-03-16T23:59:59Z' });
    const result = expandOccurrences(bounded, iso('2026-03-01'), iso('2026-12-31'));

    expect(result).toHaveLength(3); // 2nd, 9th, 16th
  });

  it('carries the duration onto every occurrence', () => {
    // A two-hour review is two hours every week, not just the first one.
    const ranged = event({
      recurrence: '0 9 * * 1',
      endsAt: '2026-03-02T11:00:00.000Z',
    });
    const result = expandOccurrences(ranged, iso('2026-03-01'), iso('2026-03-31T23:59:59Z'));

    for (const o of result) {
      expect(o.endsAt!.getTime() - o.startsAt.getTime()).toBe(2 * 60 * 60 * 1000);
    }
  });

  it('gives each occurrence a distinct, stable id', () => {
    const first = expandOccurrences(weekly, iso('2026-03-01'), iso('2026-03-31T23:59:59Z'));
    const again = expandOccurrences(weekly, iso('2026-03-01'), iso('2026-03-31T23:59:59Z'));

    expect(new Set(first.map(o => o.occurrenceId)).size).toBe(first.length);
    expect(first.map(o => o.occurrenceId)).toEqual(again.map(o => o.occurrenceId));
  });

  it('bounds a pathological rule instead of hanging', () => {
    // Every minute for a year is ~525k dates; the cap has to hold.
    const everyMinute = event({ recurrence: '* * * * *' });
    const result = expandOccurrences(everyMinute, iso('2026-03-01'), iso('2027-03-01'));

    expect(result.length).toBeLessThanOrEqual(500);
  });

  it('falls back to the anchor when the rule no longer parses', () => {
    // A corrupted rule must not blank the timeline — the anchor is the one date
    // we still know was intended.
    const broken = event({ recurrence: 'nonsense' });
    const result = expandOccurrences(broken, iso('2026-03-01'), iso('2026-03-31'));

    expect(result).toHaveLength(1);
    expect(result[0].isRecurrence).toBe(false);
  });
});

describe('nextOccurrence', () => {
  it('finds the next date for a live series', () => {
    const next = nextOccurrence(event({ recurrence: '0 9 * * 1' }), iso('2026-03-03T00:00:00Z'));
    expect(next?.toISOString()).toBe('2026-03-09T09:00:00.000Z');
  });

  it('returns null once the series has ended', () => {
    const ended = event({ recurrence: '0 9 * * 1', recurrenceUntil: '2026-03-10T00:00:00Z' });
    expect(nextOccurrence(ended, iso('2026-06-01'))).toBeNull();
  });

  it('returns null for a one-off already in the past', () => {
    expect(nextOccurrence(event(), iso('2026-06-01'))).toBeNull();
  });

  it('returns the date itself for a future one-off', () => {
    expect(nextOccurrence(event(), iso('2026-01-01'))?.toISOString()).toBe('2026-03-02T09:00:00.000Z');
  });
});
