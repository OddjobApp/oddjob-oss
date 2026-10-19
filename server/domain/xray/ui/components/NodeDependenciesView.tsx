import React from "react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ArrowLeftRight, ArrowRight, ArrowLeft, Target, Monitor, Zap, Puzzle, Briefcase, GitBranch, Database, Brain, Package, Layers } from "lucide-react";
import type { CompositionNode } from "../../types/composition";

interface NodeDependenciesViewProps {
  inbound: { node: CompositionNode; relation: string; label: string }[];
  outbound: { node: CompositionNode; relation: string; label: string }[];
  onSelectNode: (nodeId: string) => void;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  screen: Monitor,
  api_endpoint: Zap,
  ui_component: Puzzle,
  job_definition: Briefcase,
  pipeline: GitBranch,
  mission: Target,
  agent: Brain,
  supervisor: Target,
  dataset: Database,
  knowledge_cluster: Brain,
  npm_module: Package,
  skill: Layers,
};

export function NodeDependenciesView({ inbound, outbound, onSelectNode }: NodeDependenciesViewProps) {
  const renderNodeCard = (item: { node: CompositionNode; relation: string; label: string }, direction: "in" | "out") => {
    const Icon = TYPE_ICONS[item.node.type] ?? Package;
    return (
      <div
        key={`${direction}-${item.node.id}-${item.relation}`}
        className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-foreground/10 bg-foreground/[0.02] hover:bg-foreground/5 hover:border-foreground/20 transition-all cursor-pointer group"
        onClick={() => onSelectNode(item.node.id)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded bg-foreground/10 text-foreground/70 group-hover:text-purple-400 group-hover:bg-purple-500/10 transition-colors">
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-foreground truncate group-hover:text-purple-300 transition-colors">
              {item.node.label}
            </p>
            <p className="text-[9px] text-foreground/40 font-mono truncate">
              {item.relation} • {item.node.type.replace(/_/g, " ")}
            </p>
          </div>
        </div>

        <Badge variant="outline" className="text-[8px] font-mono border-foreground/10 flex-shrink-0">
          {direction === "in" ? "Inbound" : "Outbound"}
        </Badge>
      </div>
    );
  };

  return (
    <div className="space-y-5 py-2">
      {/* Inbound section */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <ArrowLeft className="w-3.5 h-3.5 text-blue-400" />
          <h4 className="text-[10px] font-black uppercase tracking-widest text-foreground/60">
            Inbound Dependencies ({inbound.length})
          </h4>
        </div>
        {inbound.length === 0 ? (
          <p className="text-[10px] text-foreground/30 italic pl-2">No incoming dependencies (Root Node)</p>
        ) : (
          <div className="space-y-1.5">
            {inbound.map(item => renderNodeCard(item, "in"))}
          </div>
        )}
      </div>

      {/* Outbound section */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
          <h4 className="text-[10px] font-black uppercase tracking-widest text-foreground/60">
            Outbound Dependencies ({outbound.length})
          </h4>
        </div>
        {outbound.length === 0 ? (
          <p className="text-[10px] text-foreground/30 italic pl-2">No outgoing dependencies (Terminal Node)</p>
        ) : (
          <div className="space-y-1.5">
            {outbound.map(item => renderNodeCard(item, "out"))}
          </div>
        )}
      </div>
    </div>
  );
}
