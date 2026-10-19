import React from "react";
import { 
  Layers, 
  Plus, 
  ChevronLeft, 
  ChevronRight, 
  Flame, 
  Bot, 
  UserCheck, 
  Users, 
  Clock, 
  Trash2,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WavePlanItem } from "../types";

export interface WaveSequenceSpineProps {
  waves: WavePlanItem[];
  selectedWaveId: string | null;
  onSelectWave: (waveId: string) => void;
  onAddWave: () => void;
  onDeleteWave: (waveId: string) => void;
  onMoveWave?: (waveId: string, direction: "up" | "down") => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  className?: string;
}

export const WaveSequenceSpine: React.FC<WaveSequenceSpineProps> = ({
  waves,
  selectedWaveId,
  onSelectWave,
  onAddWave,
  onDeleteWave,
  onMoveWave,
  isCollapsed,
  onToggleCollapse,
  className,
}) => {
  return (
    <div
      data-testid="wave-sequence-spine"
      className={cn(
        "flex flex-col h-full border-r border-border/70 bg-card/60 transition-all select-none overflow-hidden",
        isCollapsed ? "w-12 items-center" : "w-64 min-w-[16rem]",
        className
      )}
    >
      {/* Spine Header */}
      <div className="flex items-center justify-between p-2.5 border-b border-border/60 bg-muted/20">
        {!isCollapsed ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-foreground truncate">
              Sequence Spine
            </span>
            <Badge variant="outline" className="text-[9px] font-mono px-1 py-0 h-4 border-border/70">
              {waves.length}
            </Badge>
          </div>
        ) : (
          <span title="Sequence Spine" className="flex items-center justify-center text-primary">
            <Layers className="w-4 h-4" />
          </span>
        )}

        <div className="flex items-center gap-1">
          {!isCollapsed && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={onAddWave}
              title="Add Wave Station"
              data-testid="spine-add-wave-btn"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onToggleCollapse}
            title={isCollapsed ? "Expand Outline" : "Collapse Outline"}
            data-testid="spine-collapse-btn"
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* Station List / Track */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {waves.map((wave, idx) => {
          const isSelected = wave.id === selectedWaveId;
          const isFirst = idx === 0;
          const isLast = idx === waves.length - 1;

          if (isCollapsed) {
            return (
              <button
                key={wave.id}
                type="button"
                onClick={() => onSelectWave(wave.id)}
                title={`Wave ${wave.waveNumber}: ${wave.name}`}
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold transition-all relative",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40"
                    : "bg-muted/60 text-foreground hover:bg-muted"
                )}
              >
                W{wave.waveNumber}
                {wave.isCriticalPath && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-1 ring-card" />
                )}
              </button>
            );
          }

          return (
            <div
              key={wave.id}
              onClick={() => onSelectWave(wave.id)}
              className={cn(
                "group relative flex flex-col p-2.5 rounded-lg border text-left cursor-pointer transition-all",
                isSelected
                  ? "bg-primary/10 border-primary/50 shadow-xs"
                  : "bg-card/40 border-border/60 hover:bg-muted/40 hover:border-border"
              )}
              data-testid={`spine-wave-station-${wave.id}`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={cn(
                      "w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono font-bold shrink-0",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    W{wave.waveNumber}
                  </span>
                  <span className="text-xs font-semibold text-foreground truncate">
                    {wave.name}
                  </span>
                </div>

                {wave.isCriticalPath && (
                  <Badge
                    variant="outline"
                    className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 text-[9px] px-1 py-0 h-4 flex items-center gap-0.5 shrink-0"
                  >
                    <Flame className="w-2.5 h-2.5" /> CP
                  </Badge>
                )}
              </div>

              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                {wave.objective}
              </p>

              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-muted-foreground/70" />
                  <span>{wave.estimatedDurationHours}h</span>
                </div>

                <div className="flex items-center gap-1">
                  {wave.assignee.type === "agent" && (
                    <Bot className="w-3 h-3 text-indigo-500 dark:text-indigo-400" />
                  )}
                  {wave.assignee.type === "human" && (
                    <UserCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {wave.assignee.type === "hybrid" && (
                    <Users className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  )}
                  <span className="truncate max-w-[80px]">{wave.assignee.role || wave.assignee.name}</span>
                </div>

                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                  {onMoveWave && !isFirst && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveWave(wave.id, "up");
                      }}
                      title="Move Up"
                    >
                      <ArrowUp className="w-2.5 h-2.5" />
                    </Button>
                  )}
                  {onMoveWave && !isLast && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveWave(wave.id, "down");
                      }}
                      title="Move Down"
                    >
                      <ArrowDown className="w-2.5 h-2.5" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 p-0 text-destructive/80 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWave(wave.id);
                    }}
                    title="Delete Station"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
