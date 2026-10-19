import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { CheckCircle2, RefreshCw, Wrench, Shield, ChevronDown, ChevronRight } from "lucide-react";
import type { VerificationEvent } from "../types/index.js";

const TYPE_ICON: Record<VerificationEvent["type"], typeof CheckCircle2> = {
  step_check: CheckCircle2,
  test_loop_iteration: RefreshCw,
  fix_attempt: Wrench,
  quality_gate: Shield,
  sandbox_stub: Wrench,
  mutation_test: RefreshCw,
};

const OUTCOME_VARIANT: Record<VerificationEvent["status"], "success" | "destructive" | "secondary"> = {
  passed: "success",
  failed: "destructive",
  skipped: "secondary",
};

export interface VerificationTimelineProps {
  events?: VerificationEvent[];
}

export function VerificationTimeline({ events }: VerificationTimelineProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (!events || events.length === 0) {
    return <p className="text-sm text-muted-foreground">No verification report available yet.</p>;
  }

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <ol className="space-y-2" data-testid="verification-timeline">
      {events.map((event, i) => {
        const Icon = TYPE_ICON[event.type] ?? CheckCircle2;
        const isFix = event.type === "fix_attempt";
        const isOpen = expanded.has(i);
        return (
          <li key={i} className="rounded-md border p-2">
            <button
              type="button"
              className={cn("flex w-full items-center gap-2 text-left", isFix && "cursor-pointer")}
              onClick={() => isFix && toggle(i)}
              disabled={!isFix}
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium capitalize">{event.type.replace(/_/g, " ")}</span>
              <Badge variant={OUTCOME_VARIANT[event.status]} className="ml-auto text-[10px]">
                {event.status}
              </Badge>
              {isFix && (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
            </button>
            {isFix && isOpen && (
              <div className="mt-2 space-y-1 pl-6 text-xs text-muted-foreground">
                {event.details?.diagnosis != null && <p><strong>Diagnosis:</strong> {String(event.details.diagnosis)}</p>}
                {event.details?.fixDescription != null && <p><strong>Fix:</strong> {String(event.details.fixDescription)}</p>}
                <p><strong>Duration:</strong> {event.duration}ms</p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
