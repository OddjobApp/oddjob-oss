/**
 * useDecisionFallbackPolling
 *
 * Watches the DecisionStore's `connectionState` and starts a 30-second
 * fallback polling interval when the SSE connection is lost (state is
 * 'reconnecting' or 'polling'). Stops polling when the connection
 * returns to 'connected'.
 *
 * The polling fetches `/api/approvals/pending/count` and updates the
 * store's `pendingCount` from the response.
 *
 * Requirements: 1.7
 */

import { useEffect, useRef } from 'react';
import { useDecisionStore } from '../stores/decision.store';

/** Polling interval in milliseconds (30 seconds per Requirement 1.7). */
const FALLBACK_POLL_INTERVAL_MS = 30_000;

/**
 * Fetches the pending approval count from the REST endpoint.
 * Returns the count or null if the request fails.
 */
async function fetchPendingCount(): Promise<number | null> {
  try {
    const response = await fetch('/api/approvals/pending/count', {
      credentials: 'include',
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.count === 'number' ? data.count : null;
  } catch {
    return null;
  }
}

/**
 * Hook that provides fallback polling for the Decision Indicator
 * when the SSE connection is unavailable.
 *
 * - Activates when `connectionState` is 'reconnecting' or 'polling'
 * - Polls every 30 seconds for the pending count
 * - Updates the store's pendingCount on successful responses
 * - Deactivates (clears interval) when connectionState returns to 'connected'
 */
export function useDecisionFallbackPolling(): void {
  const connectionState = useDecisionStore((state) => state.connectionState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Only poll when SSE is disconnected
    if (connectionState === 'connected') {
      // SSE reconnected — stop any active polling
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // connectionState is 'reconnecting' or 'polling' — start fallback polling
    const poll = async () => {
      const count = await fetchPendingCount();
      if (count !== null) {
        useDecisionStore.setState({ pendingCount: count });
      }
    };

    // Poll immediately on state change, then at 30-second intervals
    poll();

    intervalRef.current = setInterval(poll, FALLBACK_POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connectionState]);
}
