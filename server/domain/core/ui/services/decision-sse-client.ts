/**
 * DecisionSSEClient
 *
 * Real-time approval decision events from `/api/decisions/stream`, read through
 * the shared stream: one connection per browser per org, however many tabs are
 * open (see shared-event-source.ts). It used to open its own EventSource in
 * every tab, which with the six-connection HTTP/1.1 pool was enough to stall
 * every tab, and past five tabs the server refused with 429.
 *
 * Reconnection (with backoff, resuming from the last event id) belongs to the
 * shared stream. This client turns its state into the decision UI's states and
 * falls back to REST polling while the stream stays down:
 *
 *   'reconnecting' → (stream opens) → 'connected'
 *   'connected' → (stream drops) → 'reconnecting'
 *   'reconnecting' → (still down after fallbackAfterMs) → 'polling'
 *   'polling' → (stream opens) → 'connected'
 */
import { subscribeOrgScopedStream } from './event-bus';
import type { SharedStreamMessage, SharedStreamState } from './shared-event-source';

export type ConnectionState = 'connected' | 'reconnecting' | 'polling';

export interface DecisionNewEvent {
  type: 'decision:new';
  requestId: number;
  toolName: string;
  riskLevel: 'low' | 'medium' | 'high';
  description: string;
  missionId: number | null;
  createdAt: string;
}

export interface DecisionResolvedEvent {
  type: 'decision:resolved';
  requestId: number;
  newStatus: 'approved' | 'rejected' | 'snoozed';
  resolvedAt: string;
}

export type DecisionEvent = DecisionNewEvent | DecisionResolvedEvent;

export interface DecisionSSEClientOptions {
  endpoint?: string;
  onEvent: (event: DecisionEvent) => void;
  onConnectionChange: (state: ConnectionState) => void;
  /** How long the stream may stay down before polling starts. */
  fallbackAfterMs?: number;
  fallbackPollIntervalMs?: number;
}

const DECISION_EVENTS = ['decision:new', 'decision:resolved'] as const;

export class DecisionSSEClient {
  private readonly endpoint: string;
  private readonly onEvent: (event: DecisionEvent) => void;
  private readonly onConnectionChange: (state: ConnectionState) => void;
  private readonly fallbackAfterMs: number;
  private readonly fallbackPollIntervalMs: number;

  private connectionState: ConnectionState = 'reconnecting';
  private unsubscribe: (() => void) | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(options: DecisionSSEClientOptions) {
    this.endpoint = options.endpoint ?? '/api/decisions/stream';
    this.onEvent = options.onEvent;
    this.onConnectionChange = options.onConnectionChange;
    this.fallbackAfterMs = options.fallbackAfterMs ?? 10000;
    this.fallbackPollIntervalMs = options.fallbackPollIntervalMs ?? 10000;
  }

  /** Start receiving decision events. */
  connect(): void {
    if (this.unsubscribe) return;
    this.disposed = false;
    this.armFallback();
    this.unsubscribe = subscribeOrgScopedStream(
      this.endpoint,
      (message) => this.handleMessage(message),
      (state) => this.handleStreamState(state),
      { events: [...DECISION_EVENTS], resumeParam: 'lastEventId' },
    );
  }

  /** Stop receiving events and tear down all timers. */
  disconnect(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearFallback();
    this.stopPolling();
  }

  /** Returns the current connection state. */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private handleMessage(message: SharedStreamMessage): void {
    if (this.disposed) return;
    if (message.event !== 'decision:new' && message.event !== 'decision:resolved') return;
    try {
      const data = JSON.parse(message.data);
      this.onEvent({ type: message.event, ...data } as DecisionEvent);
    } catch (err) {
      console.error(`[DecisionSSEClient] Failed to parse ${message.event} event:`, err);
    }
  }

  private handleStreamState(state: SharedStreamState): void {
    if (this.disposed) return;
    if (state === 'open') {
      this.clearFallback();
      this.stopPolling();
      this.setConnectionState('connected');
      return;
    }
    if (this.connectionState === 'connected') this.setConnectionState('reconnecting');
    this.armFallback();
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.onConnectionChange(state);
    }
  }

  private armFallback(): void {
    if (this.fallbackTimer || this.connectionState === 'polling') return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      if (this.disposed) return;
      this.setConnectionState('polling');
      this.startPolling();
    }, this.fallbackAfterMs);
  }

  private clearFallback(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  // ─── Polling Fallback ─────────────────────────────────────────────────

  private startPolling(): void {
    this.stopPolling();
    // Poll immediately, then on interval
    this.pollPendingCount();
    this.pollTimer = setInterval(() => {
      this.pollPendingCount();
    }, this.fallbackPollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollPendingCount(): Promise<void> {
    if (this.disposed) return;
    try {
      const response = await fetch('/api/approvals/pending/count', {
        credentials: 'include',
      });
      if (!response.ok) return;
      const data = await response.json();
      // Emit a synthetic event so consumers can update their state
      // The store listens to onEvent and can handle count-based updates
      this.onEvent({
        type: 'decision:new',
        requestId: -1, // sentinel indicating poll-based count update
        toolName: '__poll__',
        riskLevel: 'low',
        description: '',
        missionId: null,
        createdAt: new Date().toISOString(),
        ...data,
      } as unknown as DecisionNewEvent);
    } catch {
      // Silently ignore poll failures — we'll try again next interval
    }
  }
}
