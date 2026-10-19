import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, ListOrdered, MessageSquare, PlayCircle, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmationPanel } from "@/modules/agents/components/ComputerUseLiveViewer";
import { ComputerUseReplay } from "@/modules/agents/components/ComputerUseReplay";
import { describeStep, DRAFTING_GRACE_MS, skillUsed, takeoverRecording, type StepTone } from "../steps";
import type { ComputerUseStudioProps, StudioSkill, StudioStep, StudioTask } from "../types";
import { SkillOutputs } from "./TeachTaskPanel";

type DockTab = "steps" | "skill" | "replay";

const toneClass: Record<StepTone, string> = {
  neutral: "border-border",
  success: "border-emerald-500/40",
  attention: "border-amber-500/50 bg-amber-500/5",
  danger: "border-destructive/40 bg-destructive/5",
  skill: "border-violet-500/40 bg-violet-500/5",
  human: "border-sky-500/40 bg-sky-500/5",
};

interface TaskDockProps {
  task?: StudioTask;
  steps: StudioStep[];
  loading: boolean;
  onConfirmed: () => void;
  onFocusInChat?: ComputerUseStudioProps["onFocusInChat"];
}

/** Right track: what the task did, which learned skill it used or produced, and its replay. */
export function TaskDock({ task, steps, loading, onConfirmed, onFocusInChat }: TaskDockProps) {
  const [tab, setTab] = useState<DockTab>("steps");
  const tabs: Array<{ id: DockTab; label: string; icon: React.ReactNode }> = [
    { id: "steps", label: "Steps", icon: <ListOrdered className="h-3.5 w-3.5" /> },
    { id: "skill", label: "Skill", icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: "replay", label: "Replay", icon: <PlayCircle className="h-3.5 w-3.5" /> },
  ];

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border" data-testid="task-dock">
      <div role="tablist" aria-label="Task details" className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            data-testid={`dock-tab-${t.id}`}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium",
              tab === t.id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3" role="tabpanel">
        {!task ? (
          <p className="text-sm text-muted-foreground">Start a task, or pick one from the history, to see what it did.</p>
        ) : tab === "steps" ? (
          <StepsTab task={task} steps={steps} loading={loading} onConfirmed={onConfirmed} onFocusInChat={onFocusInChat} />
        ) : tab === "skill" ? (
          <SkillTab task={task} steps={steps} />
        ) : (
          <ComputerUseReplay taskId={task.id} />
        )}
      </div>
    </aside>
  );
}

