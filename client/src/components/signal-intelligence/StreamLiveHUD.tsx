import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { subscribeEvents } from '@domain-ui/core/ui/services/event-bus';
import {
  Activity,
  Filter,
  ChevronDown,
  Radio,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'Low' | 'Medium' | 'High' | 'Critical';

type TargetSector =
  | 'Semiconductor'
  | 'Energy'
  | 'Finance'
  | 'Healthcare'
  | 'Agriculture'
  | 'Defense'
  | 'Technology'
  | 'Manufacturing';

interface EventPrimitiveEntry {
  id: string;
  organizationId: number;
  sourceEntryId: string;
  eventType: string;
  targetSector: string;
  jurisdiction: string;
  severity: string;
  sourceUrl: string;
  extractionTimestamp: string;
  confidenceScore: number;
  rawText: string | null;
  flags: string[];
  contentHash: string;
  createdAt: string;
  /** Blast radius — may be computed client-side or returned from API join */
  blastRadius?: number;
}

interface StreamLiveHUDProps {
  organizationId: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<Severity, { border: string; bg: string; text: string }> = {
  Critical: { border: 'border-red-500', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-300' },
  High: { border: 'border-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-300' },
  Medium: { border: 'border-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-950/30', text: 'text-yellow-700 dark:text-yellow-300' },
  Low: { border: 'border-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-300' },
};

const SEVERITY_BADGE_VARIANT: Record<Severity, 'critical' | 'warning' | 'info' | 'default'> = {
  Critical: 'critical',
  High: 'warning',
  Medium: 'warning',
  Low: 'info',
};

const TIME_RANGE_OPTIONS = [
  { label: '1h', value: 1 },
  { label: '6h', value: 6 },
  { label: '24h', value: 24 },
  { label: '7d', value: 168 },
] as const;

const TARGET_SECTORS: TargetSector[] = [
  'Semiconductor',
  'Energy',
  'Finance',
  'Healthcare',
  'Agriculture',
  'Defense',
  'Technology',
  'Manufacturing',
];

const SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function getTimeRangeISO(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isSeverity(val: string): val is Severity {
  return SEVERITIES.includes(val as Severity);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StreamLiveHUD({ organizationId }: StreamLiveHUDProps) {
  const queryClient = useQueryClient();

  // --- Filter state ---
  const [selectedSeverities, setSelectedSeverities] = useState<Set<Severity>>(new Set());
  const [selectedSector, setSelectedSector] = useState<string>('');
  const [jurisdictionFilter, setJurisdictionFilter] = useState<string>('');
  const [timeRangeHours, setTimeRangeHours] = useState<number>(24);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // --- Auto-scroll state ---
  const feedRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const userScrolledRef = useRef(false);

  // --- Build query params ---
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '200');
    params.set('startTime', getTimeRangeISO(timeRangeHours));
    if (selectedSeverities.size === 1) {
      params.set('severity', [...selectedSeverities][0]);
    }
    if (selectedSector) {
      params.set('sector', selectedSector);
    }
    if (jurisdictionFilter.trim()) {
      params.set('jurisdiction', jurisdictionFilter.trim());
    }
    return params.toString();
  }, [selectedSeverities, selectedSector, jurisdictionFilter, timeRangeHours]);

  // --- Fetch initial data ---
  const { data: events = [], isLoading } = useQuery<EventPrimitiveEntry[]>({
    queryKey: ['/api/event-primitives', organizationId, queryParams],
    queryFn: () => fetchJson(`/api/event-primitives?${queryParams}`),
    refetchInterval: 10000, // poll fallback every 10s
  });

  // --- Client-side severity multi-filter (API only supports single severity) ---
  const filteredEvents = useMemo(() => {
    if (selectedSeverities.size <= 1) return events;
    return events.filter((e) => selectedSeverities.has(e.severity as Severity));
  }, [events, selectedSeverities]);

  // --- Live updates: refetch on any signal event (shared event bus) ---
  useEffect(
    () =>
      subscribeEvents({ type: 'signal.**' }, () => {
        queryClient.invalidateQueries({ queryKey: ['/api/event-primitives'] });
      }),
    [queryClient],
  );

  // --- Auto-scroll logic ---
  const handleScroll = useCallback(() => {
    if (!feedRef.current) return;
    const { scrollTop } = feedRef.current;
    // If user scrolled up from top, disable auto-scroll
    if (scrollTop > 10) {
      userScrolledRef.current = true;
      setAutoScroll(false);
    } else {
      userScrolledRef.current = false;
      setAutoScroll(true);
    }
  }, []);

  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [filteredEvents, autoScroll]);

  // --- Filter handlers ---
  const toggleSeverity = (severity: Severity) => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) {
        next.delete(severity);
      } else {
        next.add(severity);
      }
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex h-full flex-col rounded-lg border bg-card"
      data-testid="stream-live-hud"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-green-500 animate-pulse" />
          <h3 className="text-sm font-semibold">Stream Live HUD</h3>
          <span className="text-xs text-muted-foreground">
            {filteredEvents.length} events
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!autoScroll && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => {
                setAutoScroll(true);
                if (feedRef.current) feedRef.current.scrollTop = 0;
              }}
            >
              Resume auto-scroll
            </button>
          )}
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs',
              'border hover:bg-accent transition-colors',
              filtersOpen && 'bg-accent'
            )}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-label="Toggle filters"
          >
            <Filter className="h-3 w-3" />
            Filters
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform',
                filtersOpen && 'rotate-180'
              )}
            />
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {filtersOpen && (
        <div className="border-b px-4 py-3 space-y-3 bg-muted/30" data-testid="hud-filters">
          {/* Severity multi-select */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Severity
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SEVERITIES.map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => toggleSeverity(sev)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors',
                    selectedSeverities.has(sev)
                      ? `${SEVERITY_COLORS[sev].bg} ${SEVERITY_COLORS[sev].border} ${SEVERITY_COLORS[sev].text}`
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          {/* Target Sector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Target Sector
            </label>
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1 text-xs"
            >
              <option value="">All Sectors</option>
              {TARGET_SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Jurisdiction */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Jurisdiction
            </label>
            <input
              type="text"
              placeholder="e.g., US, EU, CN..."
              value={jurisdictionFilter}
              onChange={(e) => setJurisdictionFilter(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground"
            />
          </div>

          {/* Time Range */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Time Range
            </label>
            <div className="flex gap-1.5">
              {TIME_RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTimeRangeHours(opt.value)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium border transition-colors',
                    timeRangeHours === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Event Feed */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
        data-testid="hud-event-feed"
      >
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Activity className="h-4 w-4 mr-2 animate-spin" />
            Loading events...
          </div>
        )}

        {!isLoading && filteredEvents.length === 0 && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            No events match current filters.
          </div>
        )}

        {!isLoading && filteredEvents.length > 0 && (
          <div className="divide-y">
            {filteredEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Card sub-component
// ---------------------------------------------------------------------------

function EventCard({ event }: { event: EventPrimitiveEntry }) {
  const severity = isSeverity(event.severity) ? event.severity : 'Low';
  const colors = SEVERITY_COLORS[severity];

  return (
    <div
      className={cn(
        'px-4 py-3 border-l-4 transition-colors hover:bg-muted/50',
        colors.border,
        colors.bg
      )}
      data-testid="hud-event-card"
      data-severity={event.severity}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Top row: event type + severity badge */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium truncate">
              {event.eventType.replace(/_/g, ' ')}
            </span>
            <Badge variant={SEVERITY_BADGE_VARIANT[severity]} className="text-[10px] px-1.5 py-0">
              {severity}
            </Badge>
          </div>

          {/* Details row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span title="Jurisdiction" className="font-mono">
              🌐 {event.jurisdiction}
            </span>
            <span title="Confidence Score">
              🎯 {formatConfidence(event.confidenceScore)}
            </span>
            {event.blastRadius !== undefined && event.blastRadius > 0 && (
              <span title="Blast Radius">
                💥 {event.blastRadius} affected
              </span>
            )}
            <span title="Target Sector" className="italic">
              {event.targetSector}
            </span>
          </div>
        </div>

        {/* Timestamp */}
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {formatRelativeTime(event.extractionTimestamp || event.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relative time formatter
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default StreamLiveHUD;
