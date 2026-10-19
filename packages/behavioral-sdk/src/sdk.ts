/**
 * Behavioral SDK — Core Implementation
 */
import type { SDKConfig, SDKEvent, SDKScore, AutoTrackOptions, EnvironmentalData, ThresholdEvent } from './types';

const DEFAULT_ENDPOINT = '/api/v1/behavioral';
const DEFAULT_FLUSH_INTERVAL = 1000;
const DEFAULT_MAX_BATCH = 10;
const STORAGE_KEY = 'oddjob_bi_queue';
const SESSION_KEY = 'oddjob_bi_session';

export class BehavioralSDK {
  private config: Required<SDKConfig>;
  private queue: SDKEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private entityId: string;
  private sessionId: string;
  private isOnline = true;
  private thresholdCallbacks: Map<string, (event: ThresholdEvent) => void> = new Map();

  private constructor(config: SDKConfig) {
    this.config = {
      apiKey: config.apiKey,
      endpoint: config.endpoint || DEFAULT_ENDPOINT,
      entityType: config.entityType || 'contact',
      flushIntervalMs: config.flushIntervalMs || DEFAULT_FLUSH_INTERVAL,
      maxBatchSize: config.maxBatchSize || DEFAULT_MAX_BATCH,
      consent: config.consent !== false,
      debug: config.debug || false,
      captureEnvironmental: config.captureEnvironmental || false,
    };

    // Generate or restore session
    this.sessionId = this.getOrCreateSession();
    this.entityId = `anon_${this.sessionId.slice(0, 12)}`;

    // Restore offline queue
    this.restoreQueue();

    // Start flush timer
    if (this.config.consent) {
      this.startFlushing();
    }

    // Online/offline detection
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { this.isOnline = true; this.flush(); });
      window.addEventListener('offline', () => { this.isOnline = false; });
      window.addEventListener('beforeunload', () => this.flush());
    }

    this.log('Initialized', { entityId: this.entityId, consent: this.config.consent });
  }

  /**
   * Initialize the SDK. Call once on page load.
   */
  static init(config: SDKConfig): BehavioralSDK {
    return new BehavioralSDK(config);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Emit a custom behavioral signal.
   */
  signal(eventType: string, payload: Record<string, any> = {}): void {
    if (!this.config.consent) return;
    this.enqueue({
      event_type: eventType,
      entity_type: this.config.entityType,
      entity_id: this.entityId,
      timestamp: new Date().toISOString(),
      source: 'sdk',
      signal_category: 'behavioral',
      payload: { ...payload, page: this.getPage(), session_id: this.sessionId },
      environmental: this.config.captureEnvironmental ? this.captureEnvironmental() : undefined,
    });
  }

  /**
   * Associate the anonymous session with a known identity.
   */
  identify(knownId: string, attributes?: Record<string, any>): void {
    if (!this.config.consent) return;
    const previousId = this.entityId;
    this.entityId = knownId;

    // Send identify event
    this.enqueue({
      event_type: 'identify',
      entity_type: this.config.entityType,
      entity_id: knownId,
      timestamp: new Date().toISOString(),
      source: 'sdk',
      signal_category: 'qualification',
      payload: { anonymous_id: previousId, attributes, session_id: this.sessionId },
    });

    // Immediately flush to merge scores server-side
    this.flush();
    this.log('Identified', { from: previousId, to: knownId });
  }

  /**
   * Set entity attributes (qualification signals).
   */
  setAttributes(attributes: Record<string, any>): void {
    if (!this.config.consent) return;
    this.enqueue({
      event_type: 'attributes_updated',
      entity_type: this.config.entityType,
      entity_id: this.entityId,
      timestamp: new Date().toISOString(),
      source: 'sdk',
      signal_category: 'qualification',
      payload: { attributes, session_id: this.sessionId },
    });
  }

  /**
   * Get the current score for this entity.
   */
  async getScore(): Promise<SDKScore | null> {
    try {
      const res = await fetch(`${this.config.endpoint}/scores/${this.config.entityType}/${this.entityId}`, {
        headers: { 'x-api-key': this.config.apiKey },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  /**
   * Subscribe to threshold crossings for this entity.
   */
  onThreshold(thresholdName: string, callback: (event: ThresholdEvent) => void): () => void {
    this.thresholdCallbacks.set(thresholdName, callback);
    return () => this.thresholdCallbacks.delete(thresholdName);
  }

  /**
   * Enable auto-tracking of page views, clicks, scroll, and time-on-page.
   */
  autoTrack(options: AutoTrackOptions = {}): () => void {
    const cleanups: Array<() => void> = [];

    if (options.pageViews !== false) {
      this.signal('page_view', { page: this.getPage(), title: document.title });
      // Track SPA navigation
      const observer = new MutationObserver(() => {
        const currentPage = this.getPage();
        this.signal('page_view', { page: currentPage, title: document.title });
      });
      // Simplified: listen for popstate
      const handler = () => this.signal('page_view', { page: this.getPage(), title: document.title });
      window.addEventListener('popstate', handler);
      cleanups.push(() => { observer.disconnect(); window.removeEventListener('popstate', handler); });
    }

    if (options.clicks) {
      const selector = options.clickSelector || 'a, button, [data-track]';
      const handler = (e: Event) => {
        const target = (e.target as HTMLElement)?.closest(selector);
        if (target) {
          this.signal('click', {
            element: target.tagName.toLowerCase(),
            text: (target.textContent || '').slice(0, 50).trim(),
            id: target.id || undefined,
            href: (target as HTMLAnchorElement).href || undefined,
          });
        }
      };
      document.addEventListener('click', handler, true);
      cleanups.push(() => document.removeEventListener('click', handler, true));
    }

    if (options.scrollDepth) {
      let maxScroll = 0;
      const handler = () => {
        const scrollPercent = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
        if (scrollPercent > maxScroll + 25) { // Report at 25% increments
          maxScroll = scrollPercent;
          this.signal('scroll_depth', { percent: maxScroll, page: this.getPage() });
        }
      };
      window.addEventListener('scroll', handler, { passive: true });
      cleanups.push(() => window.removeEventListener('scroll', handler));
    }

    if (options.timeOnPage) {
      const startTime = Date.now();
      const handler = () => {
        const seconds = Math.round((Date.now() - startTime) / 1000);
        if (seconds > 5) { // Only report if > 5 seconds
          this.signal('time_on_page', { seconds, page: this.getPage() });
        }
      };
      window.addEventListener('beforeunload', handler);
      cleanups.push(() => window.removeEventListener('beforeunload', handler));
    }

    return () => cleanups.forEach(fn => fn());
  }

  /**
   * Update consent status. If revoked, stops all tracking and clears queue.
   */
  setConsent(granted: boolean): void {
    this.config.consent = granted;
    if (!granted) {
      this.queue = [];
      this.persistQueue();
      this.stopFlushing();
      this.log('Consent revoked — tracking stopped');
    } else {
      this.startFlushing();
      this.log('Consent granted — tracking resumed');
    }
  }

  /**
   * Force flush all queued events immediately.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0 || !this.isOnline || !this.config.consent) return;

    const batch = this.queue.splice(0, this.config.maxBatchSize);
    this.persistQueue();

    try {
      const res = await fetch(`${this.config.endpoint}/events/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.apiKey },
        body: JSON.stringify({ events: batch }),
        keepalive: true, // Survives page unload
      });

      if (!res.ok) {
        // Put events back in queue for retry
        this.queue.unshift(...batch);
        this.persistQueue();
        this.log('Flush failed, events re-queued', { status: res.status });
      } else {
        this.log('Flushed', { count: batch.length });
      }
    } catch {
      // Network error — re-queue
      this.queue.unshift(...batch);
      this.persistQueue();
    }
  }

  /**
   * Destroy the SDK instance. Flushes remaining events and cleans up.
   */
  destroy(): void {
    this.flush();
    this.stopFlushing();
    this.thresholdCallbacks.clear();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private enqueue(event: SDKEvent): void {
    this.queue.push(event);
    this.persistQueue();
    if (this.queue.length >= this.config.maxBatchSize) {
      this.flush();
    }
  }

  private startFlushing(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
  }

  private stopFlushing(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
  }

  private persistQueue(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue)); } catch { /* quota exceeded */ }
  }

  private restoreQueue(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) { this.queue = JSON.parse(stored); }
    } catch { /* corrupted */ }
  }

  private getOrCreateSession(): string {
    try {
      let session = sessionStorage.getItem(SESSION_KEY);
      if (!session) {
        session = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(SESSION_KEY, session);
      }
      return session;
    } catch {
      return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  private getPage(): string {
    return typeof window !== 'undefined' ? window.location.pathname : '/';
  }

  private captureEnvironmental(): EnvironmentalData | undefined {
    if (typeof navigator === 'undefined') return undefined;
    const data: EnvironmentalData = {};

    // Timezone
    try { data.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* */ }

    // Network info (if available)
    const nav = navigator as any;
    if (nav.connection) {
      data.connection_type = nav.connection.effectiveType;
      data.downlink_mbps = nav.connection.downlink;
      data.rtt_ms = nav.connection.rtt;
    }

    return Object.keys(data).length > 0 ? data : undefined;
  }

  private log(msg: string, data?: any): void {
    if (this.config.debug) {
      console.log(`[BehavioralSDK] ${msg}`, data || '');
    }
  }
}
