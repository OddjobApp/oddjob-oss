/**
 * Knowledge Graph Explorer Page
 * 
 * Main page component for visualizing and navigating knowledge graph relationships.
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KnowledgeEdge, KnowledgeNode } from "@shared/schema/knowledge/graph";
import { Loader2 } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
const KnowledgeTimeline = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/KnowledgeTimeline"));
const KnowledgeMatrix = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/KnowledgeMatrix"));
const InspectorPanel = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/InspectorPanel"));
const SemanticGraph3D = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/SemanticGraph3D").then(m => ({ default: m.SemanticGraph3D })));
const KnowledgeWorkbench = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/KnowledgeWorkbench").then(m => ({ default: m.KnowledgeWorkbench })));
const KnowledgeChat = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/KnowledgeChat").then(m => ({ default: m.KnowledgeChat })));
const NodeEditDialog = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/NodeEditDialog"));
const EdgeEditDialog = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/EdgeEditDialog"));
const SankeyDiagram = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/SankeyDiagram").then(m => ({ default: m.SankeyDiagram })));
const KnowledgeTreeMap = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/KnowledgeTreeMap"));
const KnowledgePivot = React.lazy(() => import("@domain-ui/knowledge/ui/components/knowledge/KnowledgePivot"));

import { apiRequest } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@domain-ui/core/ui/components/ui/alert-dialog";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@domain-ui/core/ui/components/ui/resizable";
import { ImpactAnalysisModal } from "@domain-ui/knowledge/ui/components/knowledge/graph/ImpactAnalysisModal";
import { KnowledgeGraphToolbar } from "@domain-ui/knowledge/ui/components/knowledge/KnowledgeGraphToolbar";
import { KnowledgeGraphFilters } from "@domain-ui/knowledge/ui/components/knowledge/KnowledgeGraphFilters";

import { useKnowledgeFilters } from "@domain-ui/knowledge/ui/modules/knowledge/hooks/useKnowledgeFilters";
import { useKnowledgeData } from "@domain-ui/knowledge/ui/modules/knowledge/hooks/useKnowledgeData";

// View Modes

export interface KnowledgeGraphProps {
  context?: {
    type: 'global' | 'run' | 'dataset';
    id?: number;
  };
}

// View Modes
// View Modes
type ViewMode = 'graph' | 'schema' | 'staging' | 'timeline' | 'matrix' | '3d' | 'flow' | 'tree' | 'pivot';
type ViewContext = 'global' | 'run' | 'dataset';


// Error Boundary Component
class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("KnowledgeGraph Crash:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-red-600 bg-red-50 h-full w-full border-4 border-red-200 m-4 rounded-lg overflow-auto">
          <h1 className="text-2xl font-bold mb-4">Something went wrong.</h1>
          <pre className="text-sm font-mono whitespace-pre-wrap">{this.state.error?.toString()}</pre>
          <pre className="text-xs font-mono whitespace-pre-wrap mt-4 text-muted-foreground">{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function KnowledgeGraph({ context }: KnowledgeGraphProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 1. Hook into Filters and Search State
  const filters = useKnowledgeFilters({ initialContext: context });

  // 2. State for Local UI interactions
  const [pagination, setPagination] = useState({ pageIndex: 1, pageSize: 50 });
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isWorkbenchOpen, setIsWorkbenchOpen] = useState(false);
  const [selectedWorkbenchNodes, setSelectedWorkbenchNodes] = useState<KnowledgeNode[]>([]);
  const [isTruncated, setIsTruncated] = useState(false);
  const [colorMode, setColorMode] = useState<"type" | "sentiment" | "source">("type");
  const [expansionDepth, setExpansionDepth] = useState(1);
  const [isNodeDialogOpen, setIsNodeDialogOpen] = useState(false);
  const [isEdgeDialogOpen, setIsEdgeDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isImpactModalOpen, setIsImpactModalOpen] = useState(false);
  const [selectedNodeIdForImpact, setSelectedNodeIdForImpact] = useState<number | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(true);

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [maxNodes, setMaxNodes] = useState(500);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    if (mobileQuery.matches) {
      setIsChatOpen(false);
    }
  }, []);

  // 3. Hook into Data Fetching
  const queryData = useKnowledgeData({
    activeDatasetId: filters.activeDatasetId,
    searchQuery: filters.searchQuery,
    sourceLabel: filters.sourceLabel,
    relation: filters.relation,
    targetLabel: filters.targetLabel,
    targetFilter: filters.targetFilter,
    viewMode: filters.viewMode,
    viewContext: filters.viewContext,
    selectedRunId: filters.selectedRunId,
    pagination: pagination
  });

  const { nodes, edges, stagingNodes, matrixSummary, runContextData, isLoading, pipelines, datasets, executions } = queryData;

  // Staging Actions
  const approveNodeMutation = useMutation({
    mutationFn: async (nodeId: number) => {
      await apiRequest("PATCH", `/api/knowledge-graph/nodes/${nodeId}`, { verificationStatus: "verified" });
    },
    onSuccess: () => {
      toast({ title: "Node Approved", description: "Node moved to verified graph." });
      queryData.refetchAll();
    }
  });

  const rejectNodeMutation = useMutation({
    mutationFn: async (nodeId: number) => {
      await apiRequest("DELETE", `/api/knowledge-graph/nodes/${nodeId}`);
    },
    onSuccess: () => {
      toast({ title: "Node Rejected", description: "Node deleted." });
      queryData.refetchAll();
    }
  });

  // Data Transformations
  const { nodesData, edgesData } = useMemo(() => {
    let n: KnowledgeNode[] = [];
    let e: KnowledgeEdge[] = [];

    if (filters.viewContext === 'run' && runContextData) {
      n = runContextData.nodes || [];
      e = runContextData.edges || [];
    } else {
      n = nodes || [];
      e = edges || [];
    }

    return {
      nodesData: Array.isArray(n) ? n : [],
      edgesData: Array.isArray(e) ? e : []
    };
  }, [filters.viewContext, runContextData, nodes, edges]);

  const graphStats = useMemo(() => {
    if (!nodesData.length) return null;
    const counts: Record<string, number> = {};
    nodesData.forEach(node => {
      if (node.label) {
        counts[node.label] = (counts[node.label] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [nodesData]);

  const sankeyData = useMemo(() => {
    if (!nodesData.length || !edgesData.length) return { nodes: [], links: [] };

    // De-duplicate labels for Sankey nodes
    const labels = Array.from(new Set(nodesData.map(n => n.label))).filter(Boolean);
    const nodesRef = labels.map(l => ({ id: l, name: l }));

    const nodeMap = new Map(nodesData.map(n => [n.id, n.label]));
    const labelLinks = new Map();

    // 1. Build initial links by label
    edgesData.forEach(edge => {
      const sourceLabel = nodeMap.get(edge.sourceId);
      const targetLabel = nodeMap.get(edge.targetId);

      if (sourceLabel && targetLabel && sourceLabel !== targetLabel) {
        const key = `${sourceLabel}-${targetLabel}`;
        if (!labelLinks.has(key)) {
          labelLinks.set(key, {
            source: sourceLabel,
            target: targetLabel,
            value: 1,
            relation: edge.relation
          });
        } else {
          labelLinks.get(key).value += 1;
        }
      }
    });

    // 2. Cycle-Breaking Algorithm (Greedy DFS)
    // Recharts Sankey MUST be a DAG. Higher-order cycles crash it.
    const finalLinks: any[] = [];
    const adj = new Map<string, string[]>();
    labelLinks.forEach(link => {
      if (!adj.has(link.source)) adj.set(link.source, []);
      adj.get(link.source)!.push(link.target);
    });

    const hasCycle = (u: string, visited: Set<string>, recStack: Set<string>): boolean => {
      visited.add(u);
      recStack.add(u);

      const neighbors = adj.get(u) || [];
      for (const v of neighbors) {
        if (!visited.has(v)) {
          if (hasCycle(v, visited, recStack)) return true;
        } else if (recStack.has(v)) {
          return true;
        }
      }

      recStack.delete(u);
      return false;
    };

    // We'll iterate through links and only keep them if they don't complete a cycle
    // Note: Simple heuristic. For a better layout we might want to reverse back-edges
    // but for Sankey "flow" analysis, removing back-edges is safer for visualization.
    const visitedNodes = new Set<string>();
    const currentPath = new Set<string>();
    const tempAdj = new Map<string, string[]>();

    labelLinks.forEach(link => {
      // Check if adding this link creates a cycle in our ALREADY added links
      const sources = [link.source];
      const visited = new Set<string>();
      const queue = [link.target];
      let cycleFound = false;

      // BFS to see if source is reachable from target
      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === link.source) {
          cycleFound = true;
          break;
        }
        if (!visited.has(curr)) {
          visited.add(curr);
          const neighbors = tempAdj.get(curr) || [];
          queue.push(...neighbors);
        }
      }

      if (!cycleFound) {
        finalLinks.push(link);
        if (!tempAdj.has(link.source)) tempAdj.set(link.source, []);
        tempAdj.get(link.source)!.push(link.target);
      } else {
        console.warn(`[Sankey] Breaking cycle: ${link.source} -> ${link.target}`);
      }
    });

    return { nodes: nodesRef, links: finalLinks };
  }, [nodesData, edgesData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const docId = params.get('documentId');
    const nodeId = params.get('nodeId');
    if (nodeId && nodesData.length > 0) {
      const node = nodesData.find(n => n.id.toString() === nodeId);
      if (node) { setSelectedNode(node); setIsInspectorOpen(true); }
    } else if (docId && nodesData.length > 0) {
      const node = nodesData.find(n => n.knowledgeDocumentId?.toString() === docId);
      if (node) { setSelectedNode(node); setIsInspectorOpen(true); }
    }
  }, [nodesData]);

  // Search functionality (Standard + NLQ)
  const searchMutation = useMutation({
    mutationFn: async (queryOrOpts: string | { query?: string, label?: string }) => {
      const query = typeof queryOrOpts === 'string' ? queryOrOpts : (queryOrOpts.query || "");
      const label = typeof queryOrOpts === 'object' ? queryOrOpts.label : filters.sourceLabel;

      if (filters.isNLQMode) {
        const res = await apiRequest("POST", "/api/knowledge-graph/search/natural", { query });
        return res.json();
      }

      const params = new URLSearchParams();
      if (query) params.append("sourceFilter", query);
      if (label) params.append("sourceLabel", label);
      if (filters.relation) params.append("relation", filters.relation);
      if (filters.targetLabel) params.append("targetLabel", filters.targetLabel);
      if (filters.targetFilter) params.append("targetFilter", filters.targetFilter);

      params.append("limit", "20");
      const res = await apiRequest("GET", `/api/knowledge-graph/search?${params.toString()}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (filters.isNLQMode) {
        const { parsed, nodes: rawNodes } = data;
        const mappedResults = rawNodes.map((n: any) => ({ source: n, edge: null, target: null }));
        setSearchResults(mappedResults);
        toast({ title: "AI Search", description: `Found ${rawNodes.length} results for: ${parsed.query}` });
        return;
      }
      setSearchResults(data);
      toast({ title: "Search Results", description: `Found ${data.length || 0} related items.` });
      setIsInspectorOpen(false);
    }
  });

  const handleSearch = () => {
    if (filters.searchQuery.trim()) {
      searchMutation.mutate(filters.searchQuery);
    }
  };

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: KnowledgeNode) => {
      const apiNode = nodesData.find((n) => n.id.toString() === node.id.toString());
      if (!apiNode) return;
      if (event.shiftKey) {
        setSelectedWorkbenchNodes(prev => prev.find(n => n.id === apiNode.id) ? prev.filter(n => n.id !== apiNode.id) : [...prev, apiNode]);
        setIsWorkbenchOpen(true);
      } else {
        setSelectedNode(apiNode);
        setIsInspectorOpen(true);
      }
    },
    [nodesData]
  );

  const handleExpandNeighbors = async () => {
    if (!selectedNode) return;
    try {
      await apiRequest("GET", `/api/knowledge-graph/expand/${selectedNode.id}?depth=${expansionDepth}`);
      // Adapting for non-ReactFlow requires a deeper state update logic if we want to "add" nodes to the view.
      // For now, we refetch to see updates if the expand operation modified the verified graph or if we want to show expanded view.
      queryData.refetchAll();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to expand neighbors", variant: "destructive" });
    }
  };

  const handleDeleteNode = async () => {
    if (!selectedNode) return;
    try {
      await apiRequest("DELETE", `/api/knowledge-graph/nodes/${selectedNode.id}`);
      toast({ title: "Success", description: "Node deleted successfully" });
      setIsInspectorOpen(false);
      setIsDeleteDialogOpen(false);
      setSelectedNode(null);
      queryData.refetchAll();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete node", variant: "destructive" });
      setIsDeleteDialogOpen(false);
    }
  };

  const handleFindRelated = () => {
    if (!selectedNode) return;
    const query = selectedNode.name;
    filters.setSearchQuery(query);
    searchMutation.mutate(query);
    toast({ title: "Searching Graph", description: `Looking for nodes related to "${query}"...` });
  };

  const handlePivot = (value: string) => {
    filters.setSearchQuery(value);
    searchMutation.mutate(value);
    setIsInspectorOpen(false);
    toast({ title: "Pivoting View", description: `Focusing investigation on "${value}"...` });
  };

  const handleRemoveFromWorkbench = (nodeId: number) => {
    setSelectedWorkbenchNodes(prev => prev.filter(n => n.id !== nodeId));
  };

  const handleClearWorkbench = () => {
    setSelectedWorkbenchNodes([]);
    setIsWorkbenchOpen(false);
  };

  const handleFocusNode = (node: KnowledgeNode) => {
    setSelectedNode(node);
    setIsInspectorOpen(true);
  };

  const handleShowImpact = (nodeId: number) => {
    setSelectedNodeIdForImpact(nodeId);
    setIsImpactModalOpen(true);
  };

  return (
    <ErrorBoundary>
      <div className="flex h-[calc(100dvh-7rem)] min-h-[560px] flex-col bg-background pt-0 sm:h-screen">
        <KnowledgeGraphToolbar
          viewMode={filters.viewMode}
          onViewModeChange={filters.setViewMode}
          searchQuery={filters.searchQuery}
          onSearchQueryChange={filters.setSearchQuery}
          onSearch={handleSearch}
          onFilterClick={() => setIsFilterOpen(true)}
          isChatOpen={isChatOpen}
          onChatToggle={() => setIsChatOpen(!isChatOpen)}
          exportData={nodesData}
          maxNodes={maxNodes}
          onMaxNodesChange={setMaxNodes}
        />

        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={75}>
            <div className="h-full flex flex-col relative overflow-hidden pb-3 sm:pb-0">
              <KnowledgeGraphFilters
                viewContext={filters.viewContext}
                onViewContextChange={filters.setViewContext}
                selectedRunId={filters.selectedRunId}
                onSelectedRunIdChange={filters.setSelectedRunId}
                selectedDatasets={filters.selectedDatasets}
                onSelectedDatasetsChange={filters.setSelectedDatasets}
                executions={executions}
                datasets={datasets}
              />

              <div className="flex-1 overflow-hidden relative rounded-xl border border-border/40 bg-background">
                <React.Suspense fallback={<div className="absolute inset-0 flex items-center justify-center bg-muted/50 backdrop-blur-sm z-50"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>}>
                  {filters.viewMode === '3d' && (
                    <SemanticGraph3D nodes={nodesData} edges={edgesData} onNodeClick={handleFocusNode} colorMode={colorMode} maxNodes={maxNodes} />
                  )}
                  {filters.viewMode === 'matrix' && (
                    <div className="absolute inset-0 p-3 sm:p-6">
                      {isLoading ? <Loader2 className="w-8 h-8 animate-spin mx-auto mt-20" /> : <KnowledgeMatrix nodes={nodesData} edges={edgesData} matrixSummary={matrixSummary} onNodeClick={(id: any) => { const n = nodesData.find(node => node.id.toString() === id.toString()); if (n) handleFocusNode(n); }} />}
                    </div>
                  )}
                  {filters.viewMode === 'timeline' && <div className="absolute inset-0 p-3 sm:p-6"><KnowledgeTimeline executions={executions || []} onExecutionClick={() => { }} /></div>}
                  {filters.viewMode === 'flow' && <div className="absolute inset-0 p-3 sm:p-6"><SankeyDiagram data={sankeyData} onLinkClick={() => { }} /></div>}
                  {filters.viewMode === 'tree' && <div className="absolute inset-0 p-3 sm:p-6"><KnowledgeTreeMap nodes={nodesData} onNodeClick={(id: any) => { const n = nodesData.find(node => node.id.toString() === id.toString()); if (n) handleFocusNode(n); }} /></div>}
                  {filters.viewMode === 'pivot' && <div className="absolute inset-0 p-3 sm:p-6"><KnowledgePivot nodes={nodesData} onNodeClick={(id: any) => { const n = nodesData.find(node => node.id.toString() === id.toString()); if (n) handleFocusNode(n); }} /></div>}
                </React.Suspense>
              </div>
            </div>
          </ResizablePanel>

          {isChatOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={25} minSize={20}>
                <React.Suspense fallback={<Loader2 className="animate-spin" />}>
                  <KnowledgeChat
                    selectedNodeId={selectedNode?.id}
                    onClose={() => setIsChatOpen(false)}
                    stats={graphStats}
                    searchResults={searchResults}
                    onFocusNode={(nodeId) => {
                      const node = nodesData.find(n => n.id === nodeId);
                      if (node) handleFocusNode(node);
                    }}
                    onCategoryClick={(label) => {
                      filters.setSourceLabel(label);
                      filters.setSearchQuery("");
                      searchMutation.mutate({ query: "", label });
                    }}
                  />
                </React.Suspense>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        <React.Suspense fallback={null}>
          <InspectorPanel
            open={isInspectorOpen}
            onOpenChange={setIsInspectorOpen}
            node={selectedNode ? { ...selectedNode, data: (selectedNode.data as any) || {}, createdAt: String(selectedNode.createdAt), updatedAt: String(selectedNode.updatedAt) } as any : null}
            onExpand={handleExpandNeighbors}
            onFindRelated={handleFindRelated}
            onEdit={() => setIsNodeDialogOpen(true)}
            onDelete={() => setIsDeleteDialogOpen(true)}
            onPivot={handlePivot}
            onAnalyzeImpact={() => selectedNode && handleShowImpact(selectedNode.id)}
            expansionDepth={expansionDepth}
            onDepthChange={setExpansionDepth}
          />
        </React.Suspense>

        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Delete Entity</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete "{selectedNode?.name}"?</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteNode} className="bg-red-600">Delete</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <ImpactAnalysisModal
          targetNode={selectedNodeIdForImpact ? (nodesData.find(n => n.id === selectedNodeIdForImpact) as any) : null}
          open={isImpactModalOpen}
          onOpenChange={setIsImpactModalOpen}
          onNavigateToNode={(nodeId) => { const n = nodesData.find(node => node.id === nodeId); if (n) handleFocusNode(n); }}
        />

        <React.Suspense fallback={null}>
          <NodeEditDialog open={isNodeDialogOpen} onOpenChange={setIsNodeDialogOpen} node={selectedNode as any} onSuccess={() => queryData.refetchAll()} />
          <EdgeEditDialog open={isEdgeDialogOpen} onOpenChange={setIsEdgeDialogOpen} onSuccess={() => queryData.refetchAll()} />
        </React.Suspense>
      </div>
    </ErrorBoundary>
  );
}



