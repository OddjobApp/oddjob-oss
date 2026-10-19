/**
 * The platform event stream (`/api/events/stream`), read through one shared
 * connection per browser.
 *
 * Subscribers used to open the stream themselves, each with its own `?type=`
 * filter. They now share one unfiltered, org-scoped connection (see
 * shared-event-source.ts) and filter here, with the same pattern rules the
 * server applies: `*` is one dot-separated segment, `**` any number.
 */
import { resolveActiveOrgId } from '@/lib/queryClient';
import {
  subscribeSharedStream,
  type SharedStreamMessage,
  type SharedStreamOptions,
  type SharedStreamState,
} from './shared-event-source';

export interface PlatformEvent {
  eventId: string;
  eventType: string;
  timestamp: number | string;
  source: string;
  payload: Record<string, any>;
  context?: Record<string, any>;
}

export interface PlatformEventFilter {
  /** Event type patterns; a single string may also be comma-separated. */
  type?: string | string[];
  source?: string;
}

export type EventBusState = SharedStreamState;

export function compileTypeMatcher(type: string | string[] | undefined): (eventType: string) => boolean {
  const patterns = (Array.isArray(type) ? type : type ? type.split(',') : [])
    .map((p) => p.trim())
    .filter((p) => p && p !== 'all' && p !== '*' && p !== '**');
  if (patterns.length === 0) return () => true;
  const regexes = patterns.map((p) => new RegExp(
    '^' +
    p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^.]*')
      .replace(/\u0000/g, '.*') +
    '$',
  ));
  return (eventType) => regexes.some((re) => re.test(eventType));
}

/**
 * The org the stream is scoped to, as last reported by `OrgProvider`.
 * `undefined` until it reports, in which case the URL/sessionStorage precedence
 * is read directly (public pages have no provider).
 */
let reportedOrgId: number | null | undefined;

/** Live subscriptions, so an org change can move them all to the new stream. */
const subscriptions = new Set<{ retarget: () => void }>();

/**
 * `path` scoped to the active org. The org is part of the URL, so tabs on
 * different orgs share nothing and each gets its own scoped stream.
 */
export function orgScopedUrl(path: string): string {
  const orgId = reportedOrgId !== undefined ? reportedOrgId : resolveActiveOrgId();
  return orgId !== null ? `${path}?organizationId=${orgId}` : path;
}

export function eventStreamUrl(): string {
  return orgScopedUrl('/api/events/stream');
}

/**
 * Called by OrgProvider whenever the selected org changes.
 *
 * Subscribers mount before the org is resolved (auth still hydrating) and stay
 * mounted across an org switch. Read once at subscribe time, the org left a
 * tab holding streams for "no org" and a previous org at the same time: two
 * connections, and events from an org the page was no longer showing.
 */
export function setEventStreamOrg(orgId: number | null): void {
  if (reportedOrgId === orgId) return;
  reportedOrgId = orgId;
  for (const subscription of subscriptions) subscription.retarget();
}

/** Test hook. */
export function __resetEventBusOrg(): void {
  reportedOrgId = undefined;
}

/**
 * Subscribe to the shared stream at `path` for the active org, moving to the
 * new org's stream whenever OrgProvider reports a change.
 */
export function subscribeOrgScopedStream(
  path: string,
  onMessage: (message: SharedStreamMessage) => void,
  onState?: (state: SharedStreamState) => void,
  options?: SharedStreamOptions,
): () => void {
  let url = orgScopedUrl(path);
  let unsubscribe = subscribeSharedStream(url, onMessage, onState, options);
  const subscription = {
    retarget() {
      const next = orgScopedUrl(path);
      if (next === url) return;
      // Join the new stream before leaving the old, so nothing is dropped between.
      const previous = unsubscribe;
      url = next;
      unsubscribe = subscribeSharedStream(next, onMessage, onState, options);
      previous();
    },
  };
  subscriptions.add(subscription);

  return () => {
    subscriptions.delete(subscription);
    unsubscribe();
  };
}

function toPlatformEvent(raw: any): PlatformEvent | null {
  if (!raw || typeof raw !== 'object' || typeof raw.eventType !== 'string') return null;
  return {
    eventId: String(raw.eventId ?? ''),
    eventType: raw.eventType,
    timestamp: raw.timestamp ?? Date.now(),
    source: raw.source ?? 'system',
    payload: raw.payload ?? {},
    context: raw.context,
  };
}

/**
 * Subscribe to platform events matching `filter`. On subscribe, the events this
 * tab has already received are replayed (the server also replays its recent
 * buffer when the connection opens), and each event is delivered once per
 * subscriber even when a reconnect or a leader change repeats it.
 */
export function subscribeEvents(
  filter: PlatformEventFilter,
  onEvent: (event: PlatformEvent) => void,
  onState?: (state: EventBusState) => void,
): () => void {
  const matches = compileTypeMatcher(filter.type);
  const seen = new Set<string>();
  const seenOrder: string[] = [];

  const handle = ({ data }: SharedStreamMessage) => {
    let event: PlatformEvent | null;
    try {
      event = toPlatformEvent(JSON.parse(data));
    } catch {
      return;
    }
    if (!event || !matches(event.eventType)) return;
    if (filter.source && event.source !== filter.source) return;
    if (event.eventId) {
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      seenOrder.push(event.eventId);
      if (seenOrder.length > 500) seen.delete(seenOrder.shift()!);
    }
    onEvent(event);
  };

  return subscribeOrgScopedStream('/api/events/stream', handle, onState);
}
