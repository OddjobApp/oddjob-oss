import React from "react";
import { ChevronLeft, ChevronRight, Monitor, Plus, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { StudioSession, StudioTask } from "../types";

interface SessionSpineProps {
  sessions: StudioSession[];
  sessionsLoading: boolean;
  sessionId: string;
  /** An id passed in (from chat or a notification) that is not in the list. */
  missingSessionId?: string;
  onSelectSession: (id: string) => void;
  onNewDesktop: () => void;
  creatingDesktop: boolean;
  onRefresh: () => void;

  tasks: StudioTask[];
  selectedTaskId?: string;
  onSelectTask: (id: string) => void;

  goal: string;
  onGoalChange: (goal: string) => void;
  supervised: boolean;
  onSupervisedChange: (value: boolean) => void;
  continueTask: boolean;
  onContinueTaskChange: (value: boolean) => void;
  canContinue: boolean;
  canStart: boolean;
  starting: boolean;
  taskRunning: boolean;
  onStart: () => void;

  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const taskStatusDot: Record<string, string> = {
  succeeded: "bg-emerald-500",
  running: "bg-sky-500 animate-pulse",
  queued: "bg-sky-500",
  needs_confirmation: "bg-amber-500 animate-pulse",
  failed: "bg-destructive",
  blocked: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

/** Left track: the desktop, a new task, and this desktop's task history. */
export function SessionSpine(props: SessionSpineProps) {
  const { sessions, sessionId, isCollapsed, onToggleCollapse } = props;
  const session = sessions.find((s) => s.id === sessionId);

  if (isCollapsed) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-3 border-r border-border py-3" data-testid="session-spine-collapsed">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onToggleCollapse} aria-label="Expand session panel" data-testid="spine-expand-btn">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Server className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border" data-testid="session-spine">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Desktop &amp; tasks</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onToggleCollapse} aria-label="Collapse session panel" data-testid="spine-collapse-btn">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        <section className="space-y-2">
          <label className="block text-xs font-medium">
            Desktop session
            <select
              aria-label="Desktop session"
              className="mt-1 block w-full rounded-md border border-input bg-background p-2 text-sm"
              value={sessionId}
              disabled={props.starting}
              onChange={(e) => props.onSelectSession(e.target.value)}
            >
              <option value="">{props.sessionsLoading ? "Loading sessions…" : "Select a desktop"}</option>
              {props.missingSessionId && <option value={props.missingSessionId}>{props.missingSessionId}: unavailable</option>}
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.os} · {s.status} · {s.id}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={props.onNewDesktop} disabled={props.creatingDesktop || props.starting}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />{props.creatingDesktop ? "Creating desktop…" : "New desktop"}
            </Button>
            <Button size="sm" variant="ghost" aria-label="Refresh sessions and tasks" onClick={props.onRefresh}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {session && (
            <dl className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-md border border-border bg-muted/30 p-2 text-xs" data-testid="session-facts">
              <dt className="text-muted-foreground">System</dt><dd className="text-right">{session.os}</dd>
              {session.provider && <><dt className="text-muted-foreground">Provider</dt><dd className="text-right">{session.provider}</dd></>}
              {typeof session.actionCount === "number" && <><dt className="text-muted-foreground">Actions run</dt><dd className="text-right">{session.actionCount}</dd></>}
              {session.expiresAt && <><dt className="text-muted-foreground">Expires</dt><dd className="text-right">{new Date(session.expiresAt).toLocaleTimeString()}</dd></>}
            </dl>
          )}
        </section>

        {sessionId && (
          <form
            className="space-y-2 rounded-md border border-border bg-card p-3"
            onSubmit={(e) => { e.preventDefault(); if (props.canStart) props.onStart(); }}
          >
            <label htmlFor="computer-task-goal" className="text-xs font-medium">What should the computer do?</label>
            <Textarea
              id="computer-task-goal"
              value={props.goal}
              onChange={(e) => props.onGoalChange(e.target.value)}
              placeholder="For example, open the dashboard and summarize this week's reports"
              disabled={props.starting}
              rows={3}
            />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={props.supervised} onChange={(e) => props.onSupervisedChange(e.target.checked)} />
              Approve each action
            </label>
            {props.canContinue && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={props.continueTask} onChange={(e) => props.onContinueTaskChange(e.target.checked)} />
                Continue the selected task with its previous context
              </label>
            )}
            <Button type="submit" size="sm" className="w-full" disabled={!props.canStart}>
              {props.starting ? "Task in progress…" : "Start task"}
            </Button>
            {props.taskRunning && (
              <p role="status" className="text-xs text-muted-foreground">A task is active on this desktop. Complete or stop it before starting another.</p>
            )}
          </form>
        )}

        {props.tasks.length > 0 && (
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Task history</h3>
            <ul className="space-y-1" aria-label="Task history">
              {props.tasks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => props.onSelectTask(t.id)}
                    aria-current={t.id === props.selectedTaskId}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors",
                      t.id === props.selectedTaskId ? "border-primary/50 bg-primary/5" : "border-transparent hover:border-border",
                    )}
                  >
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", taskStatusDot[t.status] ?? "bg-muted-foreground")} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="line-clamp-2">{t.task}</span>
                      <span className="text-muted-foreground">{t.status.replaceAll("_", " ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!sessionId && (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            <Monitor className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
            Choose a desktop or create one, then describe the task.
          </div>
        )}
      </div>
    </aside>
  );
}
