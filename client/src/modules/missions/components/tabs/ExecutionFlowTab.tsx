import React, { useMemo } from "react";
import ReactFlow, { Background, Controls, MarkerType, MiniMap, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { GitBranch, GitMerge } from "lucide-react";

interface ExecutionFlowTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

function humanizeEvent(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function traceTone(trace: any) {
  const value = `${trace?.type ?? ""} ${trace?.event ?? ""}`.toLowerCase();
  if (value.includes("fail") || value.includes("error")) return { border: "rgb(244 63 94 / .55)", background: "rgb(76 5 25 / .92)" };
  if (value.includes("complete") || value.includes("success")) return { border: "rgb(16 185 129 / .55)", background: "rgb(2 44 34 / .92)" };
  if (value.includes("decision") || value.includes("branch")) return { border: "rgb(168 85 247 / .55)", background: "rgb(46 16 101 / .92)" };
  return { border: "rgb(59 130 246 / .55)", background: "rgb(23 37 84 / .92)" };
}

export default function ExecutionFlowTab({ run }: ExecutionFlowTabProps) {
  const dynamicTrace = Array.isArray(run?.dynamicTrace) ? run.dynamicTrace : [];
  const graph = useMemo(() => {
    const nodes: Node[] = dynamicTrace.map((trace: any, index: number) => {
      const event = String(trace.event || trace.type || `Event ${index + 1}`);
      const time = trace.timestamp ? new Date(trace.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
      return {
        id: String(trace.id ?? `trace-${index}`),
        position: { x: index * 260, y: index % 2 === 0 ? 90 : 190 },
        data: { label: `${humanizeEvent(event)}${time ? `  ·  ${time}` : ""}` },
        style: { ...traceTone(trace), color: "#f8fafc", borderRadius: 12, padding: 12, width: 220, fontSize: 12, fontWeight: 650 },
      };
    });
    const edges: Edge[] = nodes.slice(1).map((node, index) => ({
      id: `edge-${nodes[index].id}-${node.id}`,
      source: nodes[index].id,
      target: node.id,
      animated: index === nodes.length - 2 && run?.status === "active",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#64748b", strokeWidth: 1.5 },
    }));
    return { nodes, edges };
  }, [dynamicTrace, run?.status]);

  return (
    <Card className="border-border bg-background/40 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><GitMerge className="h-5 w-5 text-violet-500" /><CardTitle className="text-lg font-bold">Execution Flow</CardTitle></div>
          <CardDescription className="mt-2">Visual representation of the dynamic execution path</CardDescription>
        </div>
        <Badge variant="outline" className="border-foreground/10 text-[10px] font-black uppercase">{dynamicTrace.length} event{dynamicTrace.length === 1 ? "" : "s"}</Badge>
      </CardHeader>
      <CardContent>
        <div className="h-[360px] overflow-hidden rounded-xl border border-foreground/10 bg-muted/30">
          {graph.nodes.length > 0 ? (
            <ReactFlow nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.25} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} elementsSelectable>
              <Background color="#334155" gap={20} />
              <Controls showInteractive={false} className="!border-foreground/10 !bg-card" />
              {graph.nodes.length > 2 && <MiniMap pannable zoomable className="!border-foreground/10 !bg-card/90" maskColor="rgba(2,6,23,.65)" />}
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center text-center"><div><GitBranch className="mx-auto mb-3 h-9 w-9 text-muted-foreground/50" /><p className="text-sm font-semibold text-foreground">Waiting for the first execution event</p><p className="mt-1 text-xs text-muted-foreground">The flow will populate as this run emits trace events.</p></div></div>
          )}
        </div>

        <div className="mt-4 max-h-[240px] space-y-2 overflow-y-auto" aria-label="Execution trace events">
          {dynamicTrace.slice().reverse().slice(0, 20).map((trace: any, index: number) => (
            <div key={trace.id ?? index} className="flex items-center gap-3 rounded-lg border border-foreground/5 bg-background/50 p-2.5 text-sm">
              <div className="h-2 w-2 shrink-0 rounded-full bg-violet-500" />
              <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{trace.timestamp ? new Date(trace.timestamp).toLocaleTimeString() : "--:--"}</span>
              <span className="font-medium">{humanizeEvent(String(trace.event || trace.type || "Trace event"))}</span>
              {trace.type && trace.event && <Badge variant="outline" className="ml-auto border-foreground/10 text-[9px] uppercase text-muted-foreground">{trace.type}</Badge>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
