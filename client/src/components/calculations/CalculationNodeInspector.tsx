import React, { useState, useEffect } from "react";
import {
  Calculator,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
  Sparkles,
  Layers,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CalculationNodeInspectorProps {
  node: any;
  onClose: () => void;
  onUpdated?: () => void;
}

export function CalculationNodeInspector({
  node,
  onClose,
  onUpdated,
}: CalculationNodeInspectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formula, setFormula] = useState<string>(node?.data?.formula || "");
  const [name, setName] = useState<string>(node?.data?.name || "");

  useEffect(() => {
    if (node) {
      setFormula(node.data?.formula || "");
      setName(node.data?.name || "");
    }
  }, [node]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const calcId = node?.data?.id || node?.id;
      if (!calcId) throw new Error("Missing calculation ID");
      const res = await apiRequest("POST", `/api/calculations/${calcId}/run`, {});
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Node Evaluated",
        description: `Result: ${typeof result?.result === "number" ? result.result.toFixed(4) : JSON.stringify(result?.result)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/calculations"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-graph-semantic"] });
      onUpdated?.();
    },
    onError: (err: any) => {
      toast({
        title: "Execution Error",
        description: err.message || "Failed to evaluate calculation node",
        variant: "destructive",
      });
    },
  });

  if (!node) return null;

  const data = node.data || {};
  const operation = data.operation || "SUM";
  const category = data.category || "basic";
  const cachedResult = data.cachedResult;

  return (
    <div className="w-80 bg-card/95 border-l border-border/60 flex flex-col h-full backdrop-blur-md z-20 shadow-2xl animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b border-border/60 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
            <Calculator className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-foreground truncate">{name || "Calculation Node"}</h3>
            <p className="text-[10px] text-muted-foreground font-mono uppercase">{operation}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Status and Category */}
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-[10px] uppercase font-mono bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
            Category: {category}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-mono uppercase",
              data.status === "active" && "text-emerald-400 border-emerald-500/30",
              data.status === "error" && "text-rose-400 border-rose-500/30",
              data.status === "pending" && "text-amber-400 border-amber-500/30"
            )}
          >
            {data.status || "active"}
          </Badge>
        </div>

        {/* Name input */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Node Label</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-background border border-border/60 text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Formula editor */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Formula / Expression</label>
          <textarea
            rows={3}
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-background border border-border/60 text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Output Value Card */}
        <div className="p-3.5 rounded-xl bg-foreground/[0.02] border border-border/60 space-y-2">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Last Output Value</span>
            {data.lastRunMs && <span>{data.lastRunMs}ms</span>}
          </div>
          <div className="text-base font-bold font-mono text-foreground">
            {typeof cachedResult === "number"
              ? cachedResult.toLocaleString(undefined, { maximumFractionDigits: 4 })
              : cachedResult != null
              ? String(cachedResult)
              : "Not calculated yet"}
          </div>
        </div>

        {/* Execute button */}
        <Button
          className="w-full h-9 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
        >
          <Play className={cn("h-3.5 w-3.5", runMutation.isPending && "animate-spin")} />
          {runMutation.isPending ? "Evaluating..." : "Evaluate Calculation Node"}
        </Button>
      </div>
    </div>
  );
}
