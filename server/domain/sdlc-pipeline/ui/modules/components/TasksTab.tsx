import { useState } from "react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { CheckCircle2, Circle, Loader2, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import type { TaskEntry, TaskEntryStatus } from "../types/index.js";

const STATUS_META: Record<TaskEntryStatus, { Icon: typeof Circle; className: string }> = {
  completed: { Icon: CheckCircle2, className: "text-green-600" },
  in_progress: { Icon: Loader2, className: "text-blue-600 animate-spin" },
  failed: { Icon: XCircle, className: "text-red-600" },
  pending: { Icon: Circle, className: "text-muted-foreground" },
};

export interface TasksTabProps {
  tasks: TaskEntry[];
}

export function TasksTab({ tasks }: TasksTabProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks recorded for this session.</p>;
  }

  const ordered = [...tasks].sort((a, b) => a.order - b.order);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <ul className="space-y-1" data-testid="tasks-tab">
      {ordered.map((task) => {
        const meta = STATUS_META[task.status] ?? STATUS_META.pending;
        const { Icon } = meta;
        const isOpen = open.has(task.id);
        const hasDetail = !!task.rationale || task.affectedFiles.length > 0 || (task.verificationResults?.length ?? 0) > 0;
        return (
          <li key={task.id} className="rounded-md border p-2">
            <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => hasDetail && toggle(task.id)} disabled={!hasDetail}>
              <Icon className={`h-4 w-4 ${meta.className}`} />
              <span className="text-sm">{task.title}</span>
              {task.status === "failed" && <Badge variant="destructive" className="ml-auto text-[10px]">failed</Badge>}
              {hasDetail && (isOpen ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />)}
            </button>
            {isOpen && (
              <div className="mt-2 space-y-1 pl-6 text-xs text-muted-foreground">
                {task.rationale && <p>{task.rationale}</p>}
                {task.affectedFiles.length > 0 && (
                  <p><span className="font-medium">Files:</span> {task.affectedFiles.map((f) => <code key={f} className="mr-1">{f}</code>)}</p>
                )}
                {task.verificationResults && task.verificationResults.length > 0 && (
                  <p><span className="font-medium">Verification:</span> {task.verificationResults.filter((v) => v.status === "passed").length}/{task.verificationResults.length} passed</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
