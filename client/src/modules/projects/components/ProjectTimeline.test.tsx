/**
 * The three timeline views.
 *
 * Date arithmetic is where calendars go wrong quietly: an off-by-one in the
 * month grid still renders a plausible-looking calendar, and a Gantt with a bad
 * denominator still draws bars. So these assert positions and boundaries rather
 * than that something appeared.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import { ProjectTimeline, relativeDay } from './ProjectTimeline';
import type { ProjectEvent } from '../hooks/use-projects';

/**
 * Every fixture below is relative to "now" — `at()` offsets from today, and the
 * recurring fixture anchors on tomorrow — while the calendar renders the month
 * around today. Those two only agree in the middle of a month: run on the 31st,
 * "tomorrow" is already the next month, the grid holds just its five trailing
 * cells, and `places each occurrence on its own calendar day` fails for the date
 * rather than for a defect.
 *
 * So the clock is pinned to the same instant the relativeDay cases use. Only
 * Date is faked — timers stay real, so React Testing Library is untouched.
 */
const PINNED_NOW = new Date(2026, 7, 10, 12, 0, 0); // Monday 10 August 2026, local noon

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

afterEach(cleanup);

const at = (offsetDays: number, over: Partial<ProjectEvent> = {}): ProjectEvent => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(12, 0, 0, 0);
  return {
    id: over.id ?? Math.abs(offsetDays) + 1,
    projectId: 1,
    title: over.title ?? `Event ${offsetDays}`,
    description: over.description ?? null,
    kind: over.kind ?? 'milestone',
    severity: over.severity ?? 'Medium',
    startsAt: d.toISOString(),
    endsAt: over.endsAt ?? null,
    createdBy: 'test',
    ...over,
  } as ProjectEvent;
};

const renderTimeline = (events: ProjectEvent[], view: 'agenda' | 'calendar' | 'gantt' = 'agenda') =>
  render(
    <ProjectTimeline events={events} view={view} onViewChange={vi.fn()} onSelect={vi.fn()} />,
  );

describe('relativeDay', () => {
  const base = new Date('2026-08-10T12:00:00Z');

  it.each([
    [0, 'today'],
    [1, 'tomorrow'],
    [-1, 'yesterday'],
    [3, 'in 3 days'],
    [-4, '4 days ago'],
  ])('renders %s days out as "%s"', (offset, expected) => {
    const target = new Date(base);
    target.setDate(target.getDate() + offset);
    expect(relativeDay(target, base)).toBe(expected);
  });

  it('compares whole days, not elapsed hours', () => {
    // 11pm to 1am is two hours but a different day, and users read it as
    // "tomorrow". Comparing timestamps would call it "today".
    const late = new Date('2026-08-10T23:00:00');
    const earlyNext = new Date('2026-08-11T01:00:00');
    expect(relativeDay(earlyNext, late)).toBe('tomorrow');
  });
});

describe('agenda view', () => {
  it('separates what is ahead from what has passed', () => {
    renderTimeline([at(-5, { title: 'Behind us' }), at(5, { title: 'Ahead of us' })]);

    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('Past')).toBeInTheDocument();
    expect(screen.getByText('Ahead of us')).toBeInTheDocument();
    expect(screen.getByText('Behind us')).toBeInTheDocument();
  });

  it('orders upcoming soonest-first', () => {
    const { container } = renderTimeline([at(9, { title: 'Later' }), at(2, { title: 'Sooner' })]);

    const rendered = Array.from(container.querySelectorAll('[data-testid^="agenda-event-"]'))
      .map(el => el.textContent ?? '');
    expect(rendered.findIndex(t => t.includes('Sooner')))
      .toBeLessThan(rendered.findIndex(t => t.includes('Later')));
  });

  it('omits the Past heading when nothing has passed', () => {
    renderTimeline([at(3)]);
    expect(screen.queryByText('Past')).toBeNull();
  });

  it('treats something earlier today as upcoming, not past', () => {
    // Boundary is the start of the day: an event at 09:00 seen at 17:00 is
    // still "today's business", and burying it under Past hides it.
    const earlierToday = at(0);
    renderTimeline([earlierToday]);

    const upcoming = screen.getByText('Upcoming').parentElement!;
    expect(within(upcoming).getByText(earlierToday.title)).toBeInTheDocument();
  });
});

