/**
 * CycleCompactView - Phase-based compact cycle visualization
 *
 * Displays a cycle as a series of phase cards showing:
 * - Phase name/objective
 * - Completion status with color coding
 * - Progress bar (X/Y missions completed)
 * - Estimated cost and duration
 * - Interactive drill-down to see missions in each phase
 *
 * Inspired by Temporal's workflow visualization:
 * [Research ✓ 3/3] → [Execution ⏳ 1/3] → [Deploy ○ 0/2]
 */

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { colors, iconRegistry, getStatusIcon } from "@oddjob/design-system";
import { ChevronRight, Lock, AlertTriangle } from "lucide-react";
import { DrillDownPanel, useDrillDown } from "@/components/DrillDownPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type BlueprintStatus = "completed" | "running" | "paused" | "pending" | "failed" | "warning";

export interface Phase {
  waveIndex: number;
  name: string;
  objective?: string;
  blueprints: Array<{
    name: string;
    objective: string;
    status: BlueprintStatus;
    estimatedDays?: number;
    estimatedCost?: number;
    type: "mission" | "milestone" | "prediction";
    completedAt?: string;
    startedAt?: string;
    pauseAtMilestone?: boolean;
  }>;
  estimatedDays?: number;
  estimatedCost?: number;
  status: BlueprintStatus;
  onCriticalPath?: boolean;
}

