/**
 * One EventSource per URL per browser, shared by every subscriber in every tab.
 *
 * Why: the dev server speaks HTTP/1.1, which allows six connections per host per
 * browser profile, and the tabs share them. Each component used to open its own
 * stream (the layout's event notifier, the intervention engine mounted twice,
 * every dashboard block), so two open tabs pinned the pool and every request in
 * every tab stalled. See the "frozen tabs" note in the project memory.
 *
 * How:
 * - Within a tab, subscribers to the same URL share one stream, ref-counted.
 * - Across tabs, the tab holding a Web Lock named after the URL is the leader:
 *   it alone opens the EventSource and relays every message on a
 *   BroadcastChannel. The others wait on the lock and listen to the channel.
 *   A closing leader releases the lock, and the next waiting tab takes over.
 * - Without Web Locks or BroadcastChannel (old browsers, jsdom), every tab is
 *   its own leader, which is still one stream per tab instead of one per
 *   component.
 *
 * Unnamed (`message`) events are always relayed; a stream that uses named SSE
 * events lists them in `events`. With `resumeParam`, every (re)open after the
 * first carries the last event id seen in this tab as that query parameter, so
 * a reconnect, or a tab taking over as leader, resumes where the stream left
 * off. The browser's own Last-Event-ID header only covers its automatic
 * retries of one EventSource.
 */

export type SharedStreamState = 'connecting' | 'open' | 'closed';

export interface SharedStreamMessage {
  /** SSE event name; `message` for unnamed events. */
  event: string;
  data: string;
  lastEventId: string;
}

export interface SharedStreamOptions {
  /** Named SSE events to relay besides unnamed `message` events. */
  events?: string[];
  /** Query parameter that carries the last seen event id when reopening. */
  resumeParam?: string;
  /**
   * Replay what the tab has already received to a new subscriber (default
   * true). Off for streams whose consumer refetches state on each event: a
   * replayed backlog would fire one refetch per message.
   */
  replay?: boolean;
}

type Relay =
  | { kind: 'message'; message: SharedStreamMessage }
  | { kind: 'state'; state: SharedStreamState }
  | { kind: 'sync-request'; from: string }
  | { kind: 'sync'; to: string; state: SharedStreamState; recent: SharedStreamMessage[] };

interface Subscriber {
  onMessage: (message: SharedStreamMessage) => void;
  onState?: (state: SharedStreamState) => void;
}

const RECENT_LIMIT = 100;

/**
 * Delay before reopen attempt N (from 1): min(2^(N-1) * 1000, maxMs).
 * Exported for the property tests.
 */
export function calculateBackoff(attemptNumber: number, maxMs = 30000): number {
  return Math.min(Math.pow(2, attemptNumber - 1) * 1000, maxMs);
}
// readyState of a stream the browser has given up on. Spelled out because test
// doubles rarely define EventSource.CLOSED.
const EVENT_SOURCE_CLOSED = 2;

function crossTabSupported(): boolean {
  return (
    typeof BroadcastChannel !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!(navigator as Navigator & { locks?: LockManager }).locks
  );
}

class SharedStream {
  private readonly subscribers = new Set<Subscriber>();
  private readonly recent: SharedStreamMessage[] = [];
  private state: SharedStreamState = 'connecting';
  private source: EventSource | null = null;
  private channel: BroadcastChannel | null = null;
  private releaseLock: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private failedOpens = 0;
  private stopped = false;
  private readonly id = Math.random().toString(36).slice(2);
  private lastEventId = '';

  constructor(
    private readonly url: string,
    private readonly options: SharedStreamOptions,
    private readonly onIdle: () => void,
  ) {}

  get size(): number {
    return this.subscribers.size;
  }

  start(): void {
    if (!crossTabSupported()) {
      this.lead();
      return;
    }
    const name = `oddjob-sse:${this.url}`;
    this.channel = new BroadcastChannel(name);
    this.channel.onmessage = (e: MessageEvent<Relay>) => this.onRelay(e.data);
    // Held until stop(): the lock is how other tabs know a leader exists.
    navigator.locks.request(name, () => new Promise<void>((release) => {
      if (this.stopped) { release(); return; }
      this.releaseLock = release;
      this.lead();
    })).catch(() => { /* lock manager unavailable mid-request: stay a follower */ });
    this.channel.postMessage({ kind: 'sync-request', from: this.id } satisfies Relay);
  }

  add(subscriber: Subscriber): void {
    this.subscribers.add(subscriber);
    subscriber.onState?.(this.state);
    if (this.options.replay === false) return;
    for (const message of this.recent) {
      try {
        subscriber.onMessage(message);
      } catch (err) {
        console.error('[shared-event-source] subscriber failed on replay:', err);
      }
    }
  }

