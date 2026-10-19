import React from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  X, ExternalLink, Monitor, Zap, Puzzle, Briefcase, GitBranch, Target,
  Database, Brain, Package, Activity, Layers, FileText, ArrowLeftRight, Code, Loader2, BookOpen
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { cn } from "@/lib/utils";
import "../styles/composition.css";
import type { CompositionNode } from '../../types/composition';
import { NodeDocEditor } from "./NodeDocEditor";
import { NodeDependenciesView } from "./NodeDependenciesView";
import { NodeTechnicalSpecsView } from "./NodeTechnicalSpecsView";
import { NodeTelemetryView } from "./NodeTelemetryView";

interface Props {
  scope: string;
  node: CompositionNode | null;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  screen:             Monitor,
  api_endpoint:       Zap,
  ui_component:       Puzzle,
  job_definition:     Briefcase,
  pipeline:           GitBranch,
  mission:            Target,
  agent:              Brain,
  supervisor:         Target,
  dataset:            Database,
  knowledge_cluster:  Brain,
  npm_module:         Package,
  operational_cycle:  Activity,
  program:            Activity,
  skill:              Layers,
};

const TYPE_COLOR: Record<string, string> = {
  screen:             "#6366f1",
  api_endpoint:       "#10b981",
  ui_component:       "#8b5cf6",
  job_definition:     "#f59e0b",
  pipeline:           "#3b82f6",
  mission:            "#ec4899",
  agent:              "#f472b6",
  supervisor:         "#6366f1",
  dataset:            "#14b8a6",
  knowledge_cluster:  "#a855f7",
  npm_module:         "#6b7280",
  operational_cycle:  "#f97316",
  program:            "#f97316",
  skill:              "#22d3ee",
};

const JUMP_TARGETS: Record<string, (node: CompositionNode) => string | null> = {
  job_definition:    n => n.dbId ? `/jobs/${n.dbId}` : null,
  pipeline:          n => n.dbId ? `/pipelines/${n.dbId}` : null,
  mission:           n => n.dbId ? `/missions/${n.dbId}` : null,
  agent:             n => n.dbId ? `/jobs/${n.dbId}` : null,
  supervisor:        n => n.dbId ? `/jobs/${n.dbId}` : null,
  dataset:           n => n.dbId ? `/knowledge/datasets/${n.dbId}` : null,
  knowledge_cluster: n => n.dbId ? `/knowledge?topic=${n.dbId}` : null,
  operational_cycle: n => n.dbId ? `/operations/cycles/${n.dbId}` : null,
  program:           n => n.dbId ? `/operations/cycles/${n.dbId}` : null,
};