interface CycleCompactViewProps {
  cycleId?: string | number;
  cycleName: string;
  cycleStatus: string;
  phases: Phase[];
  onPhaseClick?: (phase: Phase) => void;
  className?: string;
  compact?: boolean;
  showCosts?: boolean;
  interactive?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getPhaseStatusColor(status: BlueprintStatus): string {
  const colorMap: Record<BlueprintStatus, string> = {
    completed: colors.success[500],
    running: colors.accent[500],
    paused: colors.manual[500],
    warning: colors.warning[500],
    pending: colors.info[500],
    failed: colors.danger[500],
  };
  return colorMap[status];
}

function getPhaseStatusIcon(status: BlueprintStatus) {
  const iconMap: Record<BlueprintStatus, ReturnType<typeof getStatusIcon>> = {
    completed: getStatusIcon("completed"),
    running: getStatusIcon("running"),
    paused: getStatusIcon("paused"),
    warning: getStatusIcon("warning"),
    pending: getStatusIcon("pending"),
    failed: getStatusIcon("failed"),
  };
  return iconMap[status];
}

function getPhaseStatusLabel(status: BlueprintStatus): string {
  const labelMap: Record<BlueprintStatus, string> = {
    completed: "Completed",
    running: "Running",
    paused: "Paused",
    warning: "Warning",
    pending: "Pending",
    failed: "Failed",
  };
  return labelMap[status];
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface PhaseCardProps {
  phase: Phase;
  index: number;
  totalPhases: number;
  onCriticalPath?: boolean;
  onClick?: () => void;
  compact?: boolean;
  showCosts?: boolean;
}

function PhaseCard({
  phase,
  index,
  totalPhases,
  onCriticalPath,
  onClick,
  compact,
  showCosts,
}: PhaseCardProps) {
  // Calculate progress
  const completed = phase.blueprints.filter((b) => b.status === "completed").length;
  const total = phase.blueprints.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  // Get phase color
  const statusColor = getPhaseStatusColor(phase.status);
  const StatusIcon = getPhaseStatusIcon(phase.status);

  // Phase name with fallback
  const phaseName = phase.name || `Phase ${index + 1}`;

  return (
    <div className="flex items-start gap-2 flex-1 min-w-0">
      {/* Phase Card */}
      <button
        onClick={onClick}
        className={cn(
          // Base styles
          "flex-1 min-w-0 group relative",
          "rounded-lg border-2 transition-all duration-200",
          "hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",

          // Status-based styling
          phase.status === "completed"
            ? "bg-success/5 border-success/30 hover:border-success/50"
            : phase.status === "running"
              ? "bg-accent/5 border-accent/30 hover:border-accent/50"
              : phase.status === "failed"
                ? "bg-danger/5 border-danger/30 hover:border-danger/50"
                : "bg-neutral/5 border-neutral/20 hover:border-neutral/40",

          // Critical path indicator
          onCriticalPath && "ring-2 ring-accent/40"
        )}
      >
        <div className="p-3 sm:p-4 space-y-3">
          {/* Header: Phase name + status badge */}
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm sm:text-base text-foreground truncate">
                {phaseName}
              </h3>
              {!compact && phase.objective && (
                <p className="text-xs text-muted-foreground truncate mt-1">
                  {phase.objective}
                </p>
              )}
            </div>

            {/* Status Badge */}
            <div className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap" style={{ backgroundColor: `${statusColor}20`, color: statusColor }}>
              <StatusIcon className="w-3.5 h-3.5" />
              {!compact && getPhaseStatusLabel(phase.status)}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {completed}/{total} missions
              </span>
              {showCosts && phase.estimatedCost && (
                <span className="text-xs font-medium text-muted-foreground">
                  ${phase.estimatedCost.toLocaleString()}
                </span>
              )}
            </div>
            <div className="w-full h-2 bg-neutral/10 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${progress}%`,
                  backgroundColor: statusColor,
                }}
              />
            </div>
          </div>

          {/* Metadata Row */}
          {!compact && (
            <div className="flex items-center justify-between text-xs text-muted-foreground gap-2">
              {phase.estimatedDays && (
                <span>~{phase.estimatedDays}d</span>
              )}
              {onCriticalPath && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: `${colors.accent[500]}20`, color: colors.accent[500] }}>
                  ⭐ Critical
                </span>
              )}
            </div>
          )}
        </div>

        {/* Hover hint */}
        <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center justify-center">
          <div className="bg-background/80 backdrop-blur-sm rounded px-2 py-1 text-xs font-medium text-foreground">
            View missions
          </div>
        </div>
      </button>

      {/* Arrow between phases */}
      {index < totalPhases - 1 && (
        <div className="flex-shrink-0 flex items-center justify-center pt-4">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Panel Content
// ─────────────────────────────────────────────────────────────────────────────

interface PhaseMissionListProps {
  phase: Phase;
}

function PhaseMissionList({ phase }: PhaseMissionListProps) {
  return (
    <div className="space-y-3">
      {phase.blueprints.map((bp) => {
        const StatusIcon = getStatusIcon(bp.status as any);
        const statusColor = getPhaseStatusColor(bp.status);

        return (
          <div
            key={bp.name}
            className="p-3 rounded-lg border border-border/50 bg-background/40 hover:bg-background/60 transition-colors"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm text-foreground truncate flex items-center gap-2">
                  <StatusIcon className="w-4 h-4 flex-shrink-0" style={{ color: statusColor }} />
                  {bp.name}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">{bp.objective}</p>
              </div>

              {bp.type === "milestone" && (
                <Lock className="w-4 h-4 flex-shrink-0 text-warning/60" />
              )}
              {bp.pauseAtMilestone && (
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-warning/60" />
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground gap-2 pt-2 border-t border-border/30">
              {bp.type === "milestone" ? (
                <span className="px-2 py-1 rounded bg-warning/10 text-warning/70 font-medium">
                  Milestone
                </span>
              ) : (
                <span className="capitalize">{bp.type}</span>
              )}

              <div className="flex items-center gap-4">
                {bp.estimatedDays && <span>Est: ~{bp.estimatedDays}d</span>}
                {bp.estimatedCost && <span>Cost: ${bp.estimatedCost}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export const CycleCompactView = React.forwardRef<HTMLDivElement, CycleCompactViewProps>(
  (
    {
      cycleId,
      cycleName,
      cycleStatus,
      phases,
      onPhaseClick,
      className,
      compact = false,
      showCosts = true,
      interactive = true,
    },
    ref
  ) => {
    // Sort phases by wave index
    const sortedPhases = useMemo(() => {
      return [...phases].sort((a, b) => a.waveIndex - b.waveIndex);
    }, [phases]);

    // Calculate overall cycle progress
    const overallProgress = useMemo(() => {
      const allBlueprints = sortedPhases.flatMap((p) => p.blueprints);
      const completed = allBlueprints.filter((b) => b.status === "completed").length;
      return allBlueprints.length > 0 ? (completed / allBlueprints.length) * 100 : 0;
    }, [sortedPhases]);

    // Drill-down state for phase details
    const { isOpen, item: selectedPhase, open, close } = useDrillDown<Phase & { id: string }>();

    return (
      <>
        <div ref={ref} className={cn("space-y-4", className)}>
          {/* Cycle Header */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-foreground">{cycleName}</h2>
                <p className="text-xs sm:text-sm text-muted-foreground capitalize">
                  Status: {cycleStatus}
                </p>
              </div>

              {/* Cycle Progress Indicator */}
              <div className="flex-shrink-0 text-right">
                <div className="text-2xl font-black" style={{ color: getPhaseStatusColor(cycleStatus as any) }}>
                  {Math.round(overallProgress)}%
                </div>
                <p className="text-xs text-muted-foreground">Complete</p>
              </div>
            </div>

            {/* Overall Progress Bar */}
            <div className="w-full h-1.5 bg-neutral/10 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${overallProgress}%`,
                  backgroundColor: getPhaseStatusColor(cycleStatus as any),
                }}
              />
            </div>
          </div>

          {/* Phase Cards (Horizontal Flow) */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 items-stretch overflow-x-auto pb-2 -mx-2 px-2 sm:mx-0 sm:px-0">
            {sortedPhases.map((phase, index) => (
              <PhaseCard
                key={`${phase.waveIndex}-${phase.name}`}
                phase={phase}
                index={index}
                totalPhases={sortedPhases.length}
                onCriticalPath={phase.onCriticalPath}
                onClick={() => {
                  if (interactive) {
                    open({ ...phase, id: `${phase.waveIndex}-${phase.name}` });
                    onPhaseClick?.(phase);
                  }
                }}
                compact={compact}
                showCosts={showCosts}
              />
            ))}
          </div>

          {/* Summary Stats */}
          {!compact && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 pt-2 border-t border-border/30">
              <div className="p-2 sm:p-3 rounded-lg bg-background/40">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  Total Phases
                </p>
                <p className="text-2xl font-black text-foreground">{sortedPhases.length}</p>
              </div>

              <div className="p-2 sm:p-3 rounded-lg bg-background/40">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  Missions
                </p>
                <p className="text-2xl font-black text-foreground">
                  {sortedPhases.reduce((sum, p) => sum + p.blueprints.length, 0)}
                </p>
              </div>

              <div className="p-2 sm:p-3 rounded-lg bg-background/40">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  Est. Duration
                </p>
                <p className="text-2xl font-black text-foreground">
                  {Math.round(sortedPhases.reduce((sum, p) => sum + (p.estimatedDays || 0), 0))}d
                </p>
              </div>

              {showCosts && (
                <div className="p-2 sm:p-3 rounded-lg bg-background/40">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
                    Est. Cost
                  </p>
                  <p className="text-2xl font-black text-foreground">
                    ${Math.round(sortedPhases.reduce((sum, p) => sum + (p.estimatedCost || 0), 0))}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Phase Details Drill-Down Panel */}
        <DrillDownPanel
          isOpen={isOpen}
          title={selectedPhase?.name || "Phase"}
          subtitle={`${selectedPhase?.blueprints.length || 0} missions`}
          onClose={close}
          size="lg"
        >
          {selectedPhase && (
            <div className="space-y-4">
              {/* Phase Status Summary */}
              <div className="p-4 rounded-lg border border-border/50 bg-background/40 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase">Status</p>
                    <p className="text-lg font-bold mt-1" style={{ color: getPhaseStatusColor(selectedPhase.status) }}>
                      {getPhaseStatusLabel(selectedPhase.status)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase">Progress</p>
                    <p className="text-lg font-bold mt-1 text-foreground">
                      {selectedPhase.blueprints.filter((b) => b.status === "completed").length}/
                      {selectedPhase.blueprints.length}
                    </p>
                  </div>
                  {selectedPhase.estimatedDays && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase">Est. Duration</p>
                      <p className="text-lg font-bold mt-1 text-foreground">~{selectedPhase.estimatedDays}d</p>
                    </div>
                  )}
                  {selectedPhase.estimatedCost && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase">Est. Cost</p>
                      <p className="text-lg font-bold mt-1 text-foreground">
                        ${selectedPhase.estimatedCost.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Missions in Phase */}
              <div className="space-y-2">
                <h3 className="font-semibold text-sm text-foreground">Missions</h3>
                <PhaseMissionList phase={selectedPhase} />
              </div>
            </div>
          )}
        </DrillDownPanel>
      </>
    );
  }
);

CycleCompactView.displayName = "CycleCompactView";

export default CycleCompactView;
