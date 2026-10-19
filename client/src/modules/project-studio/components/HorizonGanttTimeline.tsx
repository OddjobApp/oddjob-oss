import React from "react";
import { Flame, Clock, Users, Bot, UserCheck, Plus, Minus, Calendar, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { WavePlanItem } from "../types";

/** Hours, or the fact that there are none. An unestimated wave is not a 0h wave. */
function waveHours(wave: { estimatedDurationHours: number; estimateSource?: string }): string {
  return wave.estimateSource === "unestimated" || wave.estimatedDurationHours <= 0
    ? "no estimate"
    : `${wave.estimatedDurationHours}h`;
}


export interface HorizonGanttTimelineProps {
  waves: WavePlanItem[];
  selectedWaveId: string | null;
  onSelectWave: (id: string) => void;
  onUpdateDuration?: (waveId: string, deltaHours: number) => void;
  targetSlaDays?: number;
  className?: string;
}

export const HorizonGanttTimeline: React.FC<HorizonGanttTimelineProps> = ({
  waves,
  selectedWaveId,
  onSelectWave,
  onUpdateDuration,
  targetSlaDays = 5,
  className,
}) => {
  const totalHours = Math.max(1, waves.reduce((acc, w) => acc + w.estimatedDurationHours, 0));
  const maxDays = Math.max(targetSlaDays, Math.ceil(totalHours / 8));
  const dayTicks = Array.from({ length: maxDays }, (_, i) => i + 1);

  // Calculate cumulative start hours for each wave
  let cumulative = 0;
  const positionedWaves = waves.map((w) => {
    const startHour = cumulative;
    cumulative += w.estimatedDurationHours;
    return {
      ...w,
      startHour,
      endHour: cumulative,
      startPct: Math.min(100, (startHour / (maxDays * 8)) * 100),
      widthPct: Math.min(100, Math.max(4, (w.estimatedDurationHours / (maxDays * 8)) * 100)),
    };
  });

  return (
    <div
      data-testid="horizon-gantt-timeline"
      className={cn("flex flex-col h-full w-full bg-card/40 overflow-hidden", className)}
    >
      {/* Horizon Header with Day markers */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Critical Path Horizon Gantt
          </span>
          <Badge variant="outline" className="text-[10px] font-mono border-border/70">
            SLA Horizon: {maxDays} Days ({maxDays * 8}h)
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/80 ring-1 ring-rose-500/30" />
            <span className="text-muted-foreground text-[11px]">Critical Path (Zero Float)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-primary/70 ring-1 ring-primary/30" />
            <span className="text-muted-foreground text-[11px]">Parallel Mission</span>
          </div>
        </div>
      </div>

      {/* Grid Canvas */}
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Timeline Header Track */}
        <div className="grid grid-cols-12 gap-1 border-b border-border/40 pb-2 text-[11px] font-mono text-muted-foreground">
          {dayTicks.slice(0, 12).map((d) => (
            <div key={d} className="text-center">
              Day {d}
            </div>
          ))}
        </div>

        {/* Wave Bars */}
        <div className="space-y-3 pt-2">
          {positionedWaves.map((wave) => {
            const isSelected = wave.id === selectedWaveId;
            const isRunning = wave.runtimeStatus === "running";
            const isDone = wave.runtimeStatus === "completed";
            const isFailed = wave.runtimeStatus === "failed";

            return (
              <div
                key={wave.id}
                onClick={() => onSelectWave(wave.id)}
                className={cn(
                  "p-3 rounded-xl border transition-all cursor-pointer relative",
                  isSelected
                    ? "bg-primary/10 border-primary shadow-md"
                    : isRunning
                      ? "bg-emerald-500/5 border-emerald-500/60 shadow-emerald-500/10"
                      : "bg-card/70 border-border/60 hover:border-border hover:bg-muted/30"
                )}
                data-testid={`gantt-wave-row-${wave.id}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-foreground">
                      Wave {wave.waveNumber}:
                    </span>
                    <span className="font-semibold text-foreground truncate max-w-sm">
                      {wave.name}
                    </span>
                    {isRunning && (
                      <Badge
                        variant="outline"
                        data-testid={`gantt-runtime-${wave.id}`}
                        className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 text-[10px] px-1.5 py-0 h-4.5 flex items-center gap-1 font-bold"
                      >
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Running
                      </Badge>
                    )}
                    {isDone && (
                      <Badge
                        variant="outline"
                        data-testid={`gantt-runtime-${wave.id}`}
                        className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px] px-1.5 py-0 h-4.5 flex items-center gap-1 font-bold"
                      >
                        <CheckCircle className="w-2.5 h-2.5" /> Done
                      </Badge>
                    )}
                    {isFailed && (
                      <Badge
                        variant="outline"
                        data-testid={`gantt-runtime-${wave.id}`}
                        className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 text-[10px] px-1.5 py-0 h-4.5 flex items-center gap-1 font-bold"
                      >
                        <AlertCircle className="w-2.5 h-2.5" /> Failed
                      </Badge>
                    )}
                    {wave.isCriticalPath && (
                      <Badge
                        variant="outline"
                        className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 text-[10px] px-1.5 py-0 h-4.5 flex items-center gap-1 font-bold"
                      >
                        <Flame className="w-3 h-3" /> Critical Path
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-muted-foreground font-mono text-[11px]">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground/70" />
                      <span>{waveHours(wave)}</span>
                    </div>

                    {onUpdateDuration && (
                      <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateDuration(wave.id, -4);
                          }}
                          title="Reduce 4 Hours"
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateDuration(wave.id, 4);
                          }}
                          title="Add 4 Hours"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </Button>
                      </div>
                    )}

                    <div className="flex items-center gap-1">
                      {wave.assignee.type === "agent" && <Bot className="w-3.5 h-3.5 text-indigo-400" />}
                      {wave.assignee.type === "human" && <UserCheck className="w-3.5 h-3.5 text-emerald-400" />}
                      {wave.assignee.type === "hybrid" && <Users className="w-3.5 h-3.5 text-amber-400" />}
                      <span>{wave.assignee.name}</span>
                    </div>
                  </div>
                </div>

                {/* Horizontal Gantt Progress Bar Track */}
                <div className="w-full h-7 bg-muted/40 rounded-lg overflow-hidden relative border border-border/40 flex items-center">
                  <div
                    style={{
                      marginLeft: `${wave.startPct}%`,
                      width: `${wave.widthPct}%`,
                    }}
                    className={cn(
                      "h-full rounded-md flex items-center px-2 text-[11px] font-mono font-bold transition-all relative",
                      isRunning
                        ? "bg-emerald-600/80 text-white shadow-lg shadow-emerald-500/20 border border-emerald-400/60 animate-pulse"
                        : isDone
                          ? "bg-emerald-700/80 text-white border border-emerald-500/40"
                          : isFailed
                            ? "bg-rose-600/80 text-white border border-rose-400/50"
                            : wave.isCriticalPath
                              ? "bg-gradient-to-r from-rose-500/80 to-amber-500/80 text-white shadow-lg shadow-rose-500/20 border border-rose-400/50"
                              : "bg-primary/80 text-primary-foreground border border-primary/30"
                    )}
                  >
                    <span className="truncate">W{wave.waveNumber} • {waveHours(wave)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
