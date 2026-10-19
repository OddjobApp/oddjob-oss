import React from 'react';
import { CalendarCheck } from 'lucide-react';
import type { WorkspaceResultItem } from '@shared/crew-workspace-results';
import { GoogleWorkspaceIcon } from './GoogleWorkspaceIcon';
import { calendarTime } from './approvals/CalendarApprovalView';

export interface CalendarReceipt {
  status: string;
  title: string;
  start?: string;
  end?: string;
  timeZone?: string;
  location?: string;
  url?: string;
  /** The selected item the card replaces, when one supplied the event details. */
  item?: WorkspaceResultItem;
}

const ACTION_STATUS: Record<string, string> = {
  'create event': 'Event added',
  'update event': 'Event updated',
  'delete event': 'Event deleted',
  'move event': 'Event moved',
  'respond event': 'Response recorded',
  'create calendar': 'Calendar created',
  'update calendar': 'Calendar updated',
  'delete calendar': 'Calendar deleted',
};

const EVENT_LINK = /^https:\/\/(?:calendar\.google\.com|www\.google\.com)\//;

/**
 * The "Calendar change applied: {title}. Result: {flattened event}" line a
 * decided calendar action leaves in a room. The Result is the raw Google
 * event resource flattened to 'Key: value' lines (shared/approval-args.ts) —
 * readable keys, but a wall of provider metadata. This pulls the card-worthy
 * fields back out, preferring the structured selected item the turn carries.
 */
export function parseCalendarReceipt(message: string, items: WorkspaceResultItem[] = []): CalendarReceipt | null {
  if (!/^Calendar change applied:/.test(message)) return null;
  const rest = message.replace(/^Calendar change applied:\s*/, '');
  const resultAt = rest.search(/\sResult:\s/);
  const head = (resultAt < 0 ? rest : rest.slice(0, resultAt)).replace(/[\s.]+$/, '').trim();
  const dump = resultAt < 0 ? '' : rest.slice(resultAt).replace(/^\s*Result:\s*/, '');

  const prefix = head.match(/^((?:create|update|delete|move|respond)\s+(?:event|calendar)):\s*([\s\S]+)$/i);
  const action = prefix?.[1]?.toLowerCase();
  const actionTitle = (prefix?.[2] ?? head).trim();

  const field = (key: string) => dump.match(new RegExp(`(?:^|\\n)${key}:\\s*([^\\n]*)`))?.[1]?.trim() || undefined;
  const when = (label: string) => {
    const m = field(label)?.match(/^Date(?:\s+time)?:\s*(\S+)(?:\s+Time\s+zone:\s*(\S+))?/i);
    return { value: m?.[1], timeZone: m?.[2] };
  };
  const start = when('Start');
  const end = when('End');
  const cancelled = field('Status') === 'cancelled';

  const item = items.find(i => i?.kind === 'calendar');
  const url = [item?.url, field('Html link')].find(u => typeof u === 'string' && EVENT_LINK.test(u));

  return {
    status: cancelled ? 'Event removed' : (action && ACTION_STATUS[action]) || 'Change applied',
    title: item?.title || field('Summary') || actionTitle || 'Calendar event',
    start: item?.start ?? start.value,
    end: item?.end ?? end.value,
    timeZone: item?.timeZone ?? start.timeZone ?? end.timeZone,
    location: item?.location ?? field('Location'),
    url,
    item,
  };
}

const asTime = (iso?: string) =>
  iso ? (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? { date: iso } : { dateTime: iso }) : undefined;

/** IANA name only when it is real — a stored turn can carry anything. */
const safeZone = (zone?: string) => {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
};

export function CalendarChangeReceiptCard({ receipt, details }: { receipt: CalendarReceipt; details: React.ReactNode }) {
  const timeZone = safeZone(receipt.timeZone);
  return (
    <div className="w-full" data-testid="calendar-change-receipt">
      <div className="rounded-md border border-border/70 bg-card text-foreground shadow-xs">
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
          <GoogleWorkspaceIcon kind="calendar" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left font-medium">{receipt.title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-emerald-500">
            <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
            {receipt.status}
          </span>
        </div>
        {(receipt.start || receipt.end || receipt.location || timeZone) && (
          <dl className="space-y-0.5 border-t border-border/60 px-2.5 py-1.5 text-xs">
            {receipt.start && (
              <div>
                <dt className="inline text-muted-foreground">Starts: </dt>
                <dd className="inline">{calendarTime(asTime(receipt.start)!, timeZone)}</dd>
              </div>
            )}
            {receipt.end && (
              <div>
                <dt className="inline text-muted-foreground">Ends: </dt>
                <dd className="inline">{calendarTime(asTime(receipt.end)!, timeZone)}</dd>
              </div>
            )}
            {timeZone && <div className="text-muted-foreground">Time zone: {timeZone}</div>}
            {receipt.location && (
              <div>
                <dt className="inline text-muted-foreground">Location: </dt>
                <dd className="inline break-words">{receipt.location}</dd>
              </div>
            )}
          </dl>
        )}
        {receipt.url && (
          <div className="border-t border-border/60 px-2.5 py-1.5">
            <a
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              href={receipt.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open calendar event
            </a>
          </div>
        )}
      </div>
      <details className="mt-1.5 text-xs">
        <summary className="cursor-pointer opacity-75">Receipt details</summary>
        <div className="mt-1 whitespace-pre-wrap break-words">{details}</div>
      </details>
    </div>
  );
}
