import React from "react";
import { GitBranch, Flame, ArrowRight, ShieldCheck, Clock, Users, Bot, UserCheck, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WavePlanItem } from "../types";

export interface TopologicalDagViewProps {
  waves: WavePlanItem[];
  selectedWaveId: string | null;
  onSelectWave: (id: string) => void;
  className?: string;
}

export const TopologicalDagView: React.FC<TopologicalDagViewProps> = ({
  waves,
  selectedWaveId,
  onSelectWave,
  className,
}) => {
  return (
    <div
      data-testid="topological-dag-view"
      className={cn("flex flex-col h-full w-full bg-card/40 overflow-hidden", className)}
    >
      {/* DAG Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Topological CPM Dependency DAG
          </span>
          <Badge variant="outline" className="text-[10px] font-mono border-border/70">
            {waves.length} Nodes • Finish-to-Start Enforced
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          SMT Formal Verification Active
        </div>
      </div>

      {/* Directed Graph Canvas */}
      <div className="flex-1 overflow-auto p-8 flex flex-col items-center justify-start space-y-6">
        {waves.map((wave, index) => {
          const isSelected = wave.id === selectedWaveId;
          const isLast = index === waves.length - 1;
          const isRunning = wave.runtimeStatus === "running";
          const isDone = wave.runtimeStatus === "completed";
          const isFailed = wave.runtimeStatus === "failed";

          return (
            <React.Fragment key={wave.id}>
              {/* Node Card */}
              <div
                onClick={() => onSelectWave(wave.id)}
                className={cn(
                  "w-full max-w-xl p-4 rounded-xl border transition-all cursor-pointer relative backdrop-blur-sm",
                  isSelected
                    ? "bg-primary/10 border-primary shadow-lg ring-2 ring-primary/30"
                    : isRunning
                      ? "bg-emerald-500/5 border-emerald-500/60 ring-2 ring-emerald-500/20 shadow-emerald-500/10"
                      : "bg-card/80 border-border/70 hover:border-border hover:bg-muted/40 shadow-xs",
                  wave.isCriticalPath && !isSelected && !isRunning && "border-rose-500/50 shadow-rose-500/10"
                )}
                data-testid={`dag-node-${wave.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center font-mono font-bold text-xs",
                        isRunning
                          ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 animate-pulse"
                          : wave.isCriticalPath
                            ? "bg-rose-500/20 text-rose-500 border border-rose-500/40"
                            : "bg-primary/20 text-primary border border-primary/30"
                      )}
                    >
                      W{wave.waveNumber}
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-foreground">
                        {wave.name}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {wave.objective}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Live Runtime Status Badge */}
                    {isRunning && (
                      <Badge
                        variant="outline"
                        data-testid={`wave-runtime-${wave.id}`}
                        className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 text-[10px] px-1.5 py-0 h-5 flex items-center gap-1 font-bold"
                      >
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Running
                      </Badge>
                    )}
                    {isDone && (
                      <Badge
                        variant="outline"
                        data-testid={`wave-runtime-${wave.id}`}
                        className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px] px-1.5 py-0 h-5 flex items-center gap-1 font-bold"
                      >
                        <CheckCircle className="w-2.5 h-2.5" /> Done
                      </Badge>
                    )}
                    {isFailed && (
                      <Badge
                        variant="outline"
                        data-testid={`wave-runtime-${wave.id}`}
                        className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 text-[10px] px-1.5 py-0 h-5 flex items-center gap-1 font-bold"
                      >
                        <AlertCircle className="w-2.5 h-2.5" /> Failed
                      </Badge>
                    )}
                    {wave.runtimeStatus === "paused" && (
                      <Badge
                        variant="outline"
                        data-testid={`wave-runtime-${wave.id}`}
                        className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0 h-5 flex items-center gap-1 font-bold"
                      >
                        Paused
                      </Badge>
                    )}
                    {wave.isCriticalPath && (
                      <Badge
                        variant="outline"
                        className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 text-[10px] px-1.5 py-0 h-5 flex items-center gap-1 font-bold"
                      >
                        <Flame className="w-3 h-3" /> Critical Path
                      </Badge>
                    )}
                    {wave.governance?.requiresDualSignOff && (
                      <Badge
                        variant="outline"
                        className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px] px-1.5 py-0 h-5 flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3 h-3" /> 4-Eyes
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40 text-xs text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{wave.estimatedDurationHours} hours</span>
                    </div>
                    {typeof wave.assignee.estimatedCostUsd === "number" && (
                      <span className="font-mono">
                        ${wave.assignee.estimatedCostUsd.toFixed(2)} USD
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 font-medium">
                    {wave.assignee.type === "agent" && <Bot className="w-3.5 h-3.5 text-indigo-400" />}
                    {wave.assignee.type === "human" && <UserCheck className="w-3.5 h-3.5 text-emerald-400" />}
                    {wave.assignee.type === "hybrid" && <Users className="w-3.5 h-3.5 text-amber-400" />}
                    <span className="text-foreground">{wave.assignee.name}</span>
                  </div>
                </div>
              </div>

              {/* Dependency Connector Arrow between Nodes */}
              {!isLast && (
                <div className="flex flex-col items-center gap-1 py-1">
                  <div className="w-0.5 h-4 bg-border/70" />
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-muted/40 text-[10px] font-mono text-muted-foreground">
                    <ArrowRight className="w-3 h-3 rotate-90 text-primary" />
                    <span>Prerequisite Constraint</span>
                  </div>
                  <div className="w-0.5 h-4 bg-border/70" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
