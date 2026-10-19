import { useMemo } from 'react';
import { Clock, CheckCircle2, XCircle, Loader2, Zap, AlertTriangle, Ban, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SignalAction } from './utils';
import { sortActions } from './utils';

/**
 * ActionTimeline — Chronological list of actions taken on a specific signal.
 * Displays each action with its type, timestamp, and outcome status.
 * Sorted in reverse chronological order, showing 50 most recent with "load more".
 *
 * Shows a "Cycle Active" status badge when any action has type === 'cycle_launched'
 * and outcome === 'pending' (requirement 5.1: within 2s of cycle creation).
 *
 * Requirements: 5.1, 5.2
 */

export interface ActionTimelineProps {
  signalId: string;
  actions: SignalAction[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_TYPE_CONFIG: Record<
  SignalAction['type'],
  { label: string; icon: typeof Zap; colorClass: string }
> = {
  cycle_launched: {
    label: 'Cycle Launched',
    icon: Zap,
    colorClass: 'text-blue-500',
  },
  escalated: {
    label: 'Escalated',
    icon: AlertTriangle,
    colorClass: 'text-amber-500',
  },
  dismissed: {
    label: 'Dismissed',
    icon: Ban,
    colorClass: 'text-red-500',
  },
  snoozed: {
    label: 'Snoozed',
    icon: Moon,
    colorClass: 'text-purple-500',
  },
};

const OUTCOME_CONFIG: Record<
  SignalAction['outcome'],
  { label: string; icon: typeof CheckCircle2; colorClass: string }
> = {
  succeeded: {
    label: 'Succeeded',
    icon: CheckCircle2,
    colorClass: 'text-green-500',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    colorClass: 'text-red-500',
  },
  pending: {
    label: 'Pending',
    icon: Loader2,
    colorClass: 'text-yellow-500',
  },
};

/** Format an ISO timestamp into a human-readable relative or absolute string. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 60_000) {
    return `${Math.max(0, Math.floor(diffMs / 1000))}s ago`;
  }
  if (diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)}m ago`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.floor(diffMs / 3_600_000)}h ago`;
  }

  // Older than a day — show date
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActionTimeline({
  signalId,
  actions,
  isLoading,
  hasMore,
  onLoadMore,
}: ActionTimelineProps) {
  // Sort actions in reverse chronological order, capped at 50
  const sortedActions = useMemo(() => sortActions(actions), [actions]);

  // Determine if a cycle is currently active (Req 5.1)
  const hasCycleActive = useMemo(
    () =>
      actions.some(
        (a) => a.type === 'cycle_launched' && a.outcome === 'pending',
      ),
    [actions],
  );

  return (
    <section
      className="flex flex-col gap-2"
      aria-label={`Action timeline for signal ${signalId}`}
      data-testid="action-timeline"
    >
      {/* Header with optional Cycle Active badge */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">
          Action Timeline
        </h3>
        {hasCycleActive && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600"
            data-testid="cycle-active-badge"
            aria-label="Cycle Active"
          >
            <Zap className="h-3 w-3" aria-hidden="true" />
            Cycle Active
          </span>
        )}
      </div>

      {/* Loading state */}
      {isLoading && sortedActions.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">
            Loading actions…
          </span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && sortedActions.length === 0 && (
        <p
          className="py-4 text-center text-xs text-muted-foreground"
          data-testid="action-timeline-empty"
        >
          No actions recorded for this signal.
        </p>
      )}

      {/* Action list */}
      {sortedActions.length > 0 && (
        <ol
          className="space-y-1"
          aria-label="Actions list"
          data-testid="action-timeline-list"
        >
          {sortedActions.map((action) => {
            const typeConfig = ACTION_TYPE_CONFIG[action.type];
            const outcomeConfig = OUTCOME_CONFIG[action.outcome];
            const TypeIcon = typeConfig.icon;
            const OutcomeIcon = outcomeConfig.icon;

            return (
              <li
                key={action.id}
                className="flex items-center gap-3 rounded-md border border-border/50 bg-card/40 px-3 py-2"
                data-testid={`action-item-${action.id}`}
              >
                {/* Action type icon */}
                <TypeIcon
                  className={cn('h-3.5 w-3.5 shrink-0', typeConfig.colorClass)}
                  aria-hidden="true"
                />

                {/* Action type label */}
                <span className="min-w-0 flex-1 text-xs font-medium text-foreground">
                  {typeConfig.label}
                </span>

                {/* Timestamp */}
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <time dateTime={action.timestamp}>
                    {formatTimestamp(action.timestamp)}
                  </time>
                </span>

                {/* Outcome status */}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    action.outcome === 'succeeded' && 'bg-green-500/10 text-green-600',
                    action.outcome === 'failed' && 'bg-red-500/10 text-red-600',
                    action.outcome === 'pending' && 'bg-yellow-500/10 text-yellow-600',
                  )}
                  aria-label={`Outcome: ${outcomeConfig.label}`}
                >
                  <OutcomeIcon
                    className={cn(
                      'h-3 w-3',
                      action.outcome === 'pending' && 'animate-spin',
                    )}
                    aria-hidden="true"
                  />
                  {outcomeConfig.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Load more button */}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoading}
          className={cn(
            'mt-1 w-full rounded-md border border-border py-2 text-xs font-medium text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
          data-testid="action-timeline-load-more"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </span>
          ) : (
            'Load older actions'
          )}
        </button>
      )}
    </section>
  );
}
