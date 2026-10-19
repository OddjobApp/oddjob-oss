/**
 * DecisionToastManager
 *
 * Displays transient toast notifications when new approval decisions arrive.
 * Mounted at the Layout level so toasts persist across SPA navigation.
 *
 * Features:
 * - Appears in bottom-right corner within 500ms of decision:new event
 * - Shows tool name, risk level indicator, description truncated to 80 chars
 * - Auto-dismisses after 8 seconds
 * - Pauses timer on hover, resumes with remaining time on pointer leave
 * - Stacks up to 3 toasts; shows summary toast for additional arrivals within 2s
 * - Opens the Assistant approvals view on click
 * - Dismiss button on each toast
 * - ARIA live region with polite politeness
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDecisionStore, type PendingRequest } from '../../stores/decision.store';

// ─── Exported Utility Functions (for testability) ───────────────────────────

/**
 * Truncates a description string to a maximum length, appending an ellipsis
 * if the original exceeds the limit.
 *
 * @param text - The description text to truncate
 * @param maxLen - Maximum allowed length (default 80)
 * @returns The original text if within limit, or sliced text + "…"
 */
export function truncateDescription(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

/**
 * Calculates the remaining time before a toast should auto-dismiss,
 * accounting for elapsed time (e.g., after a hover pause/resume cycle).
 *
 * @param elapsedMs - Milliseconds already elapsed before pause
 * @param totalMs - Total auto-dismiss duration (default 8000)
 * @returns Remaining milliseconds, floored at 0
 */
export function calculateRemainingDismissTime(elapsedMs: number, totalMs = 8000): number {
  return Math.max(0, totalMs - elapsedMs);
}

/**
 * Computes which toasts are visible and how many are summarized.
 *
 * @param toasts - All active toast entries
 * @param maxVisible - Maximum number of individual toasts to show (default 3)
 * @returns Object with visible toasts array and count of additional toasts in summary
 */
export function computeToastStack(
  toasts: DecisionToast[],
  maxVisible = 3
): { visible: DecisionToast[]; summaryCount: number } {
  if (toasts.length <= maxVisible) {
    return { visible: toasts, summaryCount: 0 };
  }
  return {
    visible: toasts.slice(0, maxVisible),
    summaryCount: toasts.length - maxVisible,
  };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DecisionToast {
  id: string;
  requestId: number;
  toolName: string;
  riskLevel: 'low' | 'medium' | 'high';
  description: string;
  arrivedAt: number;
  isHovered: boolean;
  remainingMs: number;
}

export interface DecisionToastManagerProps {
  maxVisible?: number;
  autoDismissMs?: number;
}

// ─── Risk Level Helpers ─────────────────────────────────────────────────────

function getRiskColor(riskLevel: 'low' | 'medium' | 'high'): string {
  switch (riskLevel) {
    case 'high':
      return 'bg-red-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'low':
      return 'bg-green-500';
  }
}

function getRiskIcon(riskLevel: 'low' | 'medium' | 'high') {
  switch (riskLevel) {
    case 'high':
      return <AlertTriangle className="h-4 w-4 text-red-400" />;
    case 'medium':
      return <AlertCircle className="h-4 w-4 text-yellow-400" />;
    case 'low':
      return <Info className="h-4 w-4 text-green-400" />;
  }
}

function isAutoApprovedTool(toolName?: string): boolean {
  if (!toolName) return false;
  const lower = toolName.toLowerCase().replace(/[\s_\-]/g, '');
  return lower.includes('neurallogextractor') ||
         lower.includes('gmscoresynthesizer') ||
         lower.includes('behavioralresonancedetector') ||
         lower.includes('logextractor') ||
         lower.includes('coresynthesizer');
}

// ─── Component ──────────────────────────────────────────────────────────────

export const DecisionToastManager: React.FC<DecisionToastManagerProps> = ({
  maxVisible = 3,
  autoDismissMs = 8000,
}) => {
  const [toasts, setToasts] = useState<DecisionToast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const previousRequestIdsRef = useRef<Set<number>>(new Set());

  // Subscribe to pending requests changes for new arrivals
  const pendingRequests = useDecisionStore((state) => state.pendingRequests);

  // Detect new arrivals and purge resolved toasts by comparing previous vs current pending requests
  useEffect(() => {
    const currentIds = new Set(pendingRequests.map((r) => r.id));
    const prevIds = previousRequestIdsRef.current;

    // Instantly purge toasts whose underlying decision request is no longer pending
    setToasts((prevToasts) => prevToasts.filter((t) => currentIds.has(t.requestId)));

    // Find newly added requests (excluding auto-approved routine tools)
    const newRequests = pendingRequests.filter(
      (r) => !prevIds.has(r.id) && !isAutoApprovedTool(r.toolName)
    );

    if (newRequests.length > 0) {
      const now = Date.now();
      const newToasts: DecisionToast[] = newRequests.map((req) => ({
        id: `toast-${req.id}-${now}`,
        requestId: req.id,
        toolName: req.toolName,
        riskLevel: req.riskLevel,
        description: req.description,
        arrivedAt: now,
        isHovered: false,
        remainingMs: autoDismissMs,
      }));

      setToasts((prev) => [...prev, ...newToasts]);
    }

    // Update the tracked set
    previousRequestIdsRef.current = currentIds;
  }, [pendingRequests, autoDismissMs]);

  // Start auto-dismiss timers for new toasts
  useEffect(() => {
    toasts.forEach((toast) => {
      if (!toast.isHovered && !timersRef.current.has(toast.id)) {
        const timer = setTimeout(() => {
          dismissToast(toast.id);
        }, toast.remainingMs);
        timersRef.current.set(toast.id, timer);
      }
    });
  }, [toasts]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    const timer = timersRef.current.get(toastId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(toastId);
    }
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const handleMouseEnter = useCallback((toastId: string) => {
    // Pause the timer
    const timer = timersRef.current.get(toastId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(toastId);
    }

    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== toastId) return t;
        const elapsed = Date.now() - t.arrivedAt;
        const remaining = Math.max(0, t.remainingMs - elapsed);
        return {
          ...t,
          isHovered: true,
          remainingMs: remaining,
          arrivedAt: Date.now(), // Reset arrivedAt for calculating remaining on leave
        };
      })
    );
  }, []);

  const handleMouseLeave = useCallback((toastId: string) => {
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== toastId) return t;
        return {
          ...t,
          isHovered: false,
          arrivedAt: Date.now(), // Reset arrivedAt so the timer calculates from now
        };
      })
    );

    // Resume timer with remaining time
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === toastId);
      if (toast && !toast.isHovered) {
        const timer = setTimeout(() => {
          dismissToast(toastId);
        }, toast.remainingMs);
        timersRef.current.set(toastId, timer);
      }
      return prev;
    });
  }, [dismissToast]);

  const handleToastClick = useCallback(
    (toastId: string) => {
      dismissToast(toastId);
      window.dispatchEvent(new CustomEvent('agent-assist-request', {
        detail: {
          context: { assistantView: 'approvals', source: 'decision-toast' },
        },
      }));
    },
    [dismissToast]
  );

  const { visible, summaryCount } = computeToastStack(toasts, maxVisible);

  if (toasts.length === 0) {
    return (
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-24 inset-x-3 z-toast pointer-events-none sm:bottom-20 sm:left-auto sm:right-6"
      />
    );
  }

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-24 inset-x-3 z-toast flex flex-col-reverse gap-2 items-stretch pointer-events-none sm:bottom-20 sm:left-auto sm:right-6 sm:items-end"
    >
      {/* Summary toast for overflow */}
      {summaryCount > 0 && (
        <div
          className="pointer-events-auto w-full rounded-xl bg-card/95 backdrop-blur-xl border border-foreground/10 p-3 shadow-2xl cursor-pointer transition-all hover:scale-[1.02] sm:w-80 sm:max-w-sm"
          onClick={() => window.dispatchEvent(new CustomEvent('agent-assist-request', {
            detail: {
              context: { assistantView: 'approvals', source: 'decision-toast-summary' },
            },
          }))}
          role="status"
        >
          <p className="text-xs font-bold text-foreground">
            +{summaryCount} more pending decision{summaryCount > 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* Visible individual toasts */}
      {visible.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto w-full rounded-xl bg-card/95 backdrop-blur-xl border border-foreground/10 p-4 shadow-2xl cursor-pointer transition-all hover:scale-[1.02] animate-in slide-in-from-right-5 fade-in duration-300 sm:w-80 sm:max-w-sm"
          onClick={() => handleToastClick(toast.id)}
          onMouseEnter={() => handleMouseEnter(toast.id)}
          onMouseLeave={() => handleMouseLeave(toast.id)}
          role="status"
          aria-label={`New decision: ${toast.toolName}, ${toast.riskLevel} risk`}
        >
          <div className="flex items-start gap-3">
            {/* Risk level indicator */}
            <div className="flex-shrink-0 mt-0.5">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn('h-2.5 w-2.5 rounded-full', getRiskColor(toast.riskLevel))}
                  aria-hidden="true"
                />
                {getRiskIcon(toast.riskLevel)}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-black text-foreground uppercase tracking-wide truncate">
                  {toast.toolName}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                    toast.riskLevel === 'high' && 'text-red-700 dark:text-red-300 bg-red-500/20',
                    toast.riskLevel === 'medium' && 'text-yellow-700 dark:text-yellow-300 bg-yellow-500/20',
                    toast.riskLevel === 'low' && 'text-green-700 dark:text-green-300 bg-green-500/20'
                  )}
                >
                  {toast.riskLevel}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {truncateDescription(toast.description)}
              </p>
            </div>

            {/* Dismiss button */}
            <button
              type="button"
              className="flex-shrink-0 p-1 rounded-lg hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(toast.id);
              }}
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DecisionToastManager;
