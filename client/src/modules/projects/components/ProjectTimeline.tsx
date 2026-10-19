/**
 * The project timeline, in three readings of one dataset.
 *
 *   Agenda   — what is coming, soonest first. The working view.
 *   Calendar — a month block grid, for "what does that week look like".
 *   Gantt    — spans on a date axis, for overlap and pressure.
 *
 * On reusing the cycle Gantt: `CycleGanttChart` is driven by durations and
 * dependencies through a CPM engine, positioning bars relative to a cycle start
 * — and its drag-to-reschedule moves work around. Project events are
 * absolute-dated and mostly point-in-time; a regulatory deadline does not move
 * because someone dragged it. Feeding events through that model would mean
 * inventing `estimatedDays` and dependencies that do not exist, and inheriting
 * an interaction that is wrong here. What is reused instead is its visual
 * language — the same lanes, day grid and severity colouring — over an absolute
 * date axis, which is what this data actually is.
 */

import { useMemo, useState } from 'react';
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  addDays,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GanttChartSquare,
  ListOrdered,
} from 'lucide-react';
import { expandOccurrences } from '@shared/contracts/project-event-recurrence';
import type { ProjectEvent } from '../hooks/use-projects';

/** An event as placed on the timeline: one row may yield many of these. */
export interface PlacedEvent extends ProjectEvent {
  /** The date THIS placement falls on, which is the anchor for a one-off. */
  occurrenceStartsAt: Date;
  occurrenceEndsAt: Date | null;
  occurrenceId: string;
  isRecurrence: boolean;
}

/**
 * Expands recurring rows into the dates they actually land on inside a window.
 *
 * Every view runs this rather than reading the stored date directly: a weekly review
 * is one row, and a calendar that rendered the row would show it once, in the
 * week it was created, and never again.
 */
export function placeEvents(events: ProjectEvent[], from: Date, to: Date): PlacedEvent[] {
  return events
    .flatMap(event =>
      expandOccurrences(
        {
          id: event.id,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          recurrence: event.recurrence,
          recurrenceTimezone: event.recurrenceTimezone,
          recurrenceUntil: event.recurrenceUntil,
        },
        from,
        to,
      ).map(o => ({
        ...event,
        occurrenceStartsAt: o.startsAt,
        occurrenceEndsAt: o.endsAt,
        occurrenceId: o.occurrenceId,
        isRecurrence: o.isRecurrence,
      })),
    )
    .sort((a, b) => a.occurrenceStartsAt.getTime() - b.occurrenceStartsAt.getTime());
}

export type TimelineView = 'agenda' | 'calendar' | 'gantt';

/** Severity drives colour everywhere, so the three views read identically. */
const SEVERITY_STYLES: Record<ProjectEvent['severity'], { dot: string; bar: string; text: string }> = {
  Critical: { dot: 'bg-rose-500', bar: 'bg-rose-500/80', text: 'text-rose-500' },
  High: { dot: 'bg-amber-500', bar: 'bg-amber-500/80', text: 'text-amber-500' },
  Medium: { dot: 'bg-sky-500', bar: 'bg-sky-500/80', text: 'text-sky-500' },
  Low: { dot: 'bg-muted-foreground', bar: 'bg-muted-foreground/60', text: 'text-muted-foreground' },
};

function formatDay(d: Date): string {
  return format(d, 'EEE d MMM');
}

/**
 * "in 3 days" / "tomorrow" / "2 days ago".
 *
 * differenceInCalendarDays, not a millisecond subtraction: 23:00 to 01:00 is two
 * hours but a different day, and people read that as tomorrow. It also absorbs
 * daylight-saving transitions, where a "day" is 23 or 25 hours.
 */
