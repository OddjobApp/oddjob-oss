/**
 * DecisionBanner
 *
 * Persistent, dismissible banner displayed at the top of the main content area
 * when high-risk approval requests have been pending for more than 5 minutes.
 *
 * Features:
 * - Shows when high-risk request pending > 5 minutes AND not in dismissed set
 * - Displays count of aging requests and longest pending duration as relative time
 * - Updates displayed duration every 30 seconds
 * - Uses amber/orange warning color scheme
 * - Includes action link navigating to /control/decisions
 * - Dismiss button records current aging IDs so banner won't reappear for same set
 * - Auto-dismisses within 2 seconds when all high-risk requests resolved
 * - Placed below Layout_Header at top of main content area
 * - role="alert" and accessible dismiss button with aria-label
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { AlertTriangle, X, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDecisionStore, type PendingRequest } from '../../stores/decision.store';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default threshold in milliseconds for a high-risk request to be considered "aging" (5 minutes). */
const DEFAULT_AGING_THRESHOLD_MS = 5 * 60 * 1000;

/** Interval in milliseconds to refresh the displayed duration (30 seconds). */
const DURATION_REFRESH_INTERVAL_MS = 30_000;

/** Delay before auto-dismissing when all high-risk requests resolve (2 seconds). */
const AUTO_DISMISS_DELAY_MS = 2_000;

// ─── Exported Utility Functions (for testability) ───────────────────────────

/**
 * Determines whether a pending request qualifies as an aging high-risk request
 * that should be shown in the banner.
 *
 * A request is aging if:
 * 1. It has riskLevel === 'high'
 * 2. It has been pending longer than `thresholdMs`
 * 3. Its ID is NOT in the `dismissedIds` set
 *
 * @param request - The pending request to evaluate
 * @param now - Current timestamp
 * @param thresholdMs - Aging threshold in milliseconds (default: 5 minutes)
 * @param dismissedIds - Set of request IDs that have been dismissed
 * @returns true if the request should be displayed in the banner
 */
export function isAgingHighRisk(
  request: PendingRequest,
  now: Date,
  thresholdMs: number = DEFAULT_AGING_THRESHOLD_MS,
  dismissedIds: Set<number> = new Set()
): boolean {
  if (request.riskLevel !== 'high') return false;
  if (dismissedIds.has(request.id)) return false;
  const elapsed = now.getTime() - new Date(request.createdAt).getTime();
  return elapsed > thresholdMs;
}

/**
 * Formats a duration in milliseconds into a human-readable relative time string.
 *
 * Examples:
 * - 30000 → "1 minute" (rounds up from 30s)
 * - 720000 → "12 minutes"
 * - 3780000 → "1 hour 3 minutes"
 * - 7200000 → "2 hours"
 *
 * @param ms - Duration in milliseconds (must be >= 0)
 * @returns Human-readable relative time string
 */
export function formatRelativeTime(ms: number): string {
  if (ms < 0) ms = 0;

  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    if (minutes <= 1) return '1 minute';
    return `${minutes} minutes`;
  }

  const hourStr = hours === 1 ? '1 hour' : `${hours} hours`;

  if (minutes === 0) return hourStr;

  const minStr = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  return `${hourStr} ${minStr}`;
}

/**
 * Computes the banner display state from a list of high-risk requests.
 *
 * Filters the requests to only those that are aging (past threshold) and not dismissed,
 * then computes the count and the longest pending duration formatted as relative time.
 *
 * @param requests - All high-risk pending requests from the store
 * @param now - Current timestamp
 * @param dismissedIds - Set of dismissed request IDs
 * @param thresholdMs - Aging threshold in milliseconds (default: 5 minutes)
 * @returns Display state with count and formatted duration, or null if nothing to show
 */
export function computeBannerDisplay(
  requests: PendingRequest[],
  now: Date,
  dismissedIds: Set<number>,
  thresholdMs: number = DEFAULT_AGING_THRESHOLD_MS
): { visible: boolean; count: number; longestDuration: string } | null {
  const agingRequests = requests.filter((r) =>
    isAgingHighRisk(r, now, thresholdMs, dismissedIds)
  );

  if (agingRequests.length === 0) return null;

  // Find the longest pending duration
  let longestMs = 0;
  for (const req of agingRequests) {
    const elapsed = now.getTime() - new Date(req.createdAt).getTime();
    if (elapsed > longestMs) longestMs = elapsed;
  }

  return {
    visible: true,
    count: agingRequests.length,
    longestDuration: formatRelativeTime(longestMs),
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export const DecisionBanner: React.FC = () => {
  const [, setLocation] = useLocation();
  const [now, setNow] = useState(() => new Date());
  const [autoDismissed, setAutoDismissed] = useState(false);

  const highRiskAgingRequests = useDecisionStore((state) => state.highRiskAgingRequests);
  const bannerDismissedIds = useDecisionStore((state) => state.bannerDismissedIds);

  // Update "now" every 30 seconds so the displayed duration refreshes
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, DURATION_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Compute banner display state
  const bannerDisplay = useMemo(
    () => computeBannerDisplay(highRiskAgingRequests, now, bannerDismissedIds),
    [highRiskAgingRequests, now, bannerDismissedIds]
  );

  // Auto-dismiss within 2 seconds when all high-risk requests are resolved
  useEffect(() => {
    if (bannerDisplay === null && !autoDismissed) {
      // All resolved or nothing to show — schedule auto-dismiss
      const timer = setTimeout(() => {
        setAutoDismissed(true);
      }, AUTO_DISMISS_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // If new aging requests appear, reset auto-dismiss state
    if (bannerDisplay !== null) {
      setAutoDismissed(false);
    }
  }, [bannerDisplay, autoDismissed]);

  // Handle manual dismiss
  const handleDismiss = useCallback(() => {
    useDecisionStore.getState().dismissBanner();
  }, []);

  // Handle navigation to decision inbox
  const handleViewDecisions = useCallback(() => {
    setLocation('/control/decisions');
  }, [setLocation]);

  // Don't render when there's nothing to display
  if (!bannerDisplay) return null;

  return (
    <div
      role="alert"
      className={cn(
        'w-full border-b transition-all duration-300 animate-in slide-in-from-top-2 fade-in',
        'bg-amber-50/90 dark:bg-amber-950/90 border-amber-300 dark:border-amber-700'
      )}
      data-testid="decision-banner"
    >
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Icon + content */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <AlertTriangle
              className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                {bannerDisplay.count === 1
                  ? '1 high-risk decision'
                  : `${bannerDisplay.count} high-risk decisions`}{' '}
                pending for {bannerDisplay.longestDuration}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Critical approvals require your attention to unblock agents.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Action link to Decision Inbox */}
            <button
              type="button"
              onClick={handleViewDecisions}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                'bg-amber-200/80 dark:bg-amber-800/60 text-amber-900 dark:text-amber-100',
                'hover:bg-amber-300/80 dark:hover:bg-amber-700/60'
              )}
            >
              Review
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            {/* Dismiss button */}
            <button
              type="button"
              onClick={handleDismiss}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                'text-amber-600 dark:text-amber-400',
                'hover:bg-amber-200/60 dark:hover:bg-amber-800/40',
                'hover:text-amber-900 dark:hover:text-amber-100'
              )}
              aria-label="Dismiss decision banner"
              data-testid="decision-banner-dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DecisionBanner;
