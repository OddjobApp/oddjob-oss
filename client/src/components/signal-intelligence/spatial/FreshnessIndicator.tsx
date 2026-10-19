import { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, PlugZap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatFreshness } from './utils';

/**
 * FreshnessIndicator — Displays data freshness and SSE connection health.
 *
 * Shows elapsed time since last successful fetch (updated every 10s) and
 * a colored badge indicating SSE connection status:
 *   - Green "Live" — last event/heartbeat within 10s
 *   - Yellow "Reconnecting" — no event for >10s
 *   - Red "Disconnected" — unavailable >30s, with manual Reconnect button
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

export interface FreshnessIndicatorProps {
  lastFetchTime: number; // timestamp ms
  sseStatus: 'live' | 'reconnecting' | 'disconnected';
  lastEventTime: number; // timestamp of last SSE event/heartbeat
  onReconnect: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

// ─── Status Badge Config ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  FreshnessIndicatorProps['sseStatus'],
  { label: string; dotClass: string; badgeClass: string; icon: typeof Wifi }
> = {
  live: {
    label: 'Live',
    dotClass: 'bg-green-500',
    badgeClass: 'bg-green-500/10 text-green-600',
    icon: Wifi,
  },
  reconnecting: {
    label: 'Reconnecting',
    dotClass: 'bg-yellow-500',
    badgeClass: 'bg-yellow-500/10 text-yellow-600',
    icon: Wifi,
  },
  disconnected: {
    label: 'Disconnected',
    dotClass: 'bg-red-500',
    badgeClass: 'bg-red-500/10 text-red-600',
    icon: WifiOff,
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function FreshnessIndicator({
  lastFetchTime,
  sseStatus,
  lastEventTime,
  onReconnect,
  onRefresh,
  isRefreshing,
}: FreshnessIndicatorProps) {
  const [elapsed, setElapsed] = useState(() => Date.now() - lastFetchTime);

  // Update elapsed time every 10 seconds (Req 7.2)
  useEffect(() => {
    // Immediately compute current elapsed
    setElapsed(Date.now() - lastFetchTime);

    const interval = setInterval(() => {
      setElapsed(Date.now() - lastFetchTime);
    }, 10_000);

    return () => clearInterval(interval);
  }, [lastFetchTime]);

  const handleReconnect = useCallback(() => {
    onReconnect();
  }, [onReconnect]);

  const handleRefresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  const config = STATUS_CONFIG[sseStatus];
  const StatusIcon = config.icon;

  return (
    <div
      className="flex items-center gap-2"
      role="status"
      aria-live="polite"
      aria-label={`Data freshness: ${formatFreshness(elapsed)}. Connection: ${config.label}`}
      data-testid="freshness-indicator"
    >
      {/* Freshness text */}
      <span
        className="text-xs text-muted-foreground"
        data-testid="freshness-elapsed"
      >
        {formatFreshness(elapsed)}
      </span>

      {/* SSE status badge */}
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold',
          config.badgeClass,
        )}
        data-testid="freshness-badge"
        data-status={sseStatus}
      >
        <span
          className={cn('h-1.5 w-1.5 rounded-full', config.dotClass)}
          aria-hidden="true"
        />
        <StatusIcon className="h-3 w-3" aria-hidden="true" />
        {config.label}
      </span>

      {/* Reconnect button — only shown when disconnected (Req 7.5) */}
      {sseStatus === 'disconnected' && (
        <button
          type="button"
          onClick={handleReconnect}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-[10px] font-medium text-red-600 transition-colors',
            'hover:bg-red-50 dark:hover:bg-red-500/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
          aria-label="Reconnect to event stream"
          data-testid="freshness-reconnect-btn"
        >
          <PlugZap className="h-3 w-3" aria-hidden="true" />
          Reconnect
        </button>
      )}

      {/* Refresh button */}
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors',
          'hover:bg-accent hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
        aria-label="Refresh data"
        data-testid="freshness-refresh-btn"
      >
        <RefreshCw
          className={cn('h-3 w-3', isRefreshing && 'animate-spin')}
          aria-hidden="true"
        />
        Refresh
      </button>
    </div>
  );
}
