/**
 * Decision Dashboard Widget
 *
 * Displays blocked missions and agents awaiting human approval decisions.
 * Groups pending requests by mission, sorted by longest pending duration.
 * Shows max 5 items with "View all" when more exist; reactively updates
 * from DecisionStore (driven by SSE events).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import React from 'react';
import { useLocation } from 'wouter';
import { Scale, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDecisionStore, type PendingRequest } from '../../stores/decision.store';
import { BlockedSessionsWidget } from '@domain-ui/sdlc-pipeline/ui/modules/components/BlockedSessionsWidget';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BlockedRequest {
  id: number;
  toolName: string;
  riskLevel: 'low' | 'medium' | 'high';
  pendingSinceMs: number;
  description: string;
}

export interface GroupedBlockedWork {
  missionName: string;
  missionId: number | null;
  requests: BlockedRequest[];
}

export interface WidgetItem {
  id: number;
  missionName: string;
  missionId: number | null;
  toolName: string;
  riskLevel: 'low' | 'medium' | 'high';
  pendingSinceMs: number;
  description: string;
}

export interface WidgetDisplay {
  items: WidgetItem[];
  hasMore: boolean;
  totalCount: number;
}

// ─── Utility Functions (exported for testability) ───────────────────────────

/**
 * Formats a duration in milliseconds to a short human-readable string.
 *
 * Examples: "3m", "1h 12m", "2h", "< 1m"
 *
 * @param ms - Duration in milliseconds (must be >= 0)
 * @returns Human-readable short duration string
 */
export function formatShortDuration(ms: number): string {
  if (ms < 0) ms = 0;

  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0 && minutes === 0) return '< 1m';
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Groups pending requests by mission name and sorts groups by longest
 * pending duration (descending). Within each group, requests are also
 * sorted by longest pending first.
 *
 * Requests with null/undefined missionName are grouped under "Unassigned".
 *
 * @param requests - Array of pending requests from DecisionStore
 * @param now - Reference timestamp for computing pending duration (default: Date.now())
 * @returns Array of grouped blocked work sorted by longest pending duration
 */
export function groupAndSortBlockedWork(
  requests: PendingRequest[],
  now: number = Date.now()
): GroupedBlockedWork[] {
  // Build groups by mission name
  const groupMap = new Map<string, { missionId: number | null; requests: BlockedRequest[] }>();

  for (const req of requests) {
    const missionName = req.missionName || 'Unassigned';
    const pendingSinceMs = now - new Date(req.createdAt).getTime();

    const blocked: BlockedRequest = {
      id: req.id,
      toolName: req.toolName,
      riskLevel: req.riskLevel,
      pendingSinceMs: Math.max(0, pendingSinceMs),
      description: req.description,
    };

    if (!groupMap.has(missionName)) {
      groupMap.set(missionName, { missionId: req.missionId, requests: [] });
    }
    groupMap.get(missionName)!.requests.push(blocked);
  }

  // Sort requests within each group by longest pending first
  for (const group of groupMap.values()) {
    group.requests.sort((a, b) => b.pendingSinceMs - a.pendingSinceMs);
  }

  // Convert to array and sort groups by longest pending request in each group
  const groups: GroupedBlockedWork[] = Array.from(groupMap.entries()).map(
    ([name, { missionId, requests: reqs }]) => ({
      missionName: name,
      missionId,
      requests: reqs,
    })
  );

  groups.sort((a, b) => {
    const aMax = a.requests[0]?.pendingSinceMs ?? 0;
    const bMax = b.requests[0]?.pendingSinceMs ?? 0;
    return bMax - aMax;
  });

  return groups;
}

/**
 * Computes the widget display state: flattened items (limited to maxItems),
 * whether more exist, and the total count across all groups.
 *
 * Items are taken from the grouped/sorted output in order: the longest-pending
 * request from each group in turn, then the second-longest, etc.
 * This ensures the display is sorted by longest pending overall.
 *
 * @param requests - Array of pending requests from DecisionStore
 * @param maxItems - Maximum items to display (default: 5)
 * @param now - Reference timestamp for computing pending duration (default: Date.now())
 * @returns Widget display state
 */
export function computeWidgetDisplay(
  requests: PendingRequest[],
  maxItems: number = 5,
  now: number = Date.now()
): WidgetDisplay {
  const groups = groupAndSortBlockedWork(requests, now);
  const totalCount = requests.length;

  // Flatten all requests with their group context, sorted by longest pending
  const allItems: WidgetItem[] = [];
  for (const group of groups) {
    for (const req of group.requests) {
      allItems.push({
        id: req.id,
        missionName: group.missionName,
        missionId: group.missionId,
        toolName: req.toolName,
        riskLevel: req.riskLevel,
        pendingSinceMs: req.pendingSinceMs,
        description: req.description,
      });
    }
  }

  // Sort all items by longest pending first (global sort)
  allItems.sort((a, b) => b.pendingSinceMs - a.pendingSinceMs);

  const items = allItems.slice(0, maxItems);
  const hasMore = totalCount > maxItems;

  return { items, hasMore, totalCount };
}

// ─── Risk Level Indicator ───────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
};

function RiskDot({ level }: { level: string }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 rounded-full', RISK_COLORS[level] ?? 'bg-gray-400')}
      aria-label={`${level} risk`}
    />
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface DecisionDashboardWidgetProps {
  maxItems?: number;
}

export function DecisionDashboardWidget({ maxItems = 5 }: DecisionDashboardWidgetProps) {
  const pendingRequests = useDecisionStore((state) => state.pendingRequests);
  const [, setLocation] = useLocation();

  const now = Date.now();
  const { items, hasMore, totalCount } = computeWidgetDisplay(pendingRequests, maxItems, now);

  const handleItemActivate = () => {
    setLocation('/control/decisions');
  };

  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleItemActivate();
    }
  };

  // Mission-level blocked work (empty state renders a placeholder).
  const missionSection =
    items.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <Scale className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm font-medium">No blocked work</p>
      </div>
    ) : (
      <>
        <ul role="list" className="divide-y divide-border/40 flex-1">
          {items.map((item) => (
            <li
              key={item.id}
              role="listitem"
              tabIndex={0}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-inset"
              onClick={handleItemActivate}
              onKeyDown={handleItemKeyDown}
              aria-label={`${item.toolName} - ${item.riskLevel} risk - pending ${formatShortDuration(item.pendingSinceMs)} - mission ${item.missionName}`}
            >
              <RiskDot level={item.riskLevel} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {item.toolName}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatShortDuration(item.pendingSinceMs)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {item.missionName}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {hasMore && (
          <div className="border-t border-border/40 px-4 py-2">
            <button
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
              onClick={handleItemActivate}
              type="button"
            >
              View all ({totalCount})
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </>
    );

  return (
    <div className="flex flex-col h-full">
      {missionSection}
      {/* Pipeline sessions blocked on a quality gate (Codegen Workbench integration). */}
      <BlockedSessionsWidget />
    </div>
  );
}
