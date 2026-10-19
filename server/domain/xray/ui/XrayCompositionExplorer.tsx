/**
 * Xray Composition Explorer
 *
 * Figma Flow-style dependency graph for Oddjob platform and forged apps.
 * Three-panel layout: scope/filter sidebar → ReactFlow canvas → node detail drawer.
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  MarkerType,
  Panel,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor, Zap, Puzzle, Briefcase, GitBranch,
  Target, Database, Brain, Package, Search,
  LayoutGrid, Rows, Copy, Check, ChevronDown,
  Cpu, Layers, RefreshCw, Flag, Loader2, AlertTriangle
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { cn } from "@/lib/utils";
import "./styles/composition.css";
import { CompositionNodeCard } from './components/CompositionNodeCard';
import { NodeDetailDrawer } from './components/NodeDetailDrawer';
import { useSearch } from "wouter";
import type { CompositionGraph, CompositionNode, CompositionEdge, CompositionScope, CompositionNodeType } from '../types/composition';

// ─── Types ────────────────────────────────────────────────────────────────────

const NODE_TYPES = { composition: CompositionNodeCard };

const TYPE_ORDER: CompositionNodeType[] = [
  "screen", "api_endpoint", "ui_component",
  "job_definition",
  "pipeline",
  "mission",
  "operational_cycle",
  "program",
  "agent",
  "supervisor",
  "skill",
  "dataset",
  "ontology_object_type",
  "ontology_action",
  "ontology_link_type",
  "knowledge_cluster",
  "npm_module",
];

const TYPE_LABELS: Record<string, string> = {
  screen: "Screen",
  api_endpoint: "API",
  ui_component: "Component",
  job_definition: "Job",
  pipeline: "Pipeline",
  mission: "Mission",
  operational_cycle: "Cycle",
  program: "Program",
  agent: "Agent",
  supervisor: "Supervisor",
  skill: "Skill",
  dataset: "Dataset",
  ontology_object_type: "Ontology Type",
  ontology_action: "Action",
  ontology_link_type: "Link Type",
  knowledge_cluster: "Knowledge",
  npm_module: "Module",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  screen:            Monitor,
  api_endpoint:      Zap,
  ui_component:      Puzzle,
  job_definition:    Briefcase,
  pipeline:          GitBranch,
  mission:           Target,
  operational_cycle: RefreshCw,
  program:           Flag,
  agent:             Brain,
  supervisor:        Target,
  skill:             Layers,
  dataset:           Database,
  ontology_object_type: Layers,
  ontology_action:   Zap,
  ontology_link_type: GitBranch,
  knowledge_cluster: Brain,
  npm_module:        Package,
};

const TYPE_ACCENT: Record<string, string> = {
  screen: "#8b5cf6",
  api_endpoint: "#10b981",
  ui_component: "#f59e0b",
  job_definition: "#3b82f6",
  pipeline: "#06b6d4",
  mission: "#ef4444",
  operational_cycle: "#ec4899",
  program: "#f43f5e",
  agent: "#f472b6",
  supervisor: "#6366f1",
  skill: "#22d3ee",
  dataset: "#84cc16",
  ontology_object_type: "#a855f7",
  ontology_action: "#f97316",
  ontology_link_type: "#14b8a6",
  knowledge_cluster: "#6366f1",
  npm_module: "#94a3b8",
};

// ─── Layout helpers ───────────────────────────────────────────────────────────

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "LR" | "TB"
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 100 });

  nodes.forEach(n => g.setNode(n.id, { width: 240, height: 120 }));
  edges.forEach(e => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return {
    nodes: nodes.map(n => {
      const pos = g.node(n.id);
      return { ...n, position: { x: pos.x - 120, y: pos.y - 60 } };
    }),
    edges,
  };
}

function toReactFlowNodes(
  graphNodes: CompositionNode[],
  selected: string | null,
  dimmed: Set<string>
): Node[] {
  return graphNodes.map(n => ({
    id: n.id,
    type: "composition",
    position: { x: 0, y: 0 },
    data: {
      ...n,
      selected: n.id === selected,
      dimmed: dimmed.size > 0 && dimmed.has(n.id),
    },
  }));
}

function toReactFlowEdges(graphEdges: CompositionEdge[]): Edge[] {
  return graphEdges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "smoothstep",
    animated: e.relation === "CALLS_API" || e.relation === "TRIGGERS" || e.relation === "WRITES_TO",
    // Keep relationship lines visible in both themes and when a large graph is
    // zoomed out. Without non-scaling-stroke, fitView can reduce a 1.5px edge
    // to a nearly invisible fraction of a pixel.
    style: {
      stroke: "hsl(var(--foreground))",
      strokeOpacity: 0.45,
      strokeWidth: 1.5,
      vectorEffect: "non-scaling-stroke",
    },
    labelStyle: {
      fontSize: 8,
      fill: "hsl(var(--foreground))",
      fontWeight: "900" as const,
    },
    labelBgStyle: { fill: "hsl(var(--background))", fillOpacity: 0.92 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--foreground))" },
  }));
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  /** If provided, locks the scope and hides the scope selector (used in AppDetail tab) */
  fixedScope?: string;
  /** If true, hides the outer page shell (used as an embedded tab) */
  embedded?: boolean;
}

