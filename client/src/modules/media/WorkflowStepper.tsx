import React from "react";
import { AlertTriangle, ArrowRight, Check, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./StatusIcon";
import type { NextStep, ProductionWorkflow, StageState, WorkflowStage } from "./workflow";

/**
 * The studio's tabs as a pipeline: Story → Storyboard → Shots → Film, each showing
 * where it stands, plus Create and Characters as specialized studios.
 * Below it, one card names the next thing worth doing.
 *
 * The buttons keep role="tab", id="media-tab-*" and arrow-key movement, so they are
 * still a tablist to assistive tech and to the specs that drive the studio.
 */

export type StudioTab = "create" | "characters" | WorkflowStage;

const STATE_LABEL: Record<StageState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_attention: "Needs attention",
  done: "Done",
};

function StageMarker({ state, index }: { state: StageState; index: number }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" aria-hidden>
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (state === "needs_attention") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400" aria-hidden>
        <AlertTriangle className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums",
        state === "in_progress" ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground",
      )}
      aria-hidden
    >
      {index + 1}
    </span>
  );
}

export function WorkflowStepper({ tab, onSelect, workflow, createTooltip }: {
  tab: StudioTab;
  onSelect: (tab: StudioTab) => void;
  workflow: ProductionWorkflow;
  createTooltip?: string;
}) {
  const order: StudioTab[] = ["create", "characters", ...workflow.stages.map((s) => s.stage)];

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: StudioTab) => {
    const index = order.indexOf(current);
    const next = event.key === "ArrowRight" ? (index + 1) % order.length
      : event.key === "ArrowLeft" ? (index + order.length - 1) % order.length
      : event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(order[next]);
    event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const tabProps = (id: StudioTab) => ({
    type: "button" as const,
    role: "tab" as const,
    id: `media-tab-${id}`,
    "aria-selected": tab === id,
    "aria-controls": `media-panel-${id}`,
    tabIndex: tab === id ? 0 : -1,
    onClick: () => onSelect(id),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, id),
  });

  return (
    <div role="tablist" aria-label="Media Studio" className="flex items-stretch gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5" data-testid="media-workflow-stepper">
      <button
        {...tabProps("create")}
        aria-label="Create"
        title={createTooltip}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
          tab === "create" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          FOCUS_RING,
        )}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Create
      </button>
      <button
        {...tabProps("characters")}
        aria-label="Characters"
        title="Character Engine: Invariant phenotypes, turnaround crop bounds, wardrobe states, and face QA"
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
          tab === "characters" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          FOCUS_RING,
        )}
        data-testid="media-tab-characters"
      >
        <User className="h-3.5 w-3.5" aria-hidden />
        Characters
      </button>
      <span className="mx-1 w-px shrink-0 self-stretch bg-border/70" aria-hidden />
      <ol className="flex min-w-0 flex-1 items-stretch gap-0.5" aria-label={`Production pipeline, ${workflow.completed} of ${workflow.stages.length} stages done`}>
        {workflow.stages.map((stage, index) => (
          <li key={stage.stage} className="flex min-w-0 items-center">
            <button
              {...tabProps(stage.stage)}
              aria-label={stage.label}
              title={`${stage.label} (${STATE_LABEL[stage.state]}): ${stage.detail}`}
              data-state={stage.state}
              data-testid={`workflow-stage-${stage.stage}`}
              className={cn(
                "group flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors",
                tab === stage.stage ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                FOCUS_RING,
              )}
            >
              <StageMarker state={stage.state} index={index} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate font-medium">{stage.label}</span>
                {stage.summary && <span className="truncate text-[10px] tabular-nums text-muted-foreground">{stage.summary}</span>}
              </span>
              <span className="sr-only">, {STATE_LABEL[stage.state]}</span>
            </button>
            {index < workflow.stages.length - 1 && (
              <ArrowRight
                className={cn("mx-0.5 h-3 w-3 shrink-0", stage.state === "done" ? "text-emerald-500/70" : "text-muted-foreground/40")}
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The one recommended action. Hidden on the stage it points to — the person is already
 * there — and when nothing is outstanding.
 */
export function NextStepCard({ next, tab, onGo, onDismiss }: {
  next: NextStep | null;
  tab: StudioTab;
  onGo: (stage: WorkflowStage) => void;
  onDismiss?: () => void;
}) {
  if (!next || next.stage === tab) return null;
  return (
    <div
      className="mx-2 mt-2 flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"
      role="status"
      data-testid="media-next-step"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">Next: {next.title}</p>
        <p className="truncate text-[11px] text-muted-foreground" title={next.detail}>{next.detail}</p>
      </div>
      <Button type="button" size="sm" className="h-7 shrink-0 gap-1 text-xs" onClick={() => onGo(next.stage)} data-testid="media-next-step-go">
        {next.action}
        <ArrowRight className="h-3 w-3" aria-hidden />
      </Button>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={cn("shrink-0 rounded px-1 text-[11px] text-muted-foreground hover:text-foreground", FOCUS_RING)}
          aria-label="Hide the next-step suggestion"
          data-testid="media-next-step-dismiss"
        >
          Hide
        </button>
      )}
    </div>
  );
}
