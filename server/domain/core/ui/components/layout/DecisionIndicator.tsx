/**
 * Decision Indicator
 *
 * Persistent header indicator showing the count of pending approval decisions.
 * Renders alongside the NotificationInbox in the Layout Header.
 *
 * States:
 * - idle (count = 0): Icon only, no badge, no animation
 * - active (count 1–9): Numeric badge with pulse animation
 * - overflow (count > 9): "9+" badge with pulse animation
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDecisionStore } from '../../stores/decision.store';
import { useDecisionFallbackPolling } from '../../hooks/use-decision-fallback-polling';

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Formats the pending count into a badge display string.
 *
 * @param count - The number of pending decisions (must be >= 0)
 * @returns `null` when count is 0 (no badge), the exact numeric string for 1–9,
 *          or "9+" for counts exceeding 9.
 */
export function formatBadgeCount(count: number): string | null {
  if (count <= 0) return null;
  if (count <= 9) return String(count);
  return '9+';
}

// ─── Component ──────────────────────────────────────────────────────────────

export const DecisionIndicator: React.FC = () => {
  const pendingCount = useDecisionStore((state) => state.pendingCount);

  // Activates fallback polling when SSE connection is lost (Requirement 1.7)
  useDecisionFallbackPolling();

  const badgeText = formatBadgeCount(pendingCount);
  const isActive = pendingCount > 0;

  const handleActivate = () => {
    window.dispatchEvent(new CustomEvent('agent-assist-request', {
      detail: {
        context: { assistantView: 'approvals', source: 'decision-indicator' },
      },
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate();
    }
  };

  const ariaLabel =
    pendingCount === 0
      ? 'No pending decisions'
      : `${pendingCount} pending decision${pendingCount === 1 ? '' : 's'}`;

  return (
    <button
      className={cn(
        'relative flex items-center justify-center min-w-[3rem] w-12 h-12 rounded-2xl glass-card transition-all text-primary dark:text-primary shadow-lg',
        'bg-white/20 dark:bg-white/5 hover:scale-110 active:scale-90',
        isActive && 'animate-pulse-slow'
      )}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      aria-label={ariaLabel}
      title="Review decisions in Oddjob Assistant"
      type="button"
    >
      <Sparkles className="h-6 w-6" />
      {badgeText && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center bg-red-500 text-white text-[10px] font-black rounded-full shadow-lg ring-2 ring-white dark:ring-slate-900 border-2 border-white/20 px-1">
          {badgeText}
        </span>
      )}
    </button>
  );
};
