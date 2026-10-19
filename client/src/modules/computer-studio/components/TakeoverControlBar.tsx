import React from "react";
import { Eye, Hand, Maximize2, Minimize2, Monitor, Square, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ControlMode, StudioSession, StudioTask } from "../types";

interface TakeoverControlBarProps {
  title: string;
  session?: StudioSession;
  task?: StudioTask;
  mode: ControlMode;
  /** False until a live desktop is connected: there is nothing to take control of. */
  canControl: boolean;
  onModeChange: (mode: ControlMode) => void;
  onStopTask?: () => void;
  stopping?: boolean;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
}

function statusTone(status?: string) {
  if (!status) return "text-muted-foreground";
  if (status === "needs_confirmation") return "border-amber-500/40 text-amber-700 dark:text-amber-300";
  if (["running", "queued", "ready", "active"].includes(status)) return "border-emerald-500/40 text-emerald-700 dark:text-emerald-300";
  if (["failed", "blocked", "error"].includes(status)) return "border-destructive/40 text-destructive";
  return "text-muted-foreground";
}

/** Studio header: what is running, who has the controls, and the stop button. */
export function TakeoverControlBar({
  title, session, task, mode, canControl, onModeChange, onStopTask, stopping, isFocusMode, onToggleFocusMode, onClose,
}: TakeoverControlBarProps) {
  const taskStatus = task?.status;
  const taskActive = !!taskStatus && ["queued", "running", "needs_confirmation"].includes(taskStatus);

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5" data-testid="studio-control-bar">
      <div className="flex min-w-0 items-center gap-2">
        <Monitor className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="truncate font-semibold">{title}</h2>
        {session && (
          <Badge variant="outline" className={cn("text-[10px] uppercase", statusTone(session.status))}>
            Desktop {session.status}
          </Badge>
        )}
        {taskStatus && (
          <Badge variant="outline" className={cn("text-[10px] uppercase", statusTone(taskStatus))} data-testid="task-status-badge">
            Task {taskStatus.replaceAll("_", " ")}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Who controls the desktop" className="flex rounded-md border border-border p-0.5">
          <Button
            size="sm"
            variant={mode === "watch" ? "secondary" : "ghost"}
            className="h-7 gap-1.5 px-2.5 text-xs"
            aria-pressed={mode === "watch"}
            onClick={() => onModeChange("watch")}
            data-testid="mode-watch-btn"
          >
            <Eye className="h-3.5 w-3.5" /> Watch
          </Button>
          <Button
            size="sm"
            variant={mode === "control" ? "secondary" : "ghost"}
            className="h-7 gap-1.5 px-2.5 text-xs"
            aria-pressed={mode === "control"}
            disabled={!canControl}
            title={canControl ? "Use your keyboard and mouse on the desktop" : "Connect the desktop and wait for the agent to pause or stop before taking control"}
            onClick={() => onModeChange("control")}
            data-testid="mode-control-btn"
          >
            <Hand className="h-3.5 w-3.5" /> Take control
          </Button>
        </div>
        {taskActive && onStopTask && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-destructive/40 text-destructive" onClick={onStopTask} disabled={stopping} data-testid="stop-task-btn">
            <Square className="h-3.5 w-3.5" /> {stopping ? "Stopping…" : "Stop task"}
          </Button>
        )}
        {onToggleFocusMode && (
          <Button size="sm" variant="outline" className="h-8" onClick={onToggleFocusMode}>
            {isFocusMode ? <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> : <Maximize2 className="mr-1.5 h-3.5 w-3.5" />}
            {isFocusMode ? "Show chat" : "Focus studio"}
          </Button>
        )}
        {onClose && (
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Close Computer Use Studio" data-testid="studio-exit-btn" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
