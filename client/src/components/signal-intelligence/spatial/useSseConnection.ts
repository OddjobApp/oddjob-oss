import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deriveSseStatus } from './utils';

/**
 * useSseConnection — Manages SSE connection lifecycle and data freshness for the Spatial dashboard.
 *
 * Responsibilities:
 * - Opens/maintains an EventSource to `/api/events/stream?type=signal.*`
 * - Tracks lastEventTime (timestamp of last received event or heartbeat)
 * - Computes sseStatus from the gap using `deriveSseStatus(gap)`
 * - Provides `onReconnect`: closes EventSource, opens new connection, disables button for up to 10s
 * - Provides `onRefresh`: calls `queryClient.refetchQueries()` for all displayed data, disables button until complete
 * - Resets lastFetchTime on successful reconnect or refresh
 * - Tracks failed queries on refresh failure
 *
 * Requirements: 7.6, 7.7, 7.8, 7.9, 7.10
 */

/** Query keys used by the spatial dashboard that should be refetched on manual refresh. */
const SPATIAL_QUERY_KEYS = [
  '/api/event-primitives?limit=100',
  '/api/signal-feeds',
  '/api/cycles?limit=100',
  '/api/cycle-signal-subscriptions',
  '/api/spatial/kafka/status',
] as const;

const SSE_URL = '/api/events/stream?type=signal.*';
const RECONNECT_TIMEOUT_MS = 10_000;

export interface UseSseConnectionReturn {
  /** Timestamp (ms) of the last successful data fetch or reconnect/refresh. */
  lastFetchTime: number;
  /** Derived SSE connection status. */
  sseStatus: 'live' | 'reconnecting' | 'disconnected';
  /** Timestamp (ms) of the last received SSE event or heartbeat. */
  lastEventTime: number;
  /** Handler for the Reconnect button. Closes existing EventSource, opens new one. */
  onReconnect: () => void;
  /** Handler for the Refresh button. Re-fetches all displayed data queries. */
  onRefresh: () => void;
  /** Whether a refresh operation is currently in progress. */
  isRefreshing: boolean;
  /** Error message describing which queries failed on last refresh, or null. */
  refreshError: string | null;
  /** Whether the reconnect button should be disabled (attempt in progress). */
  isReconnecting: boolean;
}

export function useSseConnection(): UseSseConnectionReturn {
  const queryClient = useQueryClient();

  // ─── State ──────────────────────────────────────────────────────────────────
  const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now());
  const [lastEventTime, setLastEventTime] = useState<number>(Date.now());
  const [sseStatus, setSseStatus] = useState<'live' | 'reconnecting' | 'disconnected'>('live');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // ─── Refs ───────────────────────────────────────────────────────────────────
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── SSE Connection Setup ───────────────────────────────────────────────────

  const openConnection = useCallback(() => {
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const url = new URL(SSE_URL, window.location.origin);
    const es = new EventSource(url.toString(), { withCredentials: true });

    es.onopen = () => {
      const now = Date.now();
      setLastEventTime(now);
      setSseStatus('live');
    };

    es.onmessage = () => {
      // Any message (including heartbeats) updates lastEventTime
      const now = Date.now();
      setLastEventTime(now);
    };

    es.onerror = () => {
      // Don't auto-reconnect here — let the status polling detect the gap
      // and the user can manually reconnect if needed.
      es.close();
      eventSourceRef.current = null;
    };

    eventSourceRef.current = es;
    return es;
  }, []);

  // ─── Status polling (every 1s to update sseStatus from gap) ─────────────────

  useEffect(() => {
    statusIntervalRef.current = setInterval(() => {
      setLastEventTime((prev) => {
        const gap = Date.now() - prev;
        setSseStatus(deriveSseStatus(gap));
        return prev; // don't change the value, just read it
      });
    }, 1_000);

    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
      }
    };
  }, []);

  // ─── Open initial connection on mount ───────────────────────────────────────

  useEffect(() => {
    openConnection();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [openConnection]);

  // ─── Reconnect handler (Req 7.6, 7.7, 7.10) ───────────────────────────────

  const onReconnect = useCallback(() => {
    if (isReconnecting) return;

    setIsReconnecting(true);
    setRefreshError(null);

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Open new connection
    const url = new URL(SSE_URL, window.location.origin);
    const es = new EventSource(url.toString(), { withCredentials: true });

    let resolved = false;

    // Success: received a message or open within 10s
    const onSuccess = () => {
      if (resolved) return;
      resolved = true;
      cleanup();

      const now = Date.now();
      setLastEventTime(now);
      setLastFetchTime(now); // Req 7.10: reset elapsed to zero
      setSseStatus('live'); // Req 7.10: restore Live badge
      setIsReconnecting(false);
      eventSourceRef.current = es;

      // Re-wire standard handlers
      es.onmessage = () => {
        setLastEventTime(Date.now());
      };
      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
      };
    };

    // Failure: timeout or error within 10s
    const onFailure = () => {
      if (resolved) return;
      resolved = true;
      cleanup();

      es.close();
      setIsReconnecting(false);
      // Req 7.7: re-enable button, maintain Disconnected badge
      setSseStatus('disconnected');
    };

    const cleanup = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      es.removeEventListener('open', onSuccess);
      es.removeEventListener('error', onFailure);
    };

    es.addEventListener('open', onSuccess);
    es.addEventListener('error', onFailure);

    // Timeout after 10s (Req 7.7)
    reconnectTimerRef.current = setTimeout(onFailure, RECONNECT_TIMEOUT_MS);
  }, [isReconnecting]);

  // ─── Refresh handler (Req 7.8, 7.9, 7.10) ─────────────────────────────────

  const onRefresh = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    setRefreshError(null);

    const failedQueries: string[] = [];

    // Re-fetch all displayed data queries (Req 7.8: within 1s of click)
    const refetchPromises = SPATIAL_QUERY_KEYS.map(async (key) => {
      try {
        await queryClient.refetchQueries({ queryKey: [key] });
      } catch {
        failedQueries.push(key);
      }
    });

    await Promise.allSettled(refetchPromises);

    if (failedQueries.length > 0) {
      // Req 7.9: re-enable button, show error identifying which queries failed
      const friendlyNames = failedQueries.map(humanizeQueryKey);
      setRefreshError(`Failed to refresh: ${friendlyNames.join(', ')}`);
    } else {
      // Req 7.10: reset elapsed time to zero, restore Live badge
      const now = Date.now();
      setLastFetchTime(now);
      setRefreshError(null);
      // Only set to live if SSE is actually connected
      if (eventSourceRef.current) {
        setLastEventTime(now);
        setSseStatus('live');
      }
    }

    setIsRefreshing(false);
  }, [isRefreshing, queryClient]);

  return {
    lastFetchTime,
    sseStatus,
    lastEventTime,
    onReconnect,
    onRefresh,
    isRefreshing,
    refreshError,
    isReconnecting,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Convert a raw query key path to a human-friendly label for error messages. */
function humanizeQueryKey(key: string): string {
  if (key.includes('event-primitives')) return 'Signals';
  if (key.includes('signal-feeds')) return 'Feeds';
  if (key.includes('cycles')) return 'Cycles';
  if (key.includes('cycle-signal-subscriptions')) return 'Subscriptions';
  if (key.includes('kafka/status')) return 'Kafka Status';
  return key;
}
