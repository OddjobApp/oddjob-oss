import React, { useState } from "react";
import { 
  FileText, 
  CheckCircle2, 
  Circle, 
  Plus, 
  Trash2, 
  Sparkles, 
  MessageSquare, 
  ShieldCheck, 
  Flame, 
  Boxes,
  Clock,
  ExternalLink,
  User,
  Bot,
  RefreshCw,
  CheckCircle,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { WavePlanItem, WaveTaskItem, StudioDeliverableTarget } from "../types";

export interface WaveLivingCanvasProps {
  wave: WavePlanItem | null;
  onUpdateWave: (updatedWave: WavePlanItem) => void;
  onDiscussWithCrew?: (selection: { waveId: string; waveTitle: string; objective: string }, suggestion?: string) => void;
  onNavigateStudio?: (studio: StudioDeliverableTarget, context?: { waveId: string; title: string }) => void;
  className?: string;
}

export const WaveLivingCanvas: React.FC<WaveLivingCanvasProps> = ({
  wave,
  onUpdateWave,
  onDiscussWithCrew,
  onNavigateStudio,
  className,
}) => {
  const [newCriteria, setNewCriteria] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");

  if (!wave) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground font-mono text-xs">
        Select a wave station from the left spine to view its living canvas.
      </div>
    );
  }

  const handleToggleTask = (taskId: string) => {
    const updatedTasks = (wave.tasks || []).map((t) =>
      t.id === taskId ? { ...t, isComplete: !t.isComplete } : t
    );
    onUpdateWave({ ...wave, tasks: updatedTasks });
  };

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;
    const newTask: WaveTaskItem = {
      id: `task-${Date.now()}`,
      title: newTaskTitle.trim(),
      isComplete: false,
      estimatedHours: 4,
    };
    onUpdateWave({ ...wave, tasks: [...(wave.tasks || []), newTask] });
    setNewTaskTitle("");
  };

  const handleDeleteTask = (taskId: string) => {
    const updatedTasks = (wave.tasks || []).filter((t) => t.id !== taskId);
    onUpdateWave({ ...wave, tasks: updatedTasks });
  };

  const handleAddCriteria = () => {
    if (!newCriteria.trim()) return;
    const updated = [...(wave.acceptanceCriteria || []), newCriteria.trim()];
    onUpdateWave({ ...wave, acceptanceCriteria: updated });
    setNewCriteria("");
  };

  const handleDeleteCriteria = (index: number) => {
    const updated = (wave.acceptanceCriteria || []).filter((_, i) => i !== index);
    onUpdateWave({ ...wave, acceptanceCriteria: updated });
  };

  return (
    <div
      data-testid="wave-living-canvas"
      className={cn("flex flex-col h-full w-full bg-card/50 overflow-y-auto p-6 space-y-6", className)}
    >
      {/* Wave Station Header Card */}
      <div className="p-5 rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-mono font-bold text-sm">
              W{wave.waveNumber}
            </span>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono">
                Station Spec & Contract
              </span>
              <Input
                value={wave.name}
                onChange={(e) => onUpdateWave({ ...wave, name: e.target.value })}
                className="text-base font-bold text-foreground h-8 px-2 bg-transparent border-transparent hover:border-border/60 focus:border-primary"
              />
              {/* Hybrid Squad summary chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <User className="w-3 h-3 text-primary" /> {wave.assignee.name}
                </span>
                <span className="text-muted-foreground/60">•</span>
                <span className="text-muted-foreground">{wave.assignee.role}</span>
                {wave.squad?.reviewers?.map((r, i) => (
                  <React.Fragment key={`rev-${i}`}>
                    <span className="text-muted-foreground/60">•</span>
                    <span className="text-indigo-400 font-medium">Critic: {r.name}</span>
                  </React.Fragment>
                ))}
                {wave.squad?.sentinels?.map((s, i) => (
                  <React.Fragment key={`sent-${i}`}>
                    <span className="text-muted-foreground/60">•</span>
                    <span className="text-emerald-500 font-medium">Sentinel: {s.name}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Live Runtime Status Badge */}
            {wave.runtimeStatus === "running" && (
              <Badge
                variant="outline"
                data-testid={`canvas-runtime-${wave.id}`}
                className="h-8 px-2.5 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-xs font-bold"
              >
                <RefreshCw className="w-3 h-3 animate-spin" /> Running
              </Badge>
            )}
            {wave.runtimeStatus === "completed" && (
              <Badge
                variant="outline"
                data-testid={`canvas-runtime-${wave.id}`}
                className="h-8 px-2.5 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-mono text-xs font-bold"
              >
                <CheckCircle className="w-3 h-3" /> Done
              </Badge>
            )}
            {wave.runtimeStatus === "failed" && (
              <Badge
                variant="outline"
                data-testid={`canvas-runtime-${wave.id}`}
                className="h-8 px-2.5 gap-1.5 border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-mono text-xs font-bold"
              >
                <AlertCircle className="w-3 h-3" /> Failed
              </Badge>
            )}

            {/* Studio Target deliverable launcher */}
            {wave.studioTarget && wave.studioTarget !== "none" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                onClick={() => onNavigateStudio?.(wave.studioTarget!, { waveId: wave.id, title: wave.name })}
                data-testid="open-studio-target-btn"
                title={`Open deliverable in ${wave.studioTarget} studio`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="capitalize">{wave.studioTarget.replace("_", " ")} Studio ↗</span>
              </Button>
            )}

            {onDiscussWithCrew && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
                onClick={() =>
                  onDiscussWithCrew(
                    { waveId: wave.id, waveTitle: wave.name, objective: wave.objective },
                    `Let's refine Wave ${wave.waveNumber} ("${wave.name}"). What are the potential architectural risks or alternative dependencies?`
                  )
                }
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Discuss with Crew</span>
              </Button>
            )}

            {wave.isCriticalPath && (
              <Badge
                variant="outline"
                className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 text-xs px-2 py-0.5 font-bold flex items-center gap-1"
              >
                <Flame className="w-3 h-3" /> Critical Path
              </Badge>
            )}
          </div>
        </div>

        {/* Objective Section */}
        <div className="space-y-1.5 pt-2">
          <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-primary" />
            <span>Mission Objective & Scope Statement</span>
          </label>
          <Textarea
            value={wave.objective}
            onChange={(e) => onUpdateWave({ ...wave, objective: e.target.value })}
            rows={3}
            className="text-xs text-foreground bg-background/60 border-border/80 resize-none focus:border-primary"
            placeholder="Define the scope and outcomes for this operational wave..."
          />
        </div>
      </div>

      {/* Deliverable Blueprint Contract */}
      <div className="p-5 rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-indigo-400" />
            <span>Deliverable Blueprint & Artifact Output Contract</span>
          </label>
          <Badge variant="outline" className="text-[10px] font-mono border-border/60">
            Postgres Relational Blueprint
          </Badge>
        </div>
        <Input
          value={wave.deliverableBlueprint || ""}
          onChange={(e) => onUpdateWave({ ...wave, deliverableBlueprint: e.target.value })}
          placeholder="e.g. Scribe PRD v1, OpenAPI 3.1 Schema, Canary Test Suite, Production DB Migration"
          className="text-xs bg-background/60 border-border/80"
        />
      </div>

      {/* Acceptance Criteria Checklist */}
      <div className="p-5 rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>Acceptance Criteria & Verification Conditions</span>
          </label>
          <Badge variant="outline" className="text-[10px] font-mono border-border/60">
            {(wave.acceptanceCriteria || []).length} Invariants
          </Badge>
        </div>

        <div className="space-y-2">
          {(wave.acceptanceCriteria || []).map((criteria, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-2 p-2 rounded-lg bg-background/40 border border-border/60 text-xs"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="text-foreground">{criteria}</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDeleteCriteria(idx)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newCriteria}
              onChange={(e) => setNewCriteria(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCriteria();
                }
              }}
              placeholder="Add verifiable acceptance criteria..."
              className="text-xs bg-background/60 border-border/80 h-8"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs shrink-0"
              onClick={handleAddCriteria}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>
        </div>
      </div>

      {/* Decomposed Tasks List */}
      <div className="p-5 rounded-2xl border border-border/80 bg-card/80 backdrop-blur-md shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-primary" />
            <span>Decomposed Station Tasks</span>
          </label>
          <Badge variant="outline" className="text-[10px] font-mono border-border/60">
            {(wave.tasks || []).filter((t) => t.isComplete).length}/{(wave.tasks || []).length} Completed
          </Badge>
        </div>

        <div className="space-y-2">
          {(wave.tasks || []).map((task) => (
            <div
              key={task.id}
              onClick={() => handleToggleTask(task.id)}
              className={cn(
                "flex items-center justify-between gap-2 p-2.5 rounded-lg border text-xs cursor-pointer transition-all",
                task.isComplete
                  ? "bg-muted/30 border-border/50 text-muted-foreground line-through"
                  : "bg-background/60 border-border/80 text-foreground hover:bg-muted/40"
              )}
            >
              <div className="flex items-center gap-2.5">
                {task.isComplete ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <span className="font-medium">{task.title}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground">
                  {task.estimatedHours}h
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteTask(task.id);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTask();
                }
              }}
              placeholder="Add sub-task..."
              className="text-xs bg-background/60 border-border/80 h-8"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs shrink-0"
              onClick={handleAddTask}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Task
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
