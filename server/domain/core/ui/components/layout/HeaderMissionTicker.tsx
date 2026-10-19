import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Live indicator for the running mission, shown in the header.
 *
 * Everything here is either a real value or absent. An earlier version filled
 * the gaps with constants — five rotating invented "thoughts" rendered in
 * quotation marks, and `topMission.spend || 0.42` — which was not an edge case:
 * `spend` and `softCap` are not fields on a mission at all, so the fallbacks
 * fired for every viewer, every time, and the header reported a fabricated
 * $0.42 as money spent. A placeholder indistinguishable from data is worse than
 * a visible gap, especially for a currency figure.
 *
 * The real columns are `currentSpendUsd` and `budgetLimitUsd`. Both are drizzle
 * `decimal`, which arrives over the wire as a STRING, not a number — calling
 * toFixed() on one directly throws.
 */

interface ActiveMission {
  id: number;
  name?: string | null;
  status?: string | null;
  description?: string | null;
  /** decimal(10,2) — a string such as "0.00", not a number. */
  currentSpendUsd?: string | null;
  /** decimal(10,2) — a string such as "5.00", not a number. */
  budgetLimitUsd?: string | null;
}

const ACTIVE_STATUSES = new Set(["active", "running", "IN_PROGRESS"]);

/** Parse a drizzle decimal string, returning null for absent or unparseable values. */
function parseUsd(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const HeaderMissionTicker: React.FC<{ className?: string }> = ({ className }) => {
  const { data: missionsData } = useQuery<ActiveMission[]>({
    queryKey: ["/api/missions"],
    refetchInterval: 10000,
  });

  const topMission = Array.isArray(missionsData)
    ? missionsData.find((m) => ACTIVE_STATUSES.has(String(m.status)))
    : undefined;

  const handleClick = () => {
    window.dispatchEvent(
      new CustomEvent("agent-assist-request", {
        detail: {
          context: {
            assistantView: "missions",
            missionId: topMission?.id,
            source: "header-mission-ticker",
          },
        },
      })
    );
  };

  if (!topMission) {
    return null;
  }

  // Only the real columns. `spend`, `softCap` and `budget` are not fields on a
  // mission — reading them was the original defect here, and reaching them
  // through `as any` only hides that from the compiler: the chain always falls
  // through to undefined, so the casts buy nothing and re-legitimise the wrong
  // names for the next reader.
  const spend = parseUsd(topMission.currentSpendUsd);
  const budget = parseUsd(topMission.budgetLimitUsd);
  const summary = topMission.description?.trim();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-950/20",
        "cursor-pointer transition-all duration-200 hover:border-emerald-500/50 hover:bg-emerald-500/15 shadow-xs max-w-xs xl:max-w-md shrink min-w-0 overflow-hidden group select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1",
        className
      )}
      title="Mission running — open telemetry and steering controls in Assistant"
      data-testid="header-mission-ticker"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>

      <span className="font-bold text-[11px] text-emerald-600 dark:text-emerald-400 truncate max-w-[130px] xl:max-w-[180px] shrink">
        {topMission.name || `Mission #${topMission.id}`}
      </span>

      {/*
        The mission's own description, when it has one. Deliberately unquoted:
        quotation marks made a static field read as the agent's live reasoning.
      */}
      {summary && (
        <span
          className="text-[10px] text-muted-foreground truncate font-mono min-w-0 hidden sm:inline"
          data-testid="header-mission-ticker-summary"
        >
          {summary}
        </span>
      )}

      {/* Spend renders only when a real figure parses. No value, no segment. */}
      {spend !== null && (
        <span
          className="text-[10px] font-mono text-muted-foreground/80 shrink-0 border-l border-emerald-500/30 pl-2 tabular-nums"
          data-testid="header-mission-ticker-spend"
        >
          ${spend.toFixed(2)}
          {budget !== null && <span className="text-muted-foreground/60"> / ${budget.toFixed(2)}</span>}
        </span>
      )}

      <ChevronRight className="w-3 h-3 text-emerald-500/70 group-hover:translate-x-0.5 transition-transform shrink-0" />
    </div>
  );
};

export default HeaderMissionTicker;
