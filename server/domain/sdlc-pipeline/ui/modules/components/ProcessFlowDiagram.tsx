import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, Circle, ArrowRight } from "lucide-react";
import type { PhaseStatus } from "../types/index.js";

/** Canonical autonomous codegen pipeline steps, in order. */
const CANONICAL_STEPS: { key: string; label: string }[] = [
  { key: "context_loading", label: "Context Loading" },
  { key: "change_planning", label: "Change Planning" },
  { key: "scope_review", label: "Scope Review" },
  { key: "edit_application", label: "Edit Application" },
  { key: "test_loop", label: "Test Loop" },
  { key: "quality_gate", label: "Quality Gate" },
  { key: "pr_generation", label: "PR Generation" },
];

function normalize(name: string): string {
  return name.toLowerCase().replace(/[\s-]+/g, "_");
}

export interface ProcessFlowDiagramProps {
  phases: PhaseStatus[];
  currentPhase?: string | null;
}

export function ProcessFlowDiagram({ phases, currentPhase }: ProcessFlowDiagramProps) {
  const byKey = new Map(phases.map((p) => [normalize(p.phase), p]));
  const currentKey = currentPhase ? normalize(currentPhase) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="process-flow-diagram">
      {CANONICAL_STEPS.map((step, i) => {
        const phase = byKey.get(step.key);
        const isActive = currentKey === step.key || phase?.status === "active";
        const isDone = phase?.status === "completed";
        const Icon = isDone ? CheckCircle2 : isActive ? Loader2 : Circle;
        return (
          <div key={step.key}>
            <div
              className={cn(
                "flex items-center gap-3 rounded-md border p-3",
                isActive && "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20",
                isDone && "border-green-200",
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 shrink-0",
                  isDone ? "text-green-600" : isActive ? "animate-spin text-blue-600" : "text-muted-foreground",
                )}
              />
              <div className="flex-1">
                <p className="text-sm font-medium">{step.label}</p>
                {isDone && phase && (
                  <p className="text-[11px] text-muted-foreground">
                    ${phase.costUsd.toFixed(2)} · {phase.artifactCount} artifact{phase.artifactCount === 1 ? "" : "s"}
                    {phase.completedAt && phase.startedAt &&
                      ` · ${Math.round((new Date(phase.completedAt).getTime() - new Date(phase.startedAt).getTime()) / 1000)}s`}
                  </p>
                )}
                {isActive && <p className="text-[11px] text-blue-600">In progress…</p>}
              </div>
            </div>
            {i < CANONICAL_STEPS.length - 1 && (
              <div className="flex justify-center py-0.5">
                <ArrowRight className="h-3 w-3 rotate-90 text-muted-foreground" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
