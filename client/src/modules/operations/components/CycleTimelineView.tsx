/**
 * CycleTimelineView - Detailed execution timeline with CPM and real-time updates
 *
 * Shows actual execution timing and dependencies for each mission in a cycle.
 * Displays:
 * - Vertical timeline with phases
 * - Each mission with start/end times
 * - Elapsed vs. estimated duration
 * - Critical path highlighting
 * - Dependency chains
 * - Real-time progress animation
 *
 * This is the "detailed view" compared to CycleCompactView's "overview".
 */

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { colors, iconRegistry, getStatusIcon, spacing } from "@oddjob/design-system";
import { ChevronDown, Clock, AlertTriangle, CheckCircle2, Zap, Lock } from "lucide-react";
import { DrillDownPanel, useDrillDown } from "@/components/DrillDownPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type BlueprintStatus = "completed" | "running" | "paused" | "pending" | "failed" | "warning";

export interface TimelineBlueprint {
  name: string;
  objective: string;
  type: "mission" | "milestone" | "prediction";
  status: BlueprintStatus;
  startedAt?: string;
  completedAt?: string;
  estimatedDays?: number;
  estimatedCost?: number;
  actualDuration?: number; // in hours
  progress?: number; // 0-100
  cost?: number; // actual cost
  dependsOn?: string[];
  pauseAtMilestone?: boolean;
  onCriticalPath?: boolean;
}

export interface TimelinePhase {
  waveIndex: number;
  name: string;
  blueprints: TimelineBlueprint[];
}

