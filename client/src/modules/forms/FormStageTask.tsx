import React, { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { StageView } from "@shared/form-studio-stages";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ResultBlocks, formatValue } from "./ResultBlocks";
import { StudioRenderer } from "./StudioRenderer";

/**
 * One stage of a cycle's Form Studio response, for the person asked to fill it in:
 * where the response is, the earlier answers they may see (with where an agent's
 * answer came from), and their own stage's questions. Once their stage is in, the
 * results they may see.
 *
 * Everything shown comes from the server's stage view, which leaves out stages
 * this person may not see, so nothing here has to hide anything.
 */

export interface StageTask extends StageView {
  responseId: number;
  formId: number;
  formName: string;
  releaseNumber: number;
  complete: boolean;
}

export interface FormStageTaskProps {
  task: StageTask;
  /** Without it the stage is shown read-only, for example a request already resolved. */
  onSubmit?: (inputs: Record<string, unknown>) => Promise<{ view: StageView }>;
  submitLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function FormStageTask({ task, onSubmit, submitLabel = "Submit stage", disabled, className }: FormStageTaskProps) {
  const readOnly = task.locked || !onSubmit;
  return (
    <div className={cn("grid gap-5", className)} data-testid="form-stage-task">
      <header className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {task.formName} · v{task.releaseNumber}
        </p>
        <h3 className="text-lg font-semibold">{task.stage.title}</h3>
        <ol aria-label="Stages" className="flex flex-wrap gap-2 text-xs">
          {task.progress.map((stage) => (
            <li
              key={stage.id}
              aria-current={stage.id === task.stage.id ? "step" : undefined}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5",
                stage.id === task.stage.id ? "border-primary text-foreground" : "text-muted-foreground",
              )}
            >
              {stage.locked ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <Circle className="h-3 w-3" aria-hidden />}
              {stage.title}
              <span className="sr-only">{stage.locked ? " (submitted)" : " (waiting)"}</span>
            </li>
          ))}
        </ol>
      </header>

      {task.earlier.length > 0 && (
        <section aria-label="Earlier answers" className="grid gap-3 rounded-lg border p-3">
          <h4 className="text-sm font-medium">Earlier answers</h4>
          {task.earlier.map((stage) => (
            <div key={stage.stageId} className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">{stage.title}</p>
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {stage.answers.map((answer) => (
                  <div key={answer.key}>
                    <dt className="text-xs text-muted-foreground">{answer.label}</dt>
                    <dd>
                      {formatValue(answer.value)}
                      {answer.source && <span className="block text-xs text-muted-foreground">Source: {answer.source}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      )}

      {readOnly ? (
        <section className="grid gap-3">
          <p className="flex items-center gap-2 text-sm" role="status">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            {task.locked ? "This stage has been submitted." : "This request is no longer waiting for answers."}
          </p>
          <ResultBlocks results={task.results} emptyMessage="No results to show for this stage yet." />
        </section>
      ) : (
        <StudioRenderer
          definition={task.definition}
          stageId={task.stage.id}
          cohort={task.cohort}
          audience={task.stage.audience}
          initialInputs={task.inputs}
          submitLabel={submitLabel}
          showPageTitles
          disabled={disabled}
          onSubmit={async (inputs) => {
            const { view } = await onSubmit!(inputs);
            return { results: view.results };
          }}
        />
      )}
    </div>
  );
}

type RequestState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; task: StageTask; status: string };

/** A stage request in the Decision Inbox: loads the stage for the signed-in person and submits it. */
export function FormStageRequestPanel({ approvalId, onCompleted, className }: { approvalId: number; onCompleted?: () => void; className?: string }) {
  const [state, setState] = useState<RequestState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/form-studio/stage-requests/${approvalId}`);
        const body = await res.json();
        if (active) setState({ kind: "ready", task: body.view, status: body.request.status });
      } catch (error) {
        if (active) setState({ kind: "error", message: (error as Error).message || "This stage could not be loaded." });
      }
    })();
    return () => { active = false; };
  }, [approvalId]);

  if (state.kind === "loading") {
    return (
      <p className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)} role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the stage…
      </p>
    );
  }
  if (state.kind === "error") return <p className={cn("text-sm text-destructive", className)} role="alert">{state.message}</p>;

  return (
    <FormStageTask
      className={className}
      task={state.task}
      onSubmit={state.status === "pending" ? async (inputs) => {
        const res = await apiRequest("POST", `/api/form-studio/stage-requests/${approvalId}`, { inputs });
        const body = await res.json();
        onCompleted?.();
        return { view: body.view };
      } : undefined}
    />
  );
}