  remove(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
    if (this.subscribers.size > 0) return;
    // Defer: a route change unmounts one subscriber and mounts the next in the
    // same commit, and closing in between would drop and reopen the stream.
    queueMicrotask(() => {
      if (this.subscribers.size === 0) this.onIdle();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.source?.close();
    this.source = null;
    this.channel?.close();
    this.channel = null;
    this.releaseLock?.();
    this.releaseLock = null;
  }

  private lead(): void {
    if (this.stopped) return;
    this.open();
  }

  private open(): void {
    if (this.stopped) return;
    const es = new EventSource(this.openUrl(), { withCredentials: true });
    this.source = es;
    es.onopen = () => {
      this.failedOpens = 0;
      this.setState('open', true);
    };
    const relay = (event: string) => (e: MessageEvent) => {
      const message = { event, data: String(e.data), lastEventId: e.lastEventId ?? '' };
      this.deliver(message);
      this.channel?.postMessage({ kind: 'message', message } satisfies Relay);
    };
    es.onmessage = relay('message');
    for (const name of this.options.events ?? []) es.addEventListener(name, relay(name) as EventListener);
    es.onerror = () => {
      if (this.stopped) return;
      // The browser retries a dropped stream on its own; it gives up (CLOSED)
      // on an HTTP error, and then reconnecting is ours to do.
      if (es.readyState !== EVENT_SOURCE_CLOSED) {
        this.setState('connecting', true);
        return;
      }
      es.close();
      if (this.source === es) this.source = null;
      this.setState('closed', true);
      this.failedOpens += 1;
      this.reconnectTimer = setTimeout(() => this.open(), calculateBackoff(this.failedOpens));
    };
  }

  private openUrl(): string {
    const { resumeParam } = this.options;
    if (!resumeParam || !this.lastEventId) return this.url;
    const separator = this.url.includes('?') ? '&' : '?';
    return `${this.url}${separator}${resumeParam}=${encodeURIComponent(this.lastEventId)}`;
  }

  private onRelay(relay: Relay): void {
    if (this.stopped) return;
    switch (relay.kind) {
      case 'message':
        this.deliver(relay.message);
        break;
      case 'state':
        this.setState(relay.state, false);
        break;
      case 'sync-request':
        if (this.releaseLock) {
          this.channel?.postMessage({ kind: 'sync', to: relay.from, state: this.state, recent: this.recent } satisfies Relay);
        }
        break;
      case 'sync':
        // A tab that joins late catches up on what the leader already has.
        if (relay.to === this.id && !this.releaseLock) {
          this.setState(relay.state, false);
          if (this.options.replay !== false) {
            for (const message of relay.recent) this.deliver(message);
          }
        }
        break;
    }
  }

  private deliver(message: SharedStreamMessage): void {
    if (message.lastEventId) this.lastEventId = message.lastEventId;
    this.recent.push(message);
    if (this.recent.length > RECENT_LIMIT) this.recent.shift();
    for (const s of this.subscribers) {
      // One throwing consumer must not starve the rest of the page.
      try {
        s.onMessage(message);
      } catch (err) {
        console.error('[shared-event-source] subscriber failed:', err);
      }
    }
  }

  private setState(state: SharedStreamState, broadcast: boolean): void {
    if (state === this.state) return;
    this.state = state;
    for (const s of this.subscribers) s.onState?.(state);
    if (broadcast) this.channel?.postMessage({ kind: 'state', state } satisfies Relay);
  }
}

const streams = new Map<string, SharedStream>();

/**
 * Subscribe to the shared stream for `url`. New subscribers are replayed the
 * last hundred messages this tab has seen, so consumers must tolerate (dedupe)
 * repeats. Returns an unsubscribe function.
 */
export function subscribeSharedStream(
  url: string,
  onMessage: (message: SharedStreamMessage) => void,
  onState?: (state: SharedStreamState) => void,
  options: SharedStreamOptions = {},
): () => void {
  let stream = streams.get(url);
  if (!stream) {
    // Options belong to the URL: the first subscriber in a tab sets them, and
    // every tab runs the same code, so a URL means the same stream everywhere.
    const created = new SharedStream(url, options, () => {
      if (streams.get(url) === created && created.size === 0) {
        streams.delete(url);
        created.stop();
      }
    });
    streams.set(url, created);
    created.start();
    stream = created;
  }
  const subscriber: Subscriber = { onMessage, onState };
  stream.add(subscriber);
  const owner = stream;
  return () => owner.remove(subscriber);
}

/** Test hook: drop every stream so each test starts from nothing. */
export function __resetSharedStreams(): void {
  for (const stream of streams.values()) stream.stop();
  streams.clear();
}