function relativeDay(target: Date, now = new Date()): string {
  const days = differenceInCalendarDays(target, now);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

function EventDot({ severity }: { severity: ProjectEvent['severity'] }) {
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', SEVERITY_STYLES[severity].dot)} />;
}

// ── Agenda ───────────────────────────────────────────────────────────────────

function AgendaView({ events, onSelect }: { events: PlacedEvent[]; onSelect: (e: PlacedEvent) => void }) {
  const now = new Date();

  // Upcoming first and ascending, because an agenda is read forwards; past
  // events stay available underneath rather than being hidden, since "what did
  // we just miss" is a real question.
  const { upcoming, past } = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => a.occurrenceStartsAt.getTime() - b.occurrenceStartsAt.getTime(),
    );
    return {
      upcoming: sorted.filter(e => e.occurrenceStartsAt >= startOfDay(now)),
      past: sorted.filter(e => e.occurrenceStartsAt < startOfDay(now)).reverse(),
    };
  }, [events]);

  const Row = ({ event }: { event: PlacedEvent }) => (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3 text-left transition-colors hover:bg-card"
      data-testid={`agenda-event-${event.id}`}
    >
      <EventDot severity={event.severity} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{event.title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {relativeDay(event.occurrenceStartsAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="capitalize">{event.kind}</span>
          <span>·</span>
          <span>{formatDay(event.occurrenceStartsAt)}</span>
          {event.recurrence && (
            <>
              <span>·</span>
              <span title={event.recurrence}>repeats</span>
            </>
          )}
          {event.severity !== 'Medium' && (
            <>
              <span>·</span>
              <span className={SEVERITY_STYLES[event.severity].text}>{event.severity}</span>
            </>
          )}
        </div>
        {event.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{event.description}</p>
        )}
      </div>
    </button>
  );

  return (
    <div className="space-y-4" data-testid="project-agenda">
      <section className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Upcoming</h4>
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing scheduled ahead.</p>
        ) : (
          upcoming.map(e => <Row key={e.occurrenceId} event={e} />)
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-2 opacity-70">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Past</h4>
          {past.slice(0, 10).map(e => <Row key={e.occurrenceId} event={e} />)}
        </section>
      )}
    </div>
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────────

function CalendarView({ events, onSelect }: { events: PlacedEvent[]; onSelect: (e: PlacedEvent) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  // Whole weeks, Monday-first. date-fns owns the arithmetic rather than a
  // hand-rolled modulo: week starts, month lengths and daylight-saving
  // transitions are exactly the cases a bespoke calculation gets subtly wrong
  // while still rendering a plausible-looking grid.
  const days = useMemo(
    () => eachDayOfInterval({
      start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
      end: endOfWeek(addMonths(startOfMonth(month), 1), { weekStartsOn: 1 }),
    }).slice(0, 42),
    [month],
  );

  const byDay = useMemo(() => {
    const map = new Map<number, PlacedEvent[]>();
    for (const event of events) {
      const key = startOfDay(event.occurrenceStartsAt).getTime();
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);

  const today = new Date();

  return (
    <div className="space-y-2" data-testid="project-calendar">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          {format(month, 'MMMM yyyy')}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Previous month" data-testid="calendar-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={() => setMonth(startOfMonth(today))}
            data-testid="calendar-today"
          >
            Today
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Next month" data-testid="calendar-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => (
          <div key={label} className="bg-card px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
        ))}

        {days.map(day => {
          const dayEvents = byDay.get(startOfDay(day).getTime()) ?? [];
          const inMonth = day.getMonth() === month.getMonth();
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'min-h-[72px] bg-card p-1.5 transition-colors',
                !inMonth && 'bg-card/40 text-muted-foreground/50',
                isSameDay(day, today) && 'ring-1 ring-inset ring-primary/50',
              )}
              data-testid={`calendar-day-${format(day, 'yyyy-MM-dd')}`}
            >
              <div className={cn('mb-1 text-[11px]', isSameDay(day, today) && 'font-bold text-primary')}>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map(event => (
                  <button
                    key={event.occurrenceId}
                    type="button"
                    onClick={() => onSelect(event)}
                    title={event.title}
                    className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted"
                  >
                    <EventDot severity={event.severity} />
                    <span className="truncate text-[10px] text-foreground">{event.title}</span>
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <span className="pl-1 text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Gantt ────────────────────────────────────────────────────────────────────

function GanttView({ events, onSelect }: { events: PlacedEvent[]; onSelect: (e: PlacedEvent) => void }) {
  const { lanes, rangeStart, totalDays } = useMemo(() => {
    if (events.length === 0) return { lanes: [], rangeStart: new Date(), totalDays: 1 };

    const sorted = [...events].sort(
      (a, b) => a.occurrenceStartsAt.getTime() - b.occurrenceStartsAt.getTime(),
    );
    const start = startOfDay(sorted[0].occurrenceStartsAt);
    const end = sorted.reduce((latest, e) => {
      const finish = startOfDay(e.occurrenceEndsAt ?? e.occurrenceStartsAt);
      return finish > latest ? finish : latest;
    }, start);

    // A single-day project would divide by zero and render a bar of infinite
    // width; one day of padding also stops a point event hugging the edge.
    const span = Math.max(1, differenceInCalendarDays(end, start) + 1);

    return { lanes: sorted, rangeStart: start, totalDays: span };
  }, [events]);

  if (events.length === 0) return null;

  return (
    <div className="space-y-1.5 overflow-x-auto" data-testid="project-gantt">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatDay(rangeStart)}</span>
        <span>{formatDay(addDays(rangeStart, totalDays - 1))}</span>
      </div>

      {lanes.map(event => {
        const start = startOfDay(event.occurrenceStartsAt);
        const finish = startOfDay(event.occurrenceEndsAt ?? event.occurrenceStartsAt);
        const offsetDays = differenceInCalendarDays(start, rangeStart);
        const spanDays = Math.max(1, differenceInCalendarDays(finish, start) + 1);

        const left = (offsetDays / totalDays) * 100;
        // Point-in-time events get a visible minimum width; without it a
        // deadline renders as a hairline nobody can click.
        const width = Math.max((spanDays / totalDays) * 100, 2);

        return (
          <button
            key={event.occurrenceId}
            type="button"
            onClick={() => onSelect(event)}
            className="group flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted/50"
            data-testid={`gantt-event-${event.id}`}
          >
            <span className="w-40 shrink-0 truncate text-[11px] text-foreground">{event.title}</span>
            <span className="relative h-4 flex-1 rounded bg-muted/40">
              <span
                className={cn('absolute inset-y-0 rounded', SEVERITY_STYLES[event.severity].bar)}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${formatDay(start)}${event.endsAt ? ` → ${formatDay(finish)}` : ''}`}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Switcher ─────────────────────────────────────────────────────────────────

const VIEWS: { id: TimelineView; label: string; icon: typeof ListOrdered }[] = [
  { id: 'agenda', label: 'Agenda', icon: ListOrdered },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'gantt', label: 'Gantt', icon: GanttChartSquare },
];

export function ProjectTimeline({
  events,
  view,
  onViewChange,
  onSelect,
}: {
  events: ProjectEvent[];
  view: TimelineView;
  onViewChange: (view: TimelineView) => void;
  onSelect: (event: PlacedEvent) => void;
}) {
  // A year either side: wide enough that paging the calendar or scrolling the
  // agenda never hits an empty edge, bounded so an open-ended daily rule cannot
  // expand forever.
  const placed = useMemo(() => {
    const now = new Date();
    return placeEvents(events, addMonths(now, -12), addMonths(now, 12));
  }, [events]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1" role="tablist" aria-label="Timeline view">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            variant={view === id ? 'secondary' : 'ghost'}
            size="sm"
            className="gap-1.5"
            onClick={() => onViewChange(id)}
            data-testid={`timeline-view-${id}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {/* The calendar still renders its grid when empty — a month with nothing in
          it is a legitimate thing to look at, and it is where the first event
          gets added. A list or a bar chart with no rows is just a blank space,
          so those get the explanatory card instead. */}
      {view === 'calendar' ? (
        <CalendarView events={placed} onSelect={onSelect} />
      ) : placed.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nothing on this project's timeline yet. Add a deadline, launch or milestone and the crew
            will pick it up as a conversation starter.
          </CardContent>
        </Card>
      ) : view === 'agenda' ? (
        <AgendaView events={placed} onSelect={onSelect} />
      ) : (
        <GanttView events={placed} onSelect={onSelect} />
      )}
    </div>
  );
}

export { SEVERITY_STYLES, relativeDay, formatDay };
