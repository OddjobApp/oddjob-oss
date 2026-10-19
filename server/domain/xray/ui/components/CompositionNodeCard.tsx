import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { cn } from "@/lib/utils";
import "../styles/composition.css";
import {
  Monitor, Zap, Puzzle, Briefcase, GitBranch,
  Target, Database, Brain, Package, RefreshCw, Flag
} from "lucide-react";
import type { CompositionNodeType } from '../../types/composition';

const TYPE_CONFIG: Record<string, {
  icon: React.ElementType;
  accent: string;
  bg: string;
  badge: string;
}> = {
  screen:            { icon: Monitor,    accent: "#8b5cf6", bg: "bg-indigo-500/10",  badge: "Screen"    },
  api_endpoint:      { icon: Zap,        accent: "#10b981", bg: "bg-emerald-500/10", badge: "API"       },
  ui_component:      { icon: Puzzle,     accent: "#f59e0b", bg: "bg-amber-500/10",   badge: "Component" },
  job_definition:    { icon: Briefcase,  accent: "#3b82f6", bg: "bg-blue-500/10",    badge: "Job"       },
  pipeline:          { icon: GitBranch,  accent: "#06b6d4", bg: "bg-cyan-500/10",    badge: "Pipeline"  },
  mission:           { icon: Target,     accent: "#ef4444", bg: "bg-red-500/10",     badge: "Mission"   },
  operational_cycle: { icon: RefreshCw,  accent: "#ec4899", bg: "bg-pink-500/10",    badge: "Cycle"     },
  program:           { icon: Flag,       accent: "#f43f5e", bg: "bg-rose-500/10",    badge: "Program"   },
  dataset:           { icon: Database,   accent: "#84cc16", bg: "bg-lime-500/10",    badge: "Dataset"   },
  ontology_object_type: { icon: Brain,   accent: "#a855f7", bg: "bg-purple-500/10",  badge: "Ontology"  },
  ontology_action:   { icon: Zap,        accent: "#f97316", bg: "bg-orange-500/10",  badge: "Action"    },
  ontology_link_type: { icon: GitBranch, accent: "#14b8a6", bg: "bg-teal-500/10",    badge: "Link"      },
  knowledge_cluster: { icon: Brain,      accent: "#6366f1", bg: "bg-indigo-500/10",  badge: "Knowledge" },
  agent:             { icon: Brain,      accent: "#f472b6", bg: "bg-pink-500/10",    badge: "Agent"     },
  supervisor:        { icon: Target,     accent: "#6366f1", bg: "bg-indigo-500/10",  badge: "Supervisor"},
  npm_module:        { icon: Package,    accent: "#94a3b8", bg: "bg-muted/10",   badge: "Module"    },
};

export interface CompositionNodeData {
  id: string;
  type: CompositionNodeType;
  label: string;
  description?: string;
  filePath?: string;
  dbId?: number;
  metadata: Record<string, unknown>;
  selected?: boolean;
  dimmed?: boolean;
}

export const CompositionNodeCard = memo(function CompositionNodeCard({ data, selected }: NodeProps<CompositionNodeData>) {
  const cfg = TYPE_CONFIG[data.type] ?? TYPE_CONFIG.npm_module;
  const Icon = cfg.icon;

  return (
    <div
      className={cn(
        "composition-node-card",
        selected ? "selected" : "unselected",
        data.dimmed && !selected && "opacity-25"
      )}
      style={{ 
        '--accent': cfg.accent
      } as React.CSSProperties}
    >
      {/* Left accent bar */}
      <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-[var(--accent)]" />

      <div className="pl-4 pr-3 py-3 flex items-start gap-2.5">
        {/* Icon */}
        <div className={cn("mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center", cfg.bg)}>
          <Icon className="w-3.5 h-3.5 text-[var(--accent)]" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-[11px] font-bold text-foreground truncate leading-tight">{data.label}</p>
          {data.description && (
            <p className="text-[9px] text-foreground/40 truncate leading-tight">{data.description}</p>
          )}
          <span
            className="composition-node-badge"
            style={{ '--accent-dim': `${cfg.accent}20` } as React.CSSProperties}
          >
            {cfg.badge}
          </span>
        </div>
      </div>

      {/* ReactFlow handles */}
      <Handle type="target" position={Position.Left}  className="!w-2 !h-2 !bg-foreground/20 !border-foreground/10" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-foreground/20 !border-foreground/10" />
    </div>
  );
});

export default CompositionNodeCard;
