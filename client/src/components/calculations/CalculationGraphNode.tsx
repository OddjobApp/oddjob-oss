import React, { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  Calculator,
  TrendingUp,
  Percent,
  ShieldCheck,
  Share2,
  Cpu,
  Binary,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export interface CalculationNodeData {
  id?: number;
  name: string;
  operation: string;
  category?: string;
  formula?: string;
  status?: "active" | "error" | "pending" | "deprecated";
  cachedResult?: any;
  confidenceScore?: number;
  lastRunMs?: number;
  selected?: boolean;
}

function getOperationMeta(operation: string, category?: string) {
  const op = (operation || "").toUpperCase();
  const cat = (category || "").toLowerCase();

  if (cat === "temporal" || op.includes("CAGR") || op.includes("YOY") || op.includes("MOVING")) {
    return {
      icon: TrendingUp,
      color: "text-emerald-400",
      border: "border-emerald-500/40 hover:border-emerald-400",
      bg: "bg-emerald-950/40",
      badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    };
  }
  if (cat === "probabilistic" || op.includes("MONTE") || op.includes("BAYES")) {
    return {
      icon: Percent,
      color: "text-purple-400",
      border: "border-purple-500/40 hover:border-purple-400",
      bg: "bg-purple-950/40",
      badge: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    };
  }
  if (cat === "constraint" || op.includes("POLICY") || op.includes("GATE")) {
    return {
      icon: ShieldCheck,
      color: "text-amber-400",
      border: "border-amber-500/40 hover:border-amber-400",
      bg: "bg-amber-950/40",
      badge: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    };
  }
  if (cat === "graph_algorithm" || op.includes("PAGERANK") || op.includes("CENTRALITY")) {
    return {
      icon: Share2,
      color: "text-cyan-400",
      border: "border-cyan-500/40 hover:border-cyan-400",
      bg: "bg-cyan-950/40",
      badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
    };
  }
  if (cat === "ml_inference" || op.includes("ANOMALY") || op.includes("PREDICT")) {
    return {
      icon: Cpu,
      color: "text-rose-400",
      border: "border-rose-500/40 hover:border-rose-400",
      bg: "bg-rose-950/40",
      badge: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    };
  }
  return {
    icon: Calculator,
    color: "text-indigo-400",
    border: "border-indigo-500/40 hover:border-indigo-400",
    bg: "bg-indigo-950/40",
    badge: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
  };
}

export const CalculationGraphNode = memo(({ data, selected }: NodeProps<CalculationNodeData>) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const meta = getOperationMeta(data.operation, data.category);
  const Icon = meta.icon;

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!data.id) return;
      const res = await apiRequest("POST", `/api/calculations/${data.id}/run`, {});
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Calculation Evaluated",
        description: `${data.name}: ${typeof result?.result === "number" ? result.result.toFixed(4) : "Success"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/calculations"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-graph-semantic"] });
    },
    onError: (err: any) => {
      toast({
        title: "Calculation Failed",
        description: err.message || "Execution error",
        variant: "destructive",
      });
    },
  });

  const displayResult =
    typeof data.cachedResult === "number"
      ? data.cachedResult.toLocaleString(undefined, { maximumFractionDigits: 3 })
      : data.cachedResult != null
      ? String(data.cachedResult)
      : null;

  return (
    <div
      className={cn(
        "group relative rounded-xl border p-3 backdrop-blur-md transition-all shadow-lg min-w-[210px] max-w-[250px]",
        meta.bg,
        meta.border,
        selected && "ring-2 ring-primary shadow-primary/20",
        data.status === "error" && "border-rose-500/60 bg-rose-950/40"
      )}
    >
      {/* Target input handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2.5 !h-2.5 !bg-indigo-400 !border-2 !border-background hover:!bg-indigo-300"
      />

      {/* Target input handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!w-2.5 !h-2.5 !bg-indigo-400 !border-2 !border-background hover:!bg-indigo-300"
      />

      {/* Node Header */}
      <div className="flex items-center justify-between gap-1.5 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={cn("p-1 rounded-md bg-foreground/10 shrink-0", meta.color)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-bold text-foreground truncate">{data.name}</span>
        </div>

        {data.id && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              runMutation.mutate();
            }}
            disabled={runMutation.isPending}
            title="Execute Calculation Node"
          >
            <Play className={cn("h-3 w-3", runMutation.isPending && "animate-spin text-primary")} />
          </Button>
        )}
      </div>

      {/* Operation badge & Formula */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className={cn("text-[9px] font-mono px-1.5 py-0 uppercase", meta.badge)}>
            {data.operation || "AST"}
          </Badge>
          {data.status && (
            <Badge
              variant="outline"
              className={cn(
                "text-[8px] font-mono uppercase px-1 py-0",
                data.status === "active" && "text-emerald-400 border-emerald-500/30",
                data.status === "error" && "text-rose-400 border-rose-500/30",
                data.status === "pending" && "text-amber-400 border-amber-500/30"
              )}
            >
              {data.status}
            </Badge>
          )}
        </div>

        {data.formula && (
          <div className="text-[10px] font-mono text-muted-foreground truncate bg-background/40 px-1.5 py-0.5 rounded border border-border/40">
            {data.formula}
          </div>
        )}
      </div>

      {/* Output / Result Footer */}
      {displayResult !== null && (
        <div className="mt-2 pt-1.5 border-t border-border/40 flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground font-mono">Out:</span>
          <span className="font-mono font-bold text-foreground">{displayResult}</span>
        </div>
      )}

      {/* Source output handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2.5 !h-2.5 !bg-indigo-400 !border-2 !border-background hover:!bg-indigo-300"
      />

      {/* Source output handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!w-2.5 !h-2.5 !bg-indigo-400 !border-2 !border-background hover:!bg-indigo-300"
      />
    </div>
  );
});

CalculationGraphNode.displayName = "CalculationGraphNode";