describe('calendar view', () => {
  it('always renders six whole weeks so the grid does not reflow when paging', () => {
    const { container } = renderTimeline([at(1)], 'calendar');
    const days = container.querySelectorAll('[data-testid^="calendar-day-"]');
    expect(days).toHaveLength(42);
  });

  it('aligns the grid to Monday, not just the column headers', () => {
    // Asserting the headers would pass even if the grid started on Sunday —
    // they are a hardcoded array. The real question is which date lands in the
    // first cell, so that is what this reads.
    const { container } = renderTimeline([], 'calendar');

    const firstCell = container.querySelector('[data-testid^="calendar-day-"]')!;
    const firstDate = new Date(`${firstCell.getAttribute('data-testid')!.replace('calendar-day-', '')}T00:00:00`);

    expect(firstDate.getDay()).toBe(1); // 1 = Monday
  });

  it('runs the grid contiguously, one day per cell', () => {
    const { container } = renderTimeline([], 'calendar');
    const dates = Array.from(container.querySelectorAll('[data-testid^="calendar-day-"]')).map(
      el => new Date(`${el.getAttribute('data-testid')!.replace('calendar-day-', '')}T00:00:00`),
    );

    for (let i = 1; i < dates.length; i++) {
      const gapDays = Math.round((dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000);
      // Exactly one day apart everywhere, including across a DST boundary where
      // a naive +24h step would drift.
      expect(gapDays).toBe(1);
    }
  });

  it('covers the whole month it is showing', () => {
    const { container } = renderTimeline([], 'calendar');
    const label = screen.getByText(/\w+ \d{4}/).textContent!;
    const shown = new Date(`${label} 1`);

    const dates = Array.from(container.querySelectorAll('[data-testid^="calendar-day-"]')).map(
      el => new Date(`${el.getAttribute('data-testid')!.replace('calendar-day-', '')}T00:00:00`),
    );
    const inMonth = dates.filter(d => d.getMonth() === shown.getMonth());
    const daysInMonth = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();

    expect(inMonth).toHaveLength(daysInMonth);
  });

  it('places an event on its own day cell', () => {
    const event = at(2, { title: 'Placed precisely' });
    const key = new Date(event.startsAt).toISOString().slice(0, 10);

    renderTimeline([event], 'calendar');

    const cell = screen.getByTestId(`calendar-day-${key}`);
    expect(within(cell).getByText('Placed precisely')).toBeInTheDocument();
  });

  it('collapses a crowded day rather than overflowing the cell', () => {
    const crowded = [1, 2, 3, 4, 5].map(i => at(2, { id: i, title: `Event ${i}` }));
    renderTimeline(crowded, 'calendar');

    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('pages between months', () => {
    renderTimeline([], 'calendar');
    const initial = screen.getByText(/\w+ \d{4}/).textContent;

    fireEvent.click(screen.getByTestId('calendar-next'));
    expect(screen.getByText(/\w+ \d{4}/).textContent).not.toBe(initial);

    fireEvent.click(screen.getByTestId('calendar-today'));
    expect(screen.getByText(/\w+ \d{4}/).textContent).toBe(initial);
  });
});

describe('gantt view', () => {
  it('gives a point-in-time event a clickable minimum width', () => {
    // Without a floor, a zero-duration deadline across a long project renders
    // as a hairline nobody can hit.
    const { container } = renderTimeline([at(0, { title: 'Point' }), at(90, { title: 'Far' })], 'gantt');

    const bar = container.querySelector('[data-testid="gantt-event-1"] span[style]') as HTMLElement;
    expect(parseFloat(bar.style.width)).toBeGreaterThanOrEqual(2);
  });

  it('positions a later event further along the axis', () => {
    const { container } = renderTimeline(
      [at(0, { id: 1, title: 'Start' }), at(30, { id: 2, title: 'End' })],
      'gantt',
    );

    const first = container.querySelector('[data-testid="gantt-event-1"] span[style]') as HTMLElement;
    const second = container.querySelector('[data-testid="gantt-event-2"] span[style]') as HTMLElement;
    expect(parseFloat(second.style.left)).toBeGreaterThan(parseFloat(first.style.left));
  });

  it('survives every event falling on one day', () => {
    // A single-day range is the divide-by-zero case.
    const { container } = renderTimeline([at(3, { id: 1 }), at(3, { id: 2 })], 'gantt');

    const bars = container.querySelectorAll('span[style]');
    for (const bar of Array.from(bars) as HTMLElement[]) {
      expect(Number.isFinite(parseFloat(bar.style.width))).toBe(true);
    }
  });

  it('draws a ranged event wider than a point event', () => {
    const ends = new Date();
    ends.setDate(ends.getDate() + 10);

    const { container } = renderTimeline(
      [at(0, { id: 1, title: 'Span', endsAt: ends.toISOString() }), at(20, { id: 2, title: 'Point' })],
      'gantt',
    );

    const span = container.querySelector('[data-testid="gantt-event-1"] span[style]') as HTMLElement;
    const point = container.querySelector('[data-testid="gantt-event-2"] span[style]') as HTMLElement;
    expect(parseFloat(span.style.width)).toBeGreaterThan(parseFloat(point.style.width));
  });
});

describe('recurring events', () => {
  /**
   * Anchored to an absolute instant rather than "tomorrow at 9 local".
   *
   * The rule runs in UTC, so a local anchor makes the first occurrence depend on
   * the runner's offset: at UTC-7 an anchor of 09:00 local is 16:00Z, the next
   * 09:00Z is the following day, and every count below shifts by one. Pinned to
   * 09:00Z, the anchor IS the first occurrence everywhere, which is what lets
   * these assert a number instead of a range.
   */
  const ANCHOR = new Date(Date.UTC(2026, 7, 11, 9, 0, 0)); // 11 Aug 2026, the day after PINNED_NOW

  const weekly = (over: Partial<ProjectEvent> = {}): ProjectEvent => ({
    ...at(1),
    title: 'Weekly review',
    // Every day, so the assertion does not depend on which weekday the suite runs.
    recurrence: '0 9 * * *',
    recurrenceTimezone: 'UTC',
    recurrenceUntil: null,
    startsAt: ANCHOR.toISOString(),
    ...over,
  } as ProjectEvent);

  it('appears on many days from a single row', () => {
    // The regression that matters: rendering the stored row would show a weekly
    // review once, in the week it was created, and never again.
    const { container } = renderTimeline([weekly()]);
    const rows = container.querySelectorAll('[data-testid^="agenda-event-"]');

    // A year of daily occurrences: the view places from now to twelve months
    // out. Not an equality, and this is the one count that cannot be: the far
    // edge of that window is derived from the LOCAL clock, so whether the last
    // day falls inside it moves by one with the runner's offset. Everything
    // this test is about — that one row becomes a year of days rather than a
    // single entry — is decided long before that edge.
    expect(rows.length).toBeGreaterThanOrEqual(364);
    expect(rows.length).toBeLessThanOrEqual(366);
  });

  it('marks a repeating event as such', () => {
    renderTimeline([weekly()]);
    expect(screen.getAllByText('repeats').length).toBeGreaterThan(0);
  });

  it('stops at recurrenceUntil', () => {
    // 10:00Z on the third day: past that morning's occurrence, short of the
    // next one, so the series is exactly three long in any timezone.
    const until = new Date(Date.UTC(2026, 7, 13, 10, 0, 0));

    const { container } = renderTimeline([weekly({ recurrenceUntil: until.toISOString() })]);
    const rows = container.querySelectorAll('[data-testid^="agenda-event-"]');

    // The 11th, 12th and 13th. Three days of a daily rule, not a year of it.
    expect(rows.length).toBe(3);
  });

  it('places each occurrence on its own calendar day', () => {
    const { container } = renderTimeline([weekly()], 'calendar');
    const cellsWithEvents = Array.from(
      container.querySelectorAll('[data-testid^="calendar-day-"]'),
    ).filter(cell => cell.textContent?.includes('Weekly review'));

    // The grid is whole weeks around August 2026 — Mon 27 Jul to Sun 6 Sep — and
    // the series starts on the 11th, so 11 Aug to 6 Sep inclusive: 27 days, one
    // cell each. A timezone that shifts 09:00Z onto the previous day shifts the
    // whole run, which still lands inside a grid that opens two weeks earlier.
    expect(cellsWithEvents.length).toBe(27);
  });

  it('leaves a one-off on exactly one day', () => {
    const { container } = renderTimeline([at(1, { title: 'One off' })], 'calendar');
    const cells = Array.from(container.querySelectorAll('[data-testid^="calendar-day-"]'))
      .filter(cell => cell.textContent?.includes('One off'));

    expect(cells).toHaveLength(1);
  });
});

describe('empty state', () => {
  it('explains what the timeline is for rather than just saying it is empty', () => {
    renderTimeline([]);
    expect(screen.getByText(/conversation starter/i)).toBeInTheDocument();
  });
});
