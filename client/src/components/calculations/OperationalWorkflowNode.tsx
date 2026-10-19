import React, { memo, useEffect, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Globe,
  Database,
  Shield,
  MessageSquare,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export interface OperationalWorkflowNodeData {
  /** The saved node's id; a node the server did not save has only its canvas id. */
  id?: string | number;
  name: string;
  kind: "tool" | "saas" | "scaffold_pack" | "hil_gate";
  category?: string;
  target?: string;
  status?: "idle" | "running" | "success" | "error" | "failed" | "rejected" | "pending_approval";
  lastRun?: { approvalId: number; output?: string; error?: string; decidedBy?: string | null };
  config?: Record<string, unknown>;
  selected?: boolean;
}

function getNodeKindMeta(kind: string, category?: string) {
  const c = (category || "").toLowerCase();
  if (kind === "saas") {
    return {
      icon: Globe,
      color: "text-blue-400",
      border: "border-blue-500/40 hover:border-blue-400",
      bg: "bg-blue-950/40",
      badge: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    };
  }
  if (kind === "scaffold_pack") {
    return {
      icon: Layers,
      color: "text-amber-400",
      border: "border-amber-500/40 hover:border-amber-400",
      bg: "bg-amber-950/40",
      badge: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    };
  }
  if (kind === "hil_gate") {
    return {
      icon: Shield,
      color: "text-rose-400",
      border: "border-rose-500/40 hover:border-rose-400",
      bg: "bg-rose-950/40",
      badge: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    };
  }
  if (c === "data") {
    return {
      icon: Database,
      color: "text-emerald-400",
      border: "border-emerald-500/40 hover:border-emerald-400",
      bg: "bg-emerald-950/40",
      badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    };
  }
  if (c === "messaging") {
    return {
      icon: MessageSquare,
      color: "text-purple-400",
      border: "border-purple-500/40 hover:border-purple-400",
      bg: "bg-purple-950/40",
      badge: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    };
  }
  return {
    icon: Wrench,
    color: "text-cyan-400",
    border: "border-cyan-500/40 hover:border-cyan-400",
    bg: "bg-cyan-950/40",
    badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  };
}

const STATUS = {
  idle: { icon: CheckCircle2, className: "text-muted-foreground", label: "Ready" },
  running: { icon: Clock, className: "text-amber-400", label: "Running" },
  pending_approval: { icon: Clock, className: "text-amber-400", label: "Awaiting approval" },
  success: { icon: CheckCircle2, className: "text-emerald-400", label: "Ran" },
  failed: { icon: AlertCircle, className: "text-destructive", label: "Failed" },
  error: { icon: AlertCircle, className: "text-destructive", label: "Not saved" },
  rejected: { icon: XCircle, className: "text-destructive", label: "Rejected" },
} as const;

/**
 * A tool, SaaS action, review gate or scaffold pack on the canvas. Run asks for
 * approval in the Decision Inbox; nothing runs from here. A scaffold pack has no Run:
 * packs are added to an app in App Studio.
 */
export const OperationalWorkflowNode = memo(({ data, selected }: NodeProps<OperationalWorkflowNodeData>) => {
  const { toast } = useToast();
  const meta = getNodeKindMeta(data.kind, data.category);
  const Icon = meta.icon;
  const [status, setStatus] = useState(data.status ?? "idle");
  useEffect(() => setStatus(data.status ?? "idle"), [data.status]);

  const saved = typeof data.id === "number";
  const runnable = data.kind !== "scaffold_pack";
  const isGate = data.kind === "hil_gate";

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/workflow-nodes/${data.id}/run`, {});
      return res.json();
    },
    onSuccess: (result) => {
      setStatus("pending_approval");
      toast({
        title: result?.alreadyPending ? "Already waiting for approval" : "Sent for approval",
        description: isGate
          ? `${data.name} is signed off when someone approves it in the Decision Inbox.`
          : `${data.name} runs once someone approves it in the Decision Inbox.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Not sent for approval",
        description: err?.message || "The request could not be made.",
        variant: "destructive",
      });
    },
  });

  const shown = STATUS[status as keyof typeof STATUS] ?? STATUS.idle;
  const StatusIcon = shown.icon;
  const outcome = data.lastRun?.error ?? data.lastRun?.output;
  const statusLabel = status === "success" && isGate ? "Signed off" : shown.label;

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card/95 backdrop-blur-md p-3.5 shadow-xl transition-all duration-200 min-w-[240px] max-w-[300px]",
        meta.border,
        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-primary/20" : "hover:shadow-lg"
      )}
    >
      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="in-1"
        className="w-3 h-3 rounded-full !bg-primary border-2 !border-background hover:scale-125 transition-transform"
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={cn("p-1.5 rounded-lg border flex items-center justify-center shrink-0", meta.bg, meta.border)}>
            <Icon className={cn("w-4 h-4", meta.color)} />
          </div>
          <div className="overflow-hidden">
            <h4 className="text-xs font-semibold text-foreground truncate leading-tight">{data.name}</h4>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
              {data.kind.replace("_", " ")}
            </span>
          </div>
        </div>

        <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 font-mono shrink-0 border", meta.badge)}>
          {data.category || data.kind}
        </Badge>
      </div>

      {/* Target summary */}
      {data.target && (
        <div className="px-2 py-1 rounded bg-muted/60 border border-border/40 font-mono text-[10px] text-muted-foreground truncate mb-2.5">
          {data.target}
        </div>
      )}

      {outcome && (status === "success" || status === "failed") && (
        <p className="mb-2 line-clamp-2 text-[10px] text-muted-foreground" title={outcome}>{outcome}</p>
      )}

      {/* Footer controls */}
      <div className="flex items-center justify-between border-t border-border/40 pt-2 mt-1">
        <div className={cn("flex items-center gap-1.5 text-[10px] font-mono", shown.className)} role="status">
          <StatusIcon className="w-3 h-3" aria-hidden />
          <span>{runMutation.isPending ? "Asking…" : statusLabel}</span>
        </div>

        {runnable && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] gap-1 hover:bg-primary/10 hover:text-primary transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              runMutation.mutate();
            }}
            disabled={!saved || status === "pending_approval" || runMutation.isPending}
            title={!saved ? "This node was not saved, so there is nothing to run." : status === "pending_approval" ? "Waiting for approval in the Decision Inbox." : undefined}
          >
            <Play className="w-2.5 h-2.5 fill-current" aria-hidden />
            <span>{isGate ? "Request sign-off" : "Request run"}</span>
          </Button>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="w-3 h-3 rounded-full !bg-primary border-2 !border-background hover:scale-125 transition-transform"
      />
    </div>
  );
});

OperationalWorkflowNode.displayName = "OperationalWorkflowNode";