export default function XrayCompositionExplorer({ fixedScope, embedded = false }: Props) {
  const searchString = useSearch();

  const getUrlScope = () => {
    if (typeof window === "undefined") return undefined;
    const params = new URLSearchParams(searchString || window.location.search);
    return params.get("scope") || params.get("appId") || undefined;
  };

  const [scope, setScope] = useState<string>(() => fixedScope ?? getUrlScope() ?? "oddjob");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"LR" | "TB">("LR");
  const [activeTypes, setActiveTypes] = useState<Set<CompositionNodeType>>(new Set(TYPE_ORDER));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dimmedNodes, setDimmedNodes] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (fixedScope) return;
    const params = new URLSearchParams(searchString || window.location.search);
    const urlScope = params.get("scope") || params.get("appId");
    if (urlScope && urlScope !== scope) {
      setScope(urlScope);
    }
  }, [searchString, fixedScope]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // ── Queries ──
  const { data: scopes = [] } = useQuery<CompositionScope[]>({
    queryKey: ["/api/xray/composition/scopes"],
    queryFn: async () => (await apiRequest("GET", "/api/xray/composition/scopes")).json(),
    staleTime: 30_000,
    enabled: !fixedScope,
  });

  const activeTypesList = Array.from(activeTypes);
  const { data: graph, isLoading, isError, refetch } = useQuery<CompositionGraph>({
    queryKey: ["/api/xray/composition", scope, activeTypesList],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeTypesList.length) params.set("types", activeTypesList.join(","));
      params.set("skipCache", "true");
      const res = await apiRequest("GET", `/api/xray/composition/${scope}?${params.toString()}`);
      return res.json();
    },
    staleTime: 300_000,
    retry: 1,
  });

  const reindexMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/xray/composition/reindex`);
    },
    onSuccess: () => {
      toast({ title: "Re-indexing complete", description: "The composition graph has been refreshed." });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Re-indexing failed", description: err.message, variant: "destructive" });
    }
  });

  // ── Filter & layout ──
  const filteredGraph = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    const sq = search.toLowerCase();
    const filtered = graph.nodes.filter(n =>
      activeTypes.has(n.type) &&
      (!sq || n.label.toLowerCase().includes(sq) || n.description?.toLowerCase().includes(sq))
    );
    const filteredIds = new Set(filtered.map(n => n.id));
    const edges = graph.edges.filter(e => filteredIds.has(e.source) && filteredIds.has(e.target));
    return { nodes: filtered, edges };
  }, [graph, activeTypes, search]);

  useEffect(() => {
    if (!filteredGraph.nodes.length) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }
    const rfN = toReactFlowNodes(filteredGraph.nodes, selectedNodeId, dimmedNodes);
    const rfE = toReactFlowEdges(filteredGraph.edges);
    const laid = applyDagreLayout(rfN, rfE, direction);
    setRfNodes(laid.nodes);
    setRfEdges(laid.edges);
  }, [filteredGraph, direction, selectedNodeId, dimmedNodes]);

  // ── Node selection → highlight neighbours ──
  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    const nodeId = node.id;
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
      setDimmedNodes(new Set());
      return;
    }
    setSelectedNodeId(nodeId);
    const neighbours = new Set<string>([nodeId]);
    filteredGraph.edges.forEach(e => {
      if (e.source === nodeId) neighbours.add(e.target);
      if (e.target === nodeId) neighbours.add(e.source);
    });
    const dimmed = new Set(filteredGraph.nodes.map(n => n.id).filter(id => !neighbours.has(id)));
    setDimmedNodes(dimmed);
  }, [selectedNodeId, filteredGraph]);

  const selectedNode = useMemo(
    () => graph?.nodes.find(n => n.id === selectedNodeId) ?? null,
    [graph, selectedNodeId]
  );

  const toggleType = (t: CompositionNodeType) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
    setSelectedNodeId(null);
    setDimmedNodes(new Set());
  };

  const copyMermaid = async () => {
    const res = await apiRequest("GET", `/api/xray/composition/${scope}/mermaid`);
    const { mermaid } = await res.json();
    await navigator.clipboard.writeText(mermaid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentScope = scopes.find(s => s.id === scope);
  const nodeCounts = useMemo(() => {
    const map = new Map<CompositionNodeType, number>();
    graph?.nodes.forEach(n => map.set(n.type, (map.get(n.type) ?? 0) + 1));
    return map;
  }, [graph]);

  // ── Render ──
  const content = (
    <div className="flex h-full min-h-0">

      {/* ── LEFT SIDEBAR ── */}
      <div className="flex-shrink-0 w-56 flex flex-col border-r border-foreground/10 bg-background">
        {/* Scope selector */}
        {!fixedScope && (
          <div className="p-3 border-b border-foreground/10">
            <p className="text-[8px] font-black uppercase tracking-widest text-foreground/30 mb-1.5">Scope</p>
            <button
              onClick={() => setScopeOpen(v => !v)}
              className="w-full flex items-center justify-between gap-1.5 p-2.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span className="text-[10px] font-bold text-foreground truncate">
                  {currentScope?.name ?? scope}
                </span>
              </div>
              <ChevronDown className={cn("w-3 h-3 text-foreground/40 flex-shrink-0 transition-transform", scopeOpen && "rotate-180")} />
            </button>

            <AnimatePresence>
              {scopeOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-1.5 rounded-lg border border-foreground/10 bg-background overflow-hidden"
                >
                  {scopes.map(s => (
                    <button
                      key={s.id}
                      onClick={() => { setScope(s.id); setScopeOpen(false); setSelectedNodeId(null); setDimmedNodes(new Set()); }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-[10px] hover:bg-foreground/5 transition-colors border-b border-foreground/5 last:border-0",
                        s.id === scope ? "text-primary font-bold" : "text-foreground/70"
                      )}
                    >
                      {s.name}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Search */}
        <div className="p-3 border-b border-foreground/10">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/30" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search nodes..."
              className="h-7 pl-7 text-[10px] bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/30"
            />
          </div>
        </div>

        {/* Type filters */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="text-[8px] font-black uppercase tracking-widest text-foreground/30 mb-2">Node Types</p>
          {TYPE_ORDER.map(t => {
            const Icon = TYPE_ICONS[t];
            const active = activeTypes.has(t);
            const count = nodeCounts.get(t) ?? 0;
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-left",
                  active ? "bg-foreground/5" : "opacity-40 hover:opacity-60"
                )}
              >
                <div
                  className="type-filter-icon-container"
                  style={{ 
                    '--bg-opacity': active ? `${TYPE_ACCENT[t]}20` : "transparent"
                  } as React.CSSProperties}
                >
                  <Icon className="w-2.5 h-2.5" style={{ color: active ? TYPE_ACCENT[t] : "rgba(255,255,255,0.4)" } as React.CSSProperties} />
                </div>
                <span className="text-[9px] font-bold text-foreground/80 flex-1">{TYPE_LABELS[t]}</span>
                {count > 0 && (
                  <span className="text-[8px] text-foreground/30 font-mono">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── CANVAS ── */}
      <div className="flex-1 min-w-0 relative bg-background">
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] space-y-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin opacity-50" />
            <div className="text-center">
              <p className="text-xl font-medium text-foreground/80">Resolving System Composition...</p>
              <p className="text-sm text-muted-foreground">Tracing architectural dependencies and strategic lineage</p>
            </div>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] space-y-6">
            <AlertTriangle className="w-16 h-16 text-destructive opacity-50" />
            <div className="text-center space-y-2">
              <p className="text-2xl font-bold text-foreground">Explorer Disconnected</p>
              <p className="text-muted-foreground max-w-md mx-auto">
                The X-Ray service encountered an error while constructing the graph.
                This often happens with very large datasets or timeout issues.
              </p>
            </div>
            <Button onClick={() => refetch()} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Attempt Reconnection
            </Button>
          </div>
        )}

        {/* Graph error banner */}
        {!isLoading && !isError && graph?.error && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-md">
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-950/80 border border-red-500/30 text-[9px] text-red-300">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5 text-red-400" />
              <span><strong>Graph build error:</strong> {graph.error}</span>
            </div>
          </div>
        )}

        {/* Nodes present but no edges */}
        {!isLoading && !isError && (graph?.nodes.length ?? 0) > 0 && filteredGraph.edges.length === 0 && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-10">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/90 border border-foreground/10 text-[9px] text-foreground/40">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 text-amber-500/60" />
              <span>
                {graph?.nodes.length} nodes loaded, 0 relationships.
                {' '}Run <strong className="text-foreground/60">Re-index</strong> (⚙ icon) or check
                {' '}<code className="text-foreground/50">/api/xray/composition/diagnostics</code>
                {' '}to see what data is available.
              </span>
            </div>
          </div>
        )}

        {!isLoading && !isError && graph?.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center space-y-2">
              <LayoutGrid className="w-10 h-10 text-foreground/20 mx-auto" />
              <p className="text-[11px] text-foreground/40">No entities found for this scope.</p>
              <p className="text-[9px] text-foreground/20">
                {graph?.error
                  ? `Error: ${graph.error}`
                  : "Forge an app first, or check your org permissions."}
              </p>
              <button
                onClick={() => reindexMutation.mutate()}
                disabled={reindexMutation.isPending}
                className="mt-2 text-[9px] text-primary/60 hover:text-primary transition-colors underline"
              >
                {reindexMutation.isPending ? "Re-indexing..." : "Run Re-index"}
              </button>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={() => { setSelectedNodeId(null); setDimmedNodes(new Set()); }}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          maxZoom={2}
          attributionPosition="bottom-right"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(255,255,255,0.03)" gap={24} />
          <Controls className="!bg-background !border-foreground/10" />
          <MiniMap
            nodeColor={n => TYPE_ACCENT[(n.data as any)?.type] ?? "#6b7280"}
            maskColor="rgba(0,0,0,0.7)"
            className="!bg-background !border-foreground/10 !rounded-xl overflow-hidden"
          />

          {/* Toolbar */}
          <Panel position="top-right" className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 bg-background border border-foreground/10 hover:bg-foreground/5"
              onClick={() => setDirection(d => d === "LR" ? "TB" : "LR")}
              title={direction === "LR" ? "Switch to top-down layout" : "Switch to left-right layout"}
            >
              {direction === "LR" ? <Rows className="w-3.5 h-3.5 text-foreground/60" /> : <LayoutGrid className="w-3.5 h-3.5 text-foreground/60" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 bg-background border border-foreground/10 hover:bg-foreground/5"
              onClick={copyMermaid}
              title="Copy as Mermaid diagram"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-foreground/60" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 bg-background border border-foreground/10 hover:bg-foreground/5"
              onClick={() => refetch()}
              title="Reload from cache"
            >
              <RefreshCw className="w-3.5 h-3.5 text-foreground/60" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 bg-background border border-foreground/10 hover:bg-foreground/5"
              onClick={() => reindexMutation.mutate()}
              disabled={reindexMutation.isPending}
              title="Re-index all relationships now"
            >
              <Cpu className={cn("w-3.5 h-3.5 text-foreground/60", reindexMutation.isPending && "animate-spin text-primary")} />
            </Button>
          </Panel>
        </ReactFlow>
      </div>

      {/* ── RIGHT DRAWER ── */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 360, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="flex-shrink-0 overflow-hidden"
          >
            <NodeDetailDrawer
              scope={scope}
              node={selectedNode}
              onClose={() => { setSelectedNodeId(null); setDimmedNodes(new Set()); }}
              onSelectNode={(nodeId) => {
                setSelectedNodeId(nodeId);
                const neighbours = new Set<string>([nodeId]);
                filteredGraph.edges.forEach(e => {
                  if (e.source === nodeId) neighbours.add(e.target);
                  if (e.target === nodeId) neighbours.add(e.source);
                });
                const dimmed = new Set(filteredGraph.nodes.map(n => n.id).filter(id => !neighbours.has(id)));
                setDimmedNodes(dimmed);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );

  if (embedded) return <div className="h-full min-h-[600px] flex flex-col">{content}</div>;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Page header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-foreground/10 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Cpu className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-[13px] font-black uppercase tracking-widest text-foreground">X-Ray</h1>
          <p className="text-[9px] text-foreground/40 font-medium">Composition &amp; dependency flow</p>
        </div>
        {graph && (
          <Badge variant="outline" className="ml-auto text-[8px] font-black border-foreground/10 text-foreground/40">
            {graph.scope.name}
          </Badge>
        )}
      </div>

      <div className="flex-1 min-h-0">{content}</div>
    </div>
  );
}