function StepsTab({ task, steps, loading, onConfirmed, onFocusInChat }: Omit<TaskDockProps, "task"> & { task: StudioTask }) {
  const saveAsSkill = useMutation<{ skill: StudioSkill; skipped?: Array<{ action: string; reason: string }> }>({
    mutationFn: async () => (await apiRequest("POST", `/api/integrations/trycua/computer-use/tasks/${task.id}/save-as-skill`, {})).json(),
  });
  const skipped = saveAsSkill.data?.skipped ?? [];

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{task.task}</p>
        {typeof task.result?.summary === "string" && <p className="text-sm text-muted-foreground">{task.result.summary}</p>}
        {task.error && <p role="alert" className="text-sm text-destructive">{task.error}</p>}
      </div>

      {steps.length > 0 && (
        <div className="flex items-center justify-between border-y border-border py-1.5">
          <span className="text-xs text-muted-foreground">{steps.length} step{steps.length === 1 ? "" : "s"} recorded</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[11px]"
            disabled={saveAsSkill.isPending || saveAsSkill.isSuccess}
            onClick={() => saveAsSkill.mutate()}
          >
            <Sparkles className="h-3 w-3" />
            {saveAsSkill.isPending ? "Synthesizing…" : saveAsSkill.isSuccess ? "Skill Saved (Draft)" : "Save as Skill"}
          </Button>
        </div>
      )}
      {saveAsSkill.error && <p role="alert" className="text-xs text-destructive">{(saveAsSkill.error as Error).message}</p>}
      {/* A draft shorter than the run says so. Screen-coordinate clicks and
          window hotkeys have no page element, so they cannot be replayed. */}
      {skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {skipped.length} action{skipped.length === 1 ? "" : "s"} left out of the draft:{" "}
          {[...new Set(skipped.map((s) => s.reason))].join("; ")}
        </p>
      )}

      {task.status === "needs_confirmation" && (
        task.result?.pending?.kind === "governance"
          ? <ResumeLegacyRun task={task} onStarted={onConfirmed} />
          : <ConfirmationPanel key={`${task.id}:${steps.length}`} task={{ task: task as any, steps }} onConfirm={onConfirmed} />
      )}

      {loading && steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">Loading steps…</p>
      ) : steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No steps recorded yet.</p>
      ) : (
        <ol className="space-y-1.5" aria-label="Task steps">
          {steps.map((step) => {
            const described = describeStep(step);
            return (
              <li key={step.id} className={cn("rounded-md border p-2 text-xs", toneClass[described.tone])}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">
                    <span className="mr-1.5 text-muted-foreground">#{step.stepNumber}</span>{described.title}
                  </span>
                  <time className="shrink-0 text-muted-foreground">{new Date(step.createdAt).toLocaleTimeString()}</time>
                </div>
                {described.detail && <p className="mt-1 text-muted-foreground">{described.detail}</p>}
                <SkillOutputs outputs={step.result?.outputs as Record<string, unknown> | undefined} />
                {onFocusInChat && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 h-6 px-1.5 text-[11px]"
                    onClick={() => onFocusInChat(
                      { id: `computer-use:${task.id}:${step.stepNumber}`, label: `Step #${step.stepNumber}`, sublabel: described.title, type: "control" },
                      `About step #${step.stepNumber} of the computer-use task "${task.task}": ${described.title}${described.detail ? ` (${described.detail})` : ""}.`,
                    )}
                  >
                    <MessageSquare className="mr-1 h-3 w-3" />Ask in chat
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Resume tasks paused by the retired run-start approval gate. */
function ResumeLegacyRun({ task, onStarted }: { task: StudioTask; onStarted: () => void }) {
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/integrations/trycua/computer-use/tasks/${task.id}/run`, {})).json(),
    onSuccess: onStarted,
  });
  return (
    <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-xs" data-testid="resume-legacy-run">
      <p className="font-medium">Ready to resume</p>
      <p className="text-muted-foreground">
        Start approval is no longer required. Resume this task to continue.
      </p>
      <Button size="sm" variant="outline" className="h-7" onClick={() => start.mutate()} disabled={start.isPending}>
        {start.isPending ? "Checking…" : "Start now if approved"}
      </Button>
      {start.error && <p role="alert" className="text-destructive">{(start.error as Error).message}</p>}
    </div>
  );
}

function SkillTab({ task, steps }: { task: StudioTask; steps: StudioStep[] }) {
  const used = skillUsed(steps, typeof task.metadata?.skillId === "string" ? task.metadata.skillId : undefined);
  const recording = takeoverRecording(steps);

  const usedSkill = useQuery<{ skill: StudioSkill }>({
    queryKey: ["/api/integrations/trycua/skills", used?.id],
    queryFn: async () => (await apiRequest("GET", `/api/integrations/trycua/skills/${used!.id}`)).json(),
    enabled: !!used?.id,
  });
  // The draft is written in the background after the takeover, so poll for it. Every
  // status, not only drafts: one that has since been approved or archived is still what
  // this takeover produced, and filtering to drafts left the panel saying "drafting…"
  // about a recording that had long since become a skill.
  const drafts = useQuery<{ skills: StudioSkill[] }>({
    queryKey: ["/api/integrations/trycua/skills", "all"],
    queryFn: async () => (await apiRequest("GET", "/api/integrations/trycua/skills")).json(),
    enabled: !!recording,
    refetchInterval: (query) => (query.state.data?.skills.some((s) => s.sourceRecordingId === recording?.recordingId) ? false : 5000),
  });
  const draft = drafts.data?.skills.find((s) => s.sourceRecordingId === recording?.recordingId);
  // Drafting calls a model and can fail. After a few minutes, say so rather than
  // promising a skill that is never coming.
  const draftingFailed = !!recording && !draft && !drafts.isPending
    && Date.now() - new Date(recording.at).getTime() > DRAFTING_GRACE_MS;

  return (
    <div className="space-y-4 text-sm">
      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skill used</h3>
        {!used ? (
          <p className="text-muted-foreground">No learned skill matched this task, so the agent worked it out from the screen.</p>
        ) : usedSkill.data?.skill ? (
          <SkillCard skill={usedSkill.data.skill} />
        ) : usedSkill.error ? (
          <p className="text-muted-foreground">{used.name ? `"${used.name}"` : "A learned skill"} (details unavailable: {(usedSkill.error as Error).message})</p>
        ) : (
          <p className="text-muted-foreground">{used.name ? `"${used.name}"` : "Loading…"}</p>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Learned from your takeover</h3>
        {!recording ? (
          <p className="text-muted-foreground">
            When the agent hands you the desktop and you finish the step in its browser, what you do is recorded
            (never passwords or one-time codes) and drafted into a skill for next time.
          </p>
        ) : draft ? (
          <>
            <SkillCard skill={draft} />
            <p className="text-xs text-muted-foreground">
              Drafts are never replayed until an organization admin approves them.{" "}
              <a className="text-primary underline" href="/settings">Review in Settings</a>
            </p>
          </>
        ) : drafts.error ? (
          <p role="alert" className="text-destructive">{(drafts.error as Error).message}</p>
        ) : draftingFailed ? (
          <p className="text-muted-foreground">
            Recorded {recording.steps} step{recording.steps === 1 ? "" : "s"}, but no skill was drafted from it.
            You can draft one from the recording in <a className="text-primary underline" href="/settings">Settings</a>.
          </p>
        ) : (
          <p className="text-muted-foreground">Recorded {recording.steps} step{recording.steps === 1 ? "" : "s"}. Drafting a skill from it…</p>
        )}
      </section>
    </div>
  );
}

function SkillCard({ skill }: { skill: StudioSkill }) {
  const runs = skill.successCount + skill.failureCount;
  return (
    <div className="rounded-md border border-violet-500/40 bg-violet-500/5 p-2.5" data-testid="skill-card">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium"><BookOpen className="h-3.5 w-3.5" />{skill.name}</span>
        <span className="text-xs text-muted-foreground">{skill.status}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {skill.site ? `${skill.site} · ` : ""}
        {runs === 0 ? "not run yet" : `${skill.successCount} of ${runs} runs finished the task`}
      </p>
    </div>
  );
}