interface CycleTimelineViewProps {
  cycleId?: string | number;
  cycleName: string;
  cycleStatus: string;
  phases: TimelinePhase[];
  startDate?: Date;
  onMissionClick?: (mission: TimelineBlueprint) => void;
  className?: string;
  showCosts?: boolean;
  interactive?: boolean;
  enableAnimation?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function getStatusColor(status: BlueprintStatus): string {
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

function getStatusLabel(status: BlueprintStatus): string {
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

function formatDuration(hours?: number): string {
  if (!hours) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = (hours / 24).toFixed(1);
  return `${days}d`;
}

function formatDate(dateString?: string): string {
  if (!dateString) return "—";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calculateVariance(actual?: number, estimated?: number): number | null {
  if (!actual || !estimated) return null;
  return ((actual - estimated) / estimated) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission Timeline Item
// ─────────────────────────────────────────────────────────────────────────────

interface MissionTimelineItemProps {
  mission: TimelineBlueprint;
  isOnCriticalPath: boolean;
  onClick?: () => void;
  showCosts?: boolean;
}

const MissionTimelineItem = React.memo(function MissionTimelineItem({
  mission,
  isOnCriticalPath,
  onClick,
  showCosts,
}: MissionTimelineItemProps) {
  const StatusIcon = getStatusIcon(mission.status as any);
  const statusColor = getStatusColor(mission.status);
  const variance = calculateVariance(mission.actualDuration, mission.estimatedDays ? mission.estimatedDays * 24 : undefined);

  return (
    <button
      onClick={onClick}
      className={cn(
        // Base styles
        "w-full text-left p-3 sm:p-4 rounded-lg border-2 transition-all duration-200",
        "hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",

        // Status-based styling
        mission.status === "completed"
          ? "bg-success/5 border-success/30 hover:border-success/50"
          : mission.status === "running"
            ? "bg-accent/5 border-accent/30 hover:border-accent/50"
            : mission.status === "failed"
              ? "bg-danger/5 border-danger/30 hover:border-danger/50"
              : "bg-neutral/5 border-neutral/20 hover:border-neutral/40",

        // Critical path indicator
        isOnCriticalPath && "ring-2 ring-accent/40"
      )}
    >
      <div className="space-y-3">
        {/* Header: Title + Status Badge */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-sm sm:text-base text-foreground truncate">
                {mission.name}
              </h4>
              {mission.type === "milestone" && (
                <Lock className="w-4 h-4 flex-shrink-0 text-warning/60" />
              )}
              {isOnCriticalPath && (
                <Zap className="w-4 h-4 flex-shrink-0 text-accent/60" />
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{mission.objective}</p>
          </div>

          {/* Status Badge */}
          <div
            className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap"
            style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
          >
            <StatusIcon className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Timeline Info */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {/* Started At */}
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground uppercase tracking-wide">Started</p>
            <p className="font-mono text-foreground">{formatDate(mission.startedAt)}</p>
          </div>

          {/* Completed At */}
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground uppercase tracking-wide">Completed</p>
            <p className="font-mono text-foreground">{formatDate(mission.completedAt)}</p>
          </div>

          {/* Duration vs Estimated */}
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground uppercase tracking-wide">Duration</p>
            <div className="flex items-center gap-1">
              <span className="font-mono text-foreground">{formatDuration(mission.actualDuration)}</span>
              {mission.estimatedDays && (
                <span className="text-muted-foreground">/ ~{mission.estimatedDays}d</span>
              )}
            </div>
          </div>

          {/* Cost or Progress */}
          {showCosts && mission.cost ? (
            <div className="space-y-1">
              <p className="font-medium text-muted-foreground uppercase tracking-wide">Cost</p>
              <p className="font-mono text-foreground">${mission.cost.toLocaleString()}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="font-medium text-muted-foreground uppercase tracking-wide">Progress</p>
              <p className="font-mono text-foreground">{mission.progress || 0}%</p>
            </div>
          )}
        </div>

        {/* Duration Variance */}
        {variance !== null && (
          <div
            className={cn(
              "p-2 rounded text-xs font-medium",
              Math.abs(variance) > 20
                ? "bg-red-500/10 text-red-600"
                : Math.abs(variance) > 10
                  ? "bg-amber-500/10 text-amber-600"
                  : "bg-emerald-500/10 text-emerald-600"
            )}
          >
            {variance > 0 ? "+" : ""}
            {variance.toFixed(0)}% vs estimate {variance > 0 ? "(running late)" : "(running early)"}
          </div>
        )}

        {/* Progress Bar (for running missions) */}
        {mission.status === "running" && mission.progress !== undefined && (
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">Progress</span>
              <span className="text-xs font-bold" style={{ color: statusColor }}>
                {mission.progress}%
              </span>
            </div>
            <div className="w-full h-2 bg-neutral/10 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${mission.progress}%`,
                  backgroundColor: statusColor,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </button>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase Section
// ─────────────────────────────────────────────────────────────────────────────

interface PhaseTimelineProps {
  phase: TimelinePhase;
  criticalPathMissions: Set<string>;
  onMissionClick?: (mission: TimelineBlueprint) => void;
  showCosts?: boolean;
  expandedPhases: Set<number>;
  onTogglePhase: (waveIndex: number) => void;
}

function PhaseTimeline({
  phase,
  criticalPathMissions,
  onMissionClick,
  showCosts,
  expandedPhases,
  onTogglePhase,
}: PhaseTimelineProps) {
  const isExpanded = expandedPhases.has(phase.waveIndex);

  // Calculate phase stats
  const phaseStatus = phase.blueprints.every((m) => m.status === "completed")
    ? "completed"
    : phase.blueprints.some((m) => m.status === "running")
      ? "running"
      : "pending";

  const statusColor = getStatusColor(phaseStatus);

  return (
    <div className="space-y-2">
      {/* Phase Header */}
      <button
        onClick={() => onTogglePhase(phase.waveIndex)}
        className={cn(
          "w-full text-left p-4 rounded-lg border-2 transition-all",
          phaseStatus === "completed"
            ? "bg-success/10 border-success/30 hover:border-success/50"
            : phaseStatus === "running"
              ? "bg-accent/10 border-accent/30 hover:border-accent/50"
              : "bg-neutral/10 border-neutral/20 hover:border-neutral/40"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base sm:text-lg text-foreground">{phase.name}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {phase.blueprints.filter((m) => m.status === "completed").length}/{phase.blueprints.length} missions
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <div
              className="px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap"
              style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
            >
              {getStatusLabel(phaseStatus)}
            </div>
            <ChevronDown
              className={cn(
                "w-5 h-5 text-muted-foreground transition-transform",
                isExpanded && "rotate-180"
              )}
            />
          </div>
        </div>
      </button>

      {/* Missions */}
      {isExpanded && (
        <div className="space-y-2 pl-2 sm:pl-4 border-l-2 border-neutral/20">
          {phase.blueprints.map((mission) => (
            <MissionTimelineItem
              key={mission.name}
              mission={mission}
              isOnCriticalPath={criticalPathMissions.has(mission.name)}
              onClick={() => onMissionClick?.(mission)}
              showCosts={showCosts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission Details Panel
// ─────────────────────────────────────────────────────────────────────────────

interface MissionDetailsProps {
  mission: TimelineBlueprint;
}

function MissionDetails({ mission }: MissionDetailsProps) {
  const variance = calculateVariance(mission.actualDuration, mission.estimatedDays ? mission.estimatedDays * 24 : undefined);

  return (
    <div className="space-y-6">
      {/* Status Summary */}
      <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border border-border/50 bg-background/40">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase">Status</p>
          <p
            className="text-lg font-bold mt-2"
            style={{ color: getStatusColor(mission.status) }}
          >
            {getStatusLabel(mission.status)}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase">Type</p>
          <p className="text-lg font-bold mt-2 capitalize">{mission.type}</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">Timeline</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-background/40 border border-border/30">
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Started At</p>
            <p className="font-mono text-sm text-foreground">
              {mission.startedAt ? formatDate(mission.startedAt) : "—"}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-background/40 border border-border/30">
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Completed At</p>
            <p className="font-mono text-sm text-foreground">
              {mission.completedAt ? formatDate(mission.completedAt) : "—"}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-background/40 border border-border/30">
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Duration</p>
            <p className="font-mono text-sm text-foreground">
              {formatDuration(mission.actualDuration)}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-background/40 border border-border/30">
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Estimated</p>
            <p className="font-mono text-sm text-foreground">
              ~{mission.estimatedDays ? `${mission.estimatedDays}d` : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Duration Variance */}
      {variance !== null && (
        <div
          className={cn(
            "p-4 rounded-lg border-2",
            Math.abs(variance) > 20
              ? "bg-red-500/5 border-red-500/20"
              : Math.abs(variance) > 10
                ? "bg-amber-500/5 border-amber-500/20"
                : "bg-emerald-500/5 border-emerald-500/20"
          )}
        >
          <p className="text-sm font-semibold mb-2">Duration Variance</p>
          <p className="text-sm text-muted-foreground">
            {variance > 0 ? "+" : ""}
            {variance.toFixed(0)}% {variance > 0 ? "slower" : "faster"} than estimated
          </p>
        </div>
      )}

      {/* Resources */}
      {mission.cost || mission.estimatedCost ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Resources</h3>
          <div className="grid grid-cols-2 gap-3">
            {mission.cost && (
              <div className="p-3 rounded-lg bg-background/40 border border-border/30">
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Actual Cost</p>
                <p className="font-mono text-sm text-foreground">${mission.cost.toLocaleString()}</p>
              </div>
            )}

            {mission.estimatedCost && (
              <div className="p-3 rounded-lg bg-background/40 border border-border/30">
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Estimated Cost</p>
                <p className="font-mono text-sm text-foreground">${mission.estimatedCost.toLocaleString()}</p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Dependencies */}
      {mission.dependsOn && mission.dependsOn.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Dependencies</h3>
          <div className="space-y-2">
            {mission.dependsOn.map((dep) => (
              <div key={dep} className="p-2 rounded-lg bg-background/40 border border-border/30 text-xs">
                <p className="text-muted-foreground">Depends on:</p>
                <p className="font-medium text-foreground">{dep}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export const CycleTimelineView = React.forwardRef<HTMLDivElement, CycleTimelineViewProps>(
  (
    {
      cycleId,
      cycleName,
      cycleStatus,
      phases,
      startDate,
      onMissionClick,
      className,
      showCosts = true,
      interactive = true,
      enableAnimation = true,
    },
    ref
  ) => {
    const [expandedPhases, setExpandedPhases] = useState<Set<number>>(
      new Set(phases.map((p) => p.waveIndex))
    );

    // Extract critical path missions
    const criticalPathMissions = useMemo(() => {
      return new Set(
        phases
          .flatMap((p) => p.blueprints)
          .filter((m) => m.onCriticalPath)
          .map((m) => m.name)
      );
    }, [phases]);

    // Calculate overall stats
    const stats = useMemo(() => {
      const allMissions = phases.flatMap((p) => p.blueprints);
      const completed = allMissions.filter((m) => m.status === "completed").length;
      const totalDuration = allMissions.reduce((sum, m) => sum + (m.actualDuration || 0), 0);
      const totalCost = allMissions.reduce((sum, m) => sum + (m.cost || 0), 0);

      return {
        completed,
        total: allMissions.length,
        percentage: allMissions.length > 0 ? (completed / allMissions.length) * 100 : 0,
        totalDuration,
        totalCost,
      };
    }, [phases]);

    const togglePhase = (waveIndex: number) => {
      const newExpanded = new Set(expandedPhases);
      if (newExpanded.has(waveIndex)) {
        newExpanded.delete(waveIndex);
      } else {
        newExpanded.add(waveIndex);
      }
      setExpandedPhases(newExpanded);
    };

    // Drill-down state
    const { isOpen, item: selectedMission, open, close } = useDrillDown<TimelineBlueprint & { id: string }>();

    return (
      <>
        <div ref={ref} className={cn("space-y-6", className)}>
          {/* Header */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-foreground">{cycleName}</h2>
                <p className="text-xs sm:text-sm text-muted-foreground capitalize">
                  Timeline View — Detailed Execution
                </p>
              </div>

              {/* Overall Progress */}
              <div className="flex-shrink-0 text-right">
                <div
                  className="text-2xl font-black"
                  style={{ color: getStatusColor(cycleStatus as any) }}
                >
                  {Math.round(stats.percentage)}%
                </div>
                <p className="text-xs text-muted-foreground">Complete</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2 bg-neutral/10 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all rounded-full",
                  enableAnimation ? "duration-500" : "duration-0"
                )}
                style={{
                  width: `${stats.percentage}%`,
                  backgroundColor: getStatusColor(cycleStatus as any),
                }}
              />
            </div>

            {/* Timeline Header Info */}
            {startDate && (
              <div className="text-xs text-muted-foreground">
                Started: {startDate.toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            )}
          </div>

          {/* Timeline Phases */}
          <div className="space-y-4">
            {phases.map((phase) => (
              <PhaseTimeline
                key={phase.waveIndex}
                phase={phase}
                criticalPathMissions={criticalPathMissions}
                onMissionClick={(mission) => {
                  if (interactive) {
                    open({ ...mission, id: mission.name });
                    onMissionClick?.(mission);
                  }
                }}
                showCosts={showCosts}
                expandedPhases={expandedPhases}
                onTogglePhase={togglePhase}
              />
            ))}
          </div>

          {/* Summary Statistics */}
          <div className="pt-4 border-t border-border/30">
            <h3 className="font-semibold text-sm mb-3">Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-background/40">
                <p className="text-xs font-medium text-muted-foreground uppercase">Completed</p>
                <p className="text-2xl font-black text-foreground mt-1">{stats.completed}</p>
                <p className="text-xs text-muted-foreground">of {stats.total}</p>
              </div>

              <div className="p-3 rounded-lg bg-background/40">
                <p className="text-xs font-medium text-muted-foreground uppercase">Duration</p>
                <p className="text-2xl font-black text-foreground mt-1">
                  {formatDuration(stats.totalDuration)}
                </p>
              </div>

              {showCosts && (
                <div className="p-3 rounded-lg bg-background/40">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Total Cost</p>
                  <p className="text-2xl font-black text-foreground mt-1">
                    ${stats.totalCost.toLocaleString()}
                  </p>
                </div>
              )}

              <div className="p-3 rounded-lg bg-background/40">
                <p className="text-xs font-medium text-muted-foreground uppercase">Critical Path</p>
                <p className="text-2xl font-black text-foreground mt-1">
                  {criticalPathMissions.size}
                </p>
                <p className="text-xs text-muted-foreground">missions</p>
              </div>
            </div>
          </div>
        </div>

        {/* Mission Details Drill-Down */}
        <DrillDownPanel
          isOpen={isOpen}
          title={selectedMission?.name || "Mission"}
          subtitle={selectedMission?.objective}
          onClose={close}
          size="lg"
        >
          {selectedMission && <MissionDetails mission={selectedMission} />}
        </DrillDownPanel>
      </>
    );
  }
);

CycleTimelineView.displayName = "CycleTimelineView";

export default CycleTimelineView;
