import React, { useMemo } from "react";
import { 
  Rocket, 
  DollarSign, 
  Zap, 
  Clock, 
  Layers, 
  Sparkles, 
  ShieldCheck, 
  RefreshCw,
  AlertTriangle,
  Play,
  Pause,
  CheckCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WavePlanItem } from "../types";
import { validateWavePlan } from "../dag-utils";

export interface CycleExecutionDockProps {
  waves: WavePlanItem[];
  budgetLimitUsd: number;
  tokenLimit: number;
  targetSlaDays: number;
  maxParallelMissions: number;
  onCommitCycle: () => void;
  isSubmitting?: boolean;
  onAutoBalance?: () => void;
  className?: string;

  /** Active cycle id (once saved or passed in) */
  activeCycleId?: number | null;
  /** Live cycle status */
  cycleStatus?: "pending_approval" | "active" | "paused" | "completed" | "failed" | null;
  /** Approve & launch fleet handler */
  onApproveLaunch?: () => void;
  /** Pause running cycle handler */
  onPauseCycle?: () => void;
  /** Resume paused cycle handler */
  onResumeCycle?: () => void;
  /** Is approving & launching in progress */
  isApproving?: boolean;
  /** Is pause or resume mutating */
  isMutating?: boolean;
}

export const CycleExecutionDock: React.FC<CycleExecutionDockProps> = ({
  waves,
  budgetLimitUsd,
  tokenLimit,
  targetSlaDays,
  maxParallelMissions,
  onCommitCycle,
  isSubmitting = false,
  onAutoBalance,
  className,
  activeCycleId,
  cycleStatus,
  onApproveLaunch,
  onPauseCycle,
  onResumeCycle,
  isApproving = false,
  isMutating = false,
}) => {
  const validation = useMemo(
    () => validateWavePlan(waves, budgetLimitUsd, targetSlaDays),
    [waves, budgetLimitUsd, targetSlaDays]
  );

  const totalCost = validation.totalCostUsd;
  const criticalPathHours = validation.criticalPathHours;
  const costPct = Math.min(100, (totalCost / Math.max(1, budgetLimitUsd)) * 100);
  const slaTargetHours = targetSlaDays * 8;
  const slaPct = Math.min(100, (criticalPathHours / Math.max(1, slaTargetHours)) * 100);


  return (
    <div
      data-testid="cycle-execution-dock"
      className={cn(
        "flex items-center justify-between px-4 py-2.5 border-t border-border/70 bg-card/90 backdrop-blur-md select-none shrink-0 z-10",
        className
      )}
    >
      {/* Telemetry Meters */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {/* Cost Meter */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 font-semibold text-foreground">
            <DollarSign className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="font-mono">
              ${totalCost.toFixed(2)}
            </span>
            <span className="text-muted-foreground font-normal text-[11px]">
              / ${budgetLimitUsd.toFixed(2)}
            </span>
          </div>
          <div className="w-16 h-2 rounded-full bg-muted/60 overflow-hidden border border-border/50">
            <div
              style={{ width: `${costPct}%` }}
              className={cn(
                "h-full rounded-full transition-all",
                costPct > 90 ? "bg-rose-500" : costPct > 70 ? "bg-amber-500" : "bg-emerald-500"
              )}
            />
          </div>
        </div>

        <div className="h-4 w-px bg-border/60 hidden sm:block" />

        {/* SLA Hours Meter */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 font-semibold text-foreground">
            <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="font-mono">{criticalPathHours}h CP</span>
            <span className="text-muted-foreground font-normal text-[11px]">
              / {targetSlaDays}d SLA
            </span>
          </div>
          <div className="w-16 h-2 rounded-full bg-muted/60 overflow-hidden border border-border/50">
            <div
              style={{ width: `${slaPct}%` }}
              className={cn(
                "h-full rounded-full transition-all",
                slaPct > 100 ? "bg-rose-500" : "bg-primary"
              )}
            />
          </div>
        </div>

        <div className="h-4 w-px bg-border/60 hidden md:block" />

        {/* Token Burn Ceiling */}
        <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span>{(tokenLimit / 1000000).toFixed(1)}M Token Ceiling</span>
        </div>

        <div className="h-4 w-px bg-border/60 hidden lg:block" />

        {/* Parallelism Factor */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>Max Parallel: {maxParallelMissions}</span>
        </div>

        {/* Invariant Alert Badges */}
        {validation.hasCycle && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-destructive bg-destructive/10 border border-destructive/30 px-2 py-0.5 rounded font-semibold"
            title={validation.warnings.join(" | ")}
            data-testid="cycle-detection-warning"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Cycle Detected</span>
          </span>
        )}

        {validation.isBudgetExceeded && (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded font-semibold"
            title={`Total cost exceeds budget limit of $${budgetLimitUsd.toFixed(2)}`}
            data-testid="budget-exceeded-warning"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Over Budget</span>
          </span>
        )}

        {/* The rollups above cover only the estimated waves; say so rather than
            letting a partial critical path read as the whole plan. */}
        {validation.unestimatedWaveCount > 0 && (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/40 border border-border px-2 py-0.5 rounded font-semibold"
            title={validation.warnings.join(" | ")}
            data-testid="unestimated-waves-notice"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{validation.unestimatedWaveCount} unestimated</span>
          </span>
        )}
      </div>

      {/* Action Triggers */}
      <div className="flex items-center gap-2">
        {onAutoBalance && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5 font-medium border-border/80"
            onClick={onAutoBalance}
            title="Auto-balance waves and calculate float"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden sm:inline">Auto-Balance CPM</span>
          </Button>
        )}

        {/* Live Execution States */}
        {cycleStatus === "active" && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              data-testid="fleet-active-badge"
              className="h-8 px-2.5 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-xs"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
              <span>Fleet Active</span>
            </Badge>
            {onPauseCycle && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 font-medium border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                onClick={onPauseCycle}
                disabled={isMutating}
                data-testid="pause-cycle-btn"
              >
                {isMutating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                <span>Pause Fleet</span>
              </Button>
            )}
          </div>
        )}

        {cycleStatus === "paused" && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              data-testid="fleet-paused-badge"
              className="h-8 px-2.5 gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-xs"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
              <span>Fleet Paused</span>
            </Badge>
            {onResumeCycle && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-md"
                onClick={onResumeCycle}
                disabled={isMutating}
                data-testid="resume-cycle-btn"
              >
                {isMutating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>Resume Fleet</span>
              </Button>
            )}
          </div>
        )}

        {cycleStatus === "completed" && (
          <Badge
            variant="outline"
            data-testid="fleet-completed-badge"
            className="h-8 px-2.5 gap-1.5 border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono text-xs"
          >
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
            <span>Fleet Completed</span>
          </Badge>
        )}

        {/* When pending approval: Show Approve & Launch Fleet button */}
        {activeCycleId && cycleStatus === "pending_approval" && onApproveLaunch && (
          <Button
            size="sm"
            className="h-8 text-xs font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-md"
            onClick={onApproveLaunch}
            disabled={isApproving || isSubmitting}
            data-testid="approve-launch-fleet-btn"
            title="Approve and launch autonomous fleet execution"
          >
            {isApproving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Launching Fleet...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Approve & Launch Fleet →</span>
              </>
            )}
          </Button>
        )}

        {/* Save / Commit Plan Button */}
        {(!cycleStatus || cycleStatus === "pending_approval") && (
          <Button
            size="sm"
            variant={activeCycleId && cycleStatus === "pending_approval" ? "outline" : "default"}
            className={cn(
              "h-8 text-xs font-bold gap-1.5 shadow-md",
              activeCycleId && cycleStatus === "pending_approval"
                ? "border-border/80 text-foreground hover:bg-muted/40"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
            onClick={onCommitCycle}
            disabled={isSubmitting || waves.length === 0 || validation.hasCycle || isApproving}
            title={validation.hasCycle ? "Cannot save: circular dependency detected" : "Saves the plan as a cycle awaiting approval. Nothing runs until it is approved."}
            data-testid="commit-launch-cycle-btn"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Rocket className="w-3.5 h-3.5" />
                <span>{activeCycleId ? "Update Plan" : "Save Plan for Approval →"}</span>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
};
