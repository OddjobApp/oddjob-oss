import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { TakeoverControlBar } from "./components/TakeoverControlBar";
import { SessionSpine } from "./components/SessionSpine";
import { DesktopViewport } from "./components/DesktopViewport";
import { TaskDock } from "./components/TaskDock";
import { TeachTaskPanel } from "./components/TeachTaskPanel";
import { Button } from "@/components/ui/button";
import {
  isActiveTask,
  isUsableSession,
  type ComputerUseStudioProps,
  type ControlMode,
  type StudioSession,
  type StudioStep,
  type StudioTask,
} from "./types";

const base = "/api/integrations/trycua";

/**
 * Computer Use Studio on live data: the desktop and its tasks on the left, the desktop in
 * the middle (live noVNC when reachable, screenshots otherwise), and the selected task's
 * steps, learned skill and replay on the right.
 */
export function ConnectedComputerUseStudio({
  sessionId: initialSessionId,
  taskId: initialTaskId,
  organizationId,
  title = "Computer Use Studio",
  initialGoal = "",
  initialTeaching = false,
  onClose,
  isFocusMode,
  onToggleFocusMode,
  onControlModeChange,
  onFocusInChat,
  className,
}: ComputerUseStudioProps) {
  const cache = useQueryClient();
  const [sessionId, setSessionId] = useState(initialSessionId ?? "");
  const [taskId, setTaskId] = useState(initialTaskId ?? "");
  const [pinnedTaskId, setPinnedTaskId] = useState("");
  const [goal, setGoal] = useState(initialGoal);
  const [supervised, setSupervised] = useState(false);
  const [continueTask, setContinueTask] = useState(false);
  const [spineCollapsed, setSpineCollapsed] = useState(false);
  const [mode, setMode] = useState<ControlMode>("watch");
  const [liveConnected, setLiveConnected] = useState(false);
  const [teaching, setTeaching] = useState(initialTeaching);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (initialSessionId) setSessionId(initialSessionId);
    if (initialTaskId) setTaskId(initialTaskId);
  }, [initialSessionId, initialTaskId]);

  const sessionsKey = [base, organizationId, "studio-sessions"];
  const tasksKey = [base, organizationId, "studio-tasks"];

  const sessions = useQuery<{ sessions: StudioSession[] }>({
    queryKey: sessionsKey,
    queryFn: async () => (await apiRequest("GET", `${base}/sessions`)).json(),
    refetchInterval: 10_000,
  });
  const tasks = useQuery<{ tasks: StudioTask[] }>({
    queryKey: tasksKey,
    queryFn: async () => (await apiRequest("GET", `${base}/computer-use/tasks?limit=100`)).json(),
    refetchInterval: 3000,
    enabled: !!sessionId,
  });

  const allSessions = sessions.data?.sessions ?? [];
  const session = allSessions.find((s) => s.id === sessionId);
  const sessionTasks = tasks.data?.tasks.filter((t) => t.sessionId === sessionId) ?? [];
  const selectedTask = sessionTasks.find((t) => t.id === taskId) ?? sessionTasks[0];
  const activeTask = sessionTasks.find((t) => isActiveTask(t.status));
  // Whether the person chose this task themselves. A run that starts elsewhere
  // (from chat, or a skill test) should pull the dock onto itself, but not over
  // a task they opened deliberately to read.
  const running = sessionTasks.some((t) => isActiveTask(t.status));
  useEffect(() => {
    if (pinnedTaskId) return;
    if (activeTask && activeTask.id !== taskId) setTaskId(activeTask.id);
  }, [activeTask?.id, taskId, pinnedTaskId]);
  const usable = isUsableSession(session?.status);
  const canContinue = !!selectedTask && !isActiveTask(selectedTask.status);

  const detailKey = [`${base}/computer-use/tasks/${selectedTask?.id}`];
  const detail = useQuery<{ task: StudioTask; steps: StudioStep[] }>({
    queryKey: detailKey,
    queryFn: async () => (await apiRequest("GET", `${base}/computer-use/tasks/${selectedTask!.id}`)).json(),
    enabled: !!selectedTask?.id,
    refetchInterval: selectedTask && isActiveTask(selectedTask.status) ? 2000 : false,
  });
  // The detail is fresher than the list for the selected task.
  const task = detail.data?.task ?? selectedTask;
  const steps = detail.data?.steps ?? [];
  // The desktop is shared across sessions. Do not enable human input while any
  // known task is executing, including a task other than the selected history row.
  const executionActive = ["queued", "running"].includes(task?.status ?? "")
    || (tasks.data?.tasks ?? []).some(t => ["queued", "running"].includes(t.status));
  const canControl = usable && liveConnected && !executionActive && !tasks.isPending && !tasks.isError;
  useEffect(() => {
    if (executionActive) setMode("watch");
  }, [executionActive]);

  // The desktop is org-wide; a different session is a different context, so start watching again.
  useEffect(() => {
    setMode("watch");
    setLiveConnected(false);
  }, [sessionId]);

  const changeMode = (next: ControlMode) => {
    if (next === "control" && !canControl) return;
    setMode(next);
    onControlModeChange?.(next);
  };

  const createSession = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/sessions`, {})).json(),
    onSuccess: (data: { session: StudioSession }) => {
      cache.setQueryData<{ sessions: StudioSession[] }>(sessionsKey, (old) => ({ sessions: [data.session, ...(old?.sessions ?? [])] }));
      setSessionId(data.session.id);
      setTaskId("");
      setPinnedTaskId("");
      cache.invalidateQueries({ queryKey: sessionsKey });
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      const created: { task: StudioTask } = await (await apiRequest("POST", `${base}/computer-use/tasks`, {
        sessionId, task: goal.trim(), requireConfirmation: supervised, executeImmediately: false,
        ...(continueTask && canContinue ? { previousTaskId: selectedTask!.id } : {}),
      })).json();
      setTaskId(created.task.id);
      setPinnedTaskId("");
      cache.setQueryData<{ tasks: StudioTask[] }>(tasksKey, (old) => ({ tasks: [created.task, ...(old?.tasks ?? [])] }));
      setGoal("");
      setContinueTask(false);
      return (await apiRequest("POST", `${base}/computer-use/tasks/${created.task.id}/run`, {})).json();
    },
    onSettled: () => { cache.invalidateQueries({ queryKey: tasksKey }); },
  });

  const stop = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/computer-use/tasks/${task!.id}/cancel`, {})).json(),
    onSettled: () => {
      cache.invalidateQueries({ queryKey: tasksKey });
      cache.invalidateQueries({ queryKey: detailKey });
    },
  });

  const error = sessions.error || tasks.error || detail.error || createSession.error || run.error || stop.error;
  const canStart = usable && mode === "watch" && !recording && !executionActive && !running && !run.isPending && !tasks.isPending && !tasks.isError && !!goal.trim();

  return (
    <section data-testid="computer-use-studio" className={cn("flex h-full min-h-0 flex-col bg-background text-foreground", className)}>
      <TakeoverControlBar
        title={title}
        session={session}
        task={task}
        mode={canControl ? mode : "watch"}
        canControl={canControl}
        onModeChange={changeMode}
        onStopTask={task ? () => stop.mutate() : undefined}
        stopping={stop.isPending}
        isFocusMode={isFocusMode}
        onToggleFocusMode={onToggleFocusMode}
        onClose={onClose}
      />
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Button size="sm" variant={teaching ? "secondary" : "outline"} onClick={() => setTeaching(true)}>Teach a task</Button>
        {recording && <span role="status" className="text-sm">Recording your demonstration</span>}
      </div>
      {error && <p role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{(error as Error).message}</p>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SessionSpine
          sessions={allSessions}
          sessionsLoading={sessions.isPending}
          sessionId={sessionId}
          missingSessionId={initialSessionId && !session && !sessions.isPending ? initialSessionId : undefined}
          onSelectSession={(id) => { setSessionId(id); setTaskId(""); setPinnedTaskId(""); setContinueTask(false); }}
          onNewDesktop={() => createSession.mutate()}
          creatingDesktop={createSession.isPending}
          onRefresh={() => { sessions.refetch(); if (sessionId) tasks.refetch(); }}
          tasks={sessionTasks}
          selectedTaskId={selectedTask?.id}
          onSelectTask={(id) => { setTaskId(id); setPinnedTaskId(id); setContinueTask(false); }}
          goal={goal}
          onGoalChange={setGoal}
          supervised={supervised}
          onSupervisedChange={setSupervised}
          continueTask={continueTask}
          onContinueTaskChange={setContinueTask}
          canContinue={canContinue}
          canStart={canStart}
          starting={run.isPending}
          taskRunning={running}
          onStart={() => run.mutate()}
          isCollapsed={spineCollapsed}
          onToggleCollapse={() => setSpineCollapsed((v) => !v)}
        />

        {sessionId ? (
          <DesktopViewport
            key={`${organizationId ?? "current"}:${sessionId}`}
            sessionId={sessionId}
            organizationId={organizationId}
            task={task}
            mode={canControl ? mode : "watch"}
            liveConnected={liveConnected}
            onLiveConnected={setLiveConnected}
            onTakeControl={() => changeMode("control")}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div>
              <h3 className="font-medium">Connect a desktop to begin</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Choose an existing session or create a desktop, then describe your task. Live actions and requests for your help appear here.
              </p>
            </div>
          </div>
        )}

        {sessionId && teaching ? (
          <TeachTaskPanel key={organizationId ?? "current"} sessionId={sessionId} organizationId={organizationId}
            canRecord={canControl} busy={executionActive || run.isPending}
            onRecording={active => { setRecording(active); if (active) changeMode("control"); }}
            onTest={id => { setMode("watch"); setTaskId(id); cache.invalidateQueries({ queryKey: tasksKey }); }}
            onClose={() => setTeaching(false)} />
        ) : sessionId && (
          <TaskDock
            task={task}
            steps={steps}
            loading={detail.isPending}
            onConfirmed={() => {
              cache.invalidateQueries({ queryKey: detailKey });
              cache.invalidateQueries({ queryKey: tasksKey });
            }}
            onFocusInChat={onFocusInChat}
          />
        )}
      </div>
    </section>
  );
}
