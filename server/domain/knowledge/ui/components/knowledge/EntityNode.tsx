/**
 * Entity Node Component
 * 
 * Custom React Flow node component that renders visual "Card" for each knowledge graph node.
 */

import React from "react";
import { Handle, Position } from "reactflow";
import { User, Ticket, AlertTriangle, Server, FileText } from "lucide-react";

interface EntityNodeProps {
  data: {
    label: string;
    name: string;
    externalId?: string;
    data: Record<string, any>;
    resultsCount?: number;
  };
  selected: boolean;
}

const nodeTypeConfig: Record<string, { color: string; icon: React.ComponentType<{ className?: string }> }> = {
  User: { color: "bg-blue-500", icon: User },
  Ticket: { color: "bg-green-500", icon: Ticket },
  Incident: { color: "bg-red-500", icon: AlertTriangle },
  Infrastructure: { color: "bg-purple-500", icon: Server },
  KnowledgeDocument: { color: "bg-orange-500", icon: FileText },
  Issue: { color: "bg-green-600", icon: Ticket }, // Added explicit config for JIRA Issues
};

export default function EntityNode({ data, selected }: EntityNodeProps) {
  if (!data) return null;
  const config = nodeTypeConfig[data.label] || { color: "bg-gray-500", icon: FileText };
  const Icon = config.icon || FileText;

  const cognitiveState = (data.data as any)?.cognitive_state || (data.data as any)?.cognitiveState;
  const cognitiveColors: Record<string, string> = {
    symptom: "shadow-[0_0_15px_rgba(245,158,11,0.5)] border-amber-400",
    cause: "shadow-[0_0_15px_rgba(239,68,68,0.5)] border-red-400",
    effect: "shadow-[0_0_15px_rgba(59,130,246,0.5)] border-blue-400",
    outcome: "shadow-[0_0_15px_rgba(34,197,94,0.5)] border-green-400",
    resource: "shadow-[0_0_15px_rgba(168,85,247,0.5)] border-purple-400",
  };

  const cognitiveStyle = cognitiveState ? cognitiveColors[cognitiveState.toLowerCase()] : "";

  return (
    <div
      className={`bg-card rounded-lg shadow-md border-2 ${selected ? "border-indigo-500 border-4" : "border-border"
        } ${cognitiveStyle} w-48 min-h-20 p-3 relative transition-all duration-300`}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className={`${config.color} text-foreground rounded-t-lg -m-3 mb-2 p-2 flex items-center gap-2`}>
        <Icon className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase">{data.label}</span>
      </div>

      <div className="space-y-1 mb-4">
        <div className="font-medium text-sm text-foreground">{data.name}</div>
        {data.externalId && (
          <div className="text-xs text-muted-foreground">#{data.externalId}</div>
        )}
      </div>

      {typeof data.resultsCount === 'number' && (
        <div className="absolute bottom-2 left-2 bg-muted text-muted-foreground text-[10px] px-1.5 py-0.5 rounded font-medium border border-border">
          {data.resultsCount} results
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}