export function NodeDetailDrawer({ scope, node, onClose, onSelectNode }: Props) {
  const [, setLocation] = useLocation();

  const { data: detailData, isLoading, refetch } = useQuery({
    queryKey: ["/api/xray/composition", scope, "node-detail", node?.id],
    queryFn: async () => {
      if (!node) return null;
      const res = await apiRequest("GET", `/api/xray/composition/${scope}/node-detail?nodeId=${encodeURIComponent(node.id)}`);
      return res.json();
    },
    enabled: !!node,
    staleTime: 30_000,
  });

  if (!node) return null;

  const Icon = TYPE_ICON[node.type] ?? Package;
  const accent = TYPE_COLOR[node.type] ?? "#6b7280";
  const jumpPath = JUMP_TARGETS[node.type]?.(node);

  const documentation = detailData?.documentation ?? {
    summary: node.description,
    content: "",
    status: "draft" as const,
    tags: [node.type],
    isAiGenerated: false,
  };

  const inbound = detailData?.inbound ?? [];
  const outbound = detailData?.outbound ?? [];
  const specs = detailData?.specs ?? node.metadata ?? {};
  const telemetry = detailData?.telemetry ?? {};

  return (
    <div className="flex flex-col h-full bg-background border-l border-foreground/10">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-foreground/10">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="node-icon-container"
              style={{
                '--bg-dim': `${accent}20`
              } as React.CSSProperties}
            >
              <Icon className="w-4 h-4 text-[var(--accent)]" style={{ color: accent } as React.CSSProperties} />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-black text-foreground leading-tight truncate">{node.label}</p>
              {node.description && (
                <p className="text-[9px] text-foreground/40 truncate mt-0.5">{node.description}</p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="flex-shrink-0 w-7 h-7 hover:bg-foreground/5" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <Badge
            variant="outline"
            className="node-accent-badge"
            style={{ backgroundColor: `${accent}15`, color: accent }}
          >
            {node.type.replace(/_/g, " ")}
          </Badge>
          {node.dbId && (
            <span className="text-[8px] text-foreground/30 font-mono">#{node.dbId}</span>
          )}
          {isLoading && (
            <span className="text-[9px] text-purple-400 flex items-center gap-1 ml-auto">
              <Loader2 className="w-3 h-3 animate-spin" /> Fetching details...
            </span>
          )}
        </div>
      </div>

      {/* Multi-Tab Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        <Tabs defaultValue="overview" className="flex-1 flex flex-col">
          <div className="px-4 border-b border-foreground/10 flex-shrink-0">
            <TabsList className="bg-transparent h-9 p-0 gap-4 border-b-0">
              <TabsTrigger
                value="overview"
                className="text-[10px] uppercase font-bold tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-transparent px-0 py-2"
              >
                <FileText className="w-3 h-3 mr-1" /> Overview & Docs
              </TabsTrigger>
              <TabsTrigger
                value="dependencies"
                className="text-[10px] uppercase font-bold tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-transparent px-0 py-2"
              >
                <ArrowLeftRight className="w-3 h-3 mr-1" /> Connections ({inbound.length + outbound.length})
              </TabsTrigger>
              <TabsTrigger
                value="specs"
                className="text-[10px] uppercase font-bold tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-transparent px-0 py-2"
              >
                <Code className="w-3 h-3 mr-1" /> Specs & Code
              </TabsTrigger>
              <TabsTrigger
                value="telemetry"
                className="text-[10px] uppercase font-bold tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-transparent px-0 py-2"
              >
                <Activity className="w-3 h-3 mr-1" /> Telemetry
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 px-4 py-2">
            <TabsContent value="overview" className="m-0 focus-visible:outline-none">
              <NodeDocEditor
                scope={scope}
                node={node}
                documentation={documentation}
                onDocUpdated={refetch}
              />
            </TabsContent>

            <TabsContent value="dependencies" className="m-0 focus-visible:outline-none">
              <NodeDependenciesView
                inbound={inbound}
                outbound={outbound}
                onSelectNode={onSelectNode}
              />
            </TabsContent>

            <TabsContent value="specs" className="m-0 focus-visible:outline-none">
              <NodeTechnicalSpecsView
                node={node}
                specs={specs}
              />
            </TabsContent>

            <TabsContent value="telemetry" className="m-0 focus-visible:outline-none">
              <NodeTelemetryView
                telemetry={telemetry}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* Footer action */}
      <div className="flex-shrink-0 p-3 border-t border-foreground/10 space-y-1.5">
        {documentation.knowledgeTopicId && (
          <Button
            variant="outline"
            className="w-full h-7 text-[9px] font-black uppercase tracking-widest border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            onClick={() => { onClose(); setLocation(`/knowledge?topic=${documentation.knowledgeTopicId}`); }}
          >
            <BookOpen className="w-3 h-3 mr-1.5" />
            Open in Knowledge Base
          </Button>
        )}
        {jumpPath && (
          <Button
            className="w-full h-8 text-[10px] font-black uppercase tracking-widest"
            style={{ backgroundColor: accent }}
            onClick={() => { onClose(); setLocation(jumpPath); }}
          >
            <ExternalLink className="w-3 h-3 mr-2" />
            Open {node.type.replace(/_/g, " ")}
          </Button>
        )}
      </div>
    </div>
  );
}
