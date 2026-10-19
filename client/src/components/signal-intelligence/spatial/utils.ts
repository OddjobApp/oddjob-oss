/**
 * Shared utility functions and types for the Spatial UX.
 * Requirements: 2.3, 4.2, 5.2, 7.1, 7.3, 7.4, 7.5
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SortOption = 'severity' | 'confidence' | 'recency' | 'blast-radius';
export type BulkAction = 'dismiss' | 'escalate' | 'snooze';
export type SnoozeDuration = '15m' | '1h' | '4h' | '24h';
export type TimeRange = '1h' | '4h' | '12h' | '24h' | '7d' | 'all';
export type SignalKind = 'opportunity' | 'threat';
export type ActionType = 'cycle_launched' | 'escalated' | 'dismissed' | 'snoozed';
export type ActionOutcome = 'succeeded' | 'failed' | 'pending';
export type ViewId = 'signals' | 'sources' | 'backbone' | 'subscriptions' | 'wizard' | 'catalog';

export interface FilterState {
  kind: 'all' | SignalKind;
  query: string;
  severities: Set<string>;
  minConfidence: number;
  timeRange: TimeRange;
}

export interface DashboardState {
  activeView: ViewId;
  selectedSignalId: string | null;
  multiSelect: Set<string>;
  sortBy: SortOption;
  filter: FilterState;
  slideOver: SlideOverContent | null;
}

export interface SlideOverContent {
  type: string;
  entityType?: string;
  entityId?: string;
}

export interface SignalClientState {
  id: string;
  dismissed: boolean;
  escalated: boolean;
  snoozedUntil: string | null;
  cycleActive: boolean;
}

export interface SignalEvent {
  id: string;
  eventType: string;
  targetSector: string;
  jurisdiction: string;
  severity: string;
  confidenceScore: number;
  rawText: string | null;
  extractionTimestamp: string;
  /** Res-7 cell for the observed position; null when the event has no fix. */
  h3Index?: string | null;
  /** Tracked entity (vessel, asset, sensor) this observation belongs to. */
  subjectId?: string | null;
}

export interface IntelligenceSignal {
  id: string;
  title: string;
  subtitle: string;
  kind: SignalKind;
  /** Absent when nothing has scored this signal. Never substitute a constant. */
  score?: number;
  age: string;
  impact: string;
  confidence?: string;
  event: SignalEvent;
}

export interface SignalAction {
  id: string;
  type: ActionType;
  timestamp: string;
  outcome: ActionOutcome;
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Map severity to a hex color.
 * Requirement 2.3: Distinct color per severity level.
 */
/**
 * A raw signal event, as the API returns it, presented as a signal.
 *
 * The one place this conversion happens. Two surfaces render the same signal -
 * the dashboard and the Signal Studio pod - and the pod passed the RAW event
 * where an IntelligenceSignal was expected, so `signal.event.eventType` read
 * `undefined.eventType` and took the whole Subscriptions view down. The event
 * query is typed `any[]`, so nothing caught it at build time.
 */
export function toIntelligenceSignal(event: SignalEvent, now: number = Date.now()): IntelligenceSignal {
  const threat = event.severity === 'Critical' || event.severity === 'High';
  const timestamp = new Date(event.extractionTimestamp);
  const elapsedMinutes = Math.max(0, Math.round((now - timestamp.getTime()) / 60000));
  return {
    id: event.id,
    title: event.rawText?.trim().split(/[.!?]/)[0]?.slice(0, 110) || event.eventType.replaceAll('_', ' '),
    subtitle: `${event.targetSector} · ${event.jurisdiction}`,
    kind: threat ? 'threat' : 'opportunity',
    score: Math.round(event.confidenceScore * 100),
    age: elapsedMinutes < 60 ? `${elapsedMinutes}m ago` : `${Math.round(elapsedMinutes / 60)}h ago`,
    impact: `${event.severity} impact · ${event.targetSector}`,
    confidence: event.confidenceScore >= .8 ? 'High' : event.confidenceScore >= .5 ? 'Medium' : 'Low',
    event,
  };
}

export function severityToColor(severity: string): string {
  switch (severity) {
    case 'Critical':
      return '#ef4444';
    case 'High':
      return '#f97316';
    case 'Medium':
      return '#eab308';
    case 'Low':
      return '#3b82f6';
    default:
      return '#6b7280';
  }
}

/** Numeric rank for severity sorting (higher = more severe). */
const SEVERITY_RANK: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/**
 * Sort signals by the given criterion (all descending).
 * Requirement 4.2: Sort by severity, confidence, recency, blast-radius.
 */
export function sortSignals(
  signals: IntelligenceSignal[],
  criterion: SortOption,
): IntelligenceSignal[] {
  const sorted = [...signals];

  switch (criterion) {
    case 'severity':
      sorted.sort(
        (a, b) =>
          (SEVERITY_RANK[b.event.severity] ?? 0) -
          (SEVERITY_RANK[a.event.severity] ?? 0),
      );
      break;

    case 'confidence':
      sorted.sort((a, b) => b.event.confidenceScore - a.event.confidenceScore);
      break;

    case 'recency':
      sorted.sort(
        (a, b) =>
          new Date(b.event.extractionTimestamp).getTime() -
          new Date(a.event.extractionTimestamp).getTime(),
      );
      break;

    case 'blast-radius':
      // blast-radius is derived from the score field (0–100)
      sorted.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      break;
  }

  return sorted;
}

/**
 * Sort actions in reverse chronological order, capped at 50 entries.
 * Requirement 5.2: Reverse chronological, display 50 most recent.
 */
export function sortActions(actions: SignalAction[]): SignalAction[] {
  return [...actions]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, 50);
}

/**
 * Format elapsed milliseconds into a human-readable freshness string.
 * Requirement 7.1:
 *   - < 60 000 ms → "Updated Xs ago" (X = floor(elapsed / 1000))
 *   - ≥ 60 000 ms → "Updated Xm ago" (X = floor(elapsed / 60000))
 */
export function formatFreshness(elapsed: number): string {
  if (elapsed < 60_000) {
    return `Updated ${Math.floor(elapsed / 1000)}s ago`;
  }
  return `Updated ${Math.floor(elapsed / 60_000)}m ago`;
}

/**
 * Derive the SSE connection status from the time gap since last event/heartbeat.
 * Requirements 7.3, 7.4, 7.5:
 *   - gap ≤ 10 000 ms → 'live'
 *   - 10 000 < gap ≤ 30 000 ms → 'reconnecting'
 *   - gap > 30 000 ms → 'disconnected'
 */
export function deriveSseStatus(
  gap: number,
): 'live' | 'reconnecting' | 'disconnected' {
  if (gap <= 10_000) return 'live';
  if (gap <= 30_000) return 'reconnecting';
  return 'disconnected';
}
