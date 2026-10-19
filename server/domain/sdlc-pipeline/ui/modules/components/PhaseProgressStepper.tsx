import { cn } from "@/lib/utils";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { CheckCircle2, Circle, Loader2, XCircle, MinusCircle, RotateCw } from "lucide-react";
import type { PhaseStatus } from "../types/index.js";

const STATUS_STYLES: Record<PhaseStatus["status"], { color: string; Icon: typeof Circle }> = {
  completed: { color: "text-green-600", Icon: CheckCircle2 },
  active: { color: "text-blue-600", Icon: Loader2 },
  failed: { color: "text-red-600", Icon: XCircle },
  skipped: { color: "text-muted-foreground", Icon: MinusCircle },
  pending: { color: "text-muted-foreground", Icon: Circle },
};

function elapsed(startedAt: Date | string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const s = Math.floor((Date.now() - start) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export interface PhaseProgressStepperProps {
  phases: PhaseStatus[];
  onRetryPhase?: (phase: string) => void;
}

export function PhaseProgressStepper({ phases, onRetryPhase }: PhaseProgressStepperProps) {
  if (phases.length === 0) {
    return <p className="text-sm text-muted-foreground">No phases recorded yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-start gap-2" data-testid="phase-progress-stepper">
      {phases.map((phase, i) => {
        const style = STATUS_STYLES[phase.status] ?? STATUS_STYLES.pending;
        const { Icon } = style;
        return (
          <div key={`${phase.phase}-${i}`} className="flex items-start">
            <div className="flex min-w-[7rem] flex-col items-center text-center">
              <Icon className={cn("h-6 w-6", style.color, phase.status === "active" && "animate-spin")} />
              <span className="mt-1 text-xs font-medium capitalize">{phase.phase.replace(/_/g, " ")}</span>
              {phase.status === "completed" && (
                <span className="text-[10px] text-muted-foreground">
                  ${phase.costUsd.toFixed(2)} · {phase.artifactCount} artifact{phase.artifactCount === 1 ? "" : "s"}
                </span>
              )}
              {phase.status === "active" && elapsed(phase.startedAt) && (
                <span className="text-[10px] text-blue-600">{elapsed(phase.startedAt)}</span>
              )}
              {phase.status === "failed" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 h-6 px-2 text-[10px]"
                  onClick={() => onRetryPhase?.(phase.phase)}
                  disabled={!onRetryPhase}
                  data-testid={`retry-phase-${phase.phase}`}
                >
                  <RotateCw className="mr-1 h-3 w-3" /> Retry
                </Button>
              )}
            </div>
            {i < phases.length - 1 && <div className="mt-3 h-px w-6 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
