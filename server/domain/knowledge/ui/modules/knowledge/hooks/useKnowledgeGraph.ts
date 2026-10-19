/**
 * useKnowledgeGraph Hook
 * 
 * Extracts data fetching and state management logic from KnowledgeGraph component.
 * This hook manages all the queries, mutations, and state for the Knowledge Graph page.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type { KnowledgeEdge, KnowledgeNode } from "@shared/schema/knowledge/graph";

// Types
export type ViewMode = 'graph' | 'schema' | 'staging' | 'timeline' | 'matrix' | '3d';
export type ViewContext = 'global' | 'run' | 'dataset';

export interface KnowledgeGraphContext {
  type: 'global' | 'run' | 'dataset';
  id?: number;
}

export interface KnowledgeGraphFilters {
  sourceLabel: string;
  relation: string;
  targetLabel: string;
  targetFilter: string;
  searchQuery: string;
}

export interface UseKnowledgeGraphOptions {
  context?: KnowledgeGraphContext;
}

export interface UseKnowledgeGraphReturn {
  // View state
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  viewContext: ViewContext;
  setViewContext: (context: ViewContext) => void;

  // Selection state
  selectedPipelines: string[];
  setSelectedPipelines: (pipelines: string[]) => void;
  selectedDatasets: string[];
  setSelectedDatasets: (datasets: string[]) => void;
  selectedRunId: number | null;
  setSelectedRunId: (id: number | null) => void;
  activeDatasetId: number | null;

  // Filter state
  filters: KnowledgeGraphFilters;
  setFilters: (filters: Partial<KnowledgeGraphFilters>) => void;
  isFilterOpen: boolean;
  setIsFilterOpen: (open: boolean) => void;
  isNLQMode: boolean;
  setIsNLQMode: (mode: boolean) => void;

  // Node selection
  selectedNode: KnowledgeNode | null;
  setSelectedNode: (node: KnowledgeNode | null) => void;

  // Dialog state
  dialogs: {
    inspector: boolean;
    nodeEdit: boolean;
    edgeEdit: boolean;
    delete: boolean;
    impactAnalysis: boolean;
  };
  setDialogOpen: (dialog: keyof UseKnowledgeGraphReturn['dialogs'], open: boolean) => void;

  // Edit state
  editingNode: KnowledgeNode | null;
  setEditingNode: (node: KnowledgeNode | null) => void;

  // Queries
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  stagingNodes: KnowledgeNode[];
  datasetKeys: string[];
  isLoadingNodes: boolean;
  isLoadingEdges: boolean;

  // Mutations
  approveNode: (nodeId: number) => Promise<void>;
  rejectNode: (nodeId: number) => Promise<void>;

  // Refetch functions
  refetchNodes: () => void;
  refetchEdges: () => void;
  refetchStaging: () => void;
}

export function useKnowledgeGraph({ context }: UseKnowledgeGraphOptions = {}): UseKnowledgeGraphReturn {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [viewContext, setViewContext] = useState<ViewContext>(context?.type || "global");

  // Selection state
  const [selectedPipelines, setSelectedPipelines] = useState<string[]>([]);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>(
    context?.type === 'dataset' && context.id ? [context.id.toString()] : []
  );
  const [selectedRunId, setSelectedRunId] = useState<number | null>(
    (context?.type === 'run' ? context.id : null) || null
  );

  // Derived state
  const activeDatasetId = useMemo(() => {
    if (viewContext === 'global' && selectedDatasets.length > 0) {
      return parseInt(selectedDatasets[0]);
    }
    if (viewContext === 'dataset' && context?.id) {
      return context.id;
    }
    return null;
  }, [viewContext, selectedDatasets, context]);

  // Filter state
  const [filters, setFiltersState] = useState<KnowledgeGraphFilters>({
    sourceLabel: "",
    relation: "",
    targetLabel: "",
    targetFilter: "",
    searchQuery: "",
  });
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isNLQMode, setIsNLQMode] = useState(false);

  const setFilters = useCallback((partial: Partial<KnowledgeGraphFilters>) => {
    setFiltersState(prev => ({ ...prev, ...partial }));
  }, []);

  // Node selection
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);

  // Dialog state
  const [dialogs, setDialogs] = useState({
    inspector: false,
    nodeEdit: false,
    edgeEdit: false,
    delete: false,
    impactAnalysis: false,
  });

  const setDialogOpen = useCallback((dialog: keyof typeof dialogs, open: boolean) => {
    setDialogs(prev => ({ ...prev, [dialog]: open }));
  }, []);

  // Edit state
  const [editingNode, setEditingNode] = useState<KnowledgeNode | null>(null);

  // Dataset Keys Query
  const { data: datasetKeys = [] } = useQuery<string[]>({
    queryKey: [`/api/datasets/${activeDatasetId}/keys`],
    queryFn: async () => {
      if (!activeDatasetId) return [];
      const res = await apiRequest("GET", `/api/datasets/${activeDatasetId}/keys`);
      return res.json();
    },
    enabled: !!activeDatasetId
  });

  // Build nodes query params
  const nodesQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.sourceLabel) params.append("sourceLabel", filters.sourceLabel);
    if (filters.targetLabel) params.append("targetLabel", filters.targetLabel);
    if (filters.relation) params.append("relationType", filters.relation);
    if (filters.searchQuery) params.append("search", filters.searchQuery);
    if (selectedPipelines.length > 0) params.append("pipelineId", selectedPipelines.join(","));
    if (selectedDatasets.length > 0) params.append("datasetId", selectedDatasets.join(","));
    if (selectedRunId) params.append("executionId", selectedRunId.toString());
    return params.toString();
  }, [filters, selectedPipelines, selectedDatasets, selectedRunId]);

  // Nodes Query
  const {
    data: nodesData,
    isLoading: isLoadingNodes,
    refetch: refetchNodes
  } = useQuery<{ nodes: KnowledgeNode[] }>({
    queryKey: ["/api/knowledge-graph/nodes", nodesQueryParams],
    queryFn: async () => {
      const url = nodesQueryParams
        ? `/api/knowledge-graph/nodes?${nodesQueryParams}`
        : "/api/knowledge-graph/nodes";
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: viewMode === "graph" || viewMode === "3d" || viewMode === "timeline" || viewMode === "matrix"
  });

  // Edges Query
  const {
    data: edgesData,
    isLoading: isLoadingEdges,
    refetch: refetchEdges
  } = useQuery<{ edges: KnowledgeEdge[] }>({
    queryKey: ["/api/knowledge-graph/edges", nodesQueryParams],
    queryFn: async () => {
      const url = nodesQueryParams
        ? `/api/knowledge-graph/edges?${nodesQueryParams}`
        : "/api/knowledge-graph/edges";
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: viewMode === "graph" || viewMode === "3d" || viewMode === "matrix"
  });

  // Staging Nodes Query
  const { data: stagingNodes = [], refetch: refetchStaging } = useQuery<KnowledgeNode[]>({
    queryKey: ["/api/knowledge-graph/nodes/staging"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/knowledge-graph/nodes?verificationStatus=staging");
      const data = await res.json();
      return data.nodes || [];
    },
    enabled: viewMode === "staging"
  });

  // Approve Node Mutation
  const approveNodeMutation = useMutation({
    mutationFn: async (nodeId: number) => {
      await apiRequest("PATCH", `/api/knowledge-graph/nodes/${nodeId}`, { verificationStatus: "verified" });
    },
    onSuccess: () => {
      toast({ title: "Node Approved", description: "Node moved to verified graph." });
      refetchStaging();
      refetchNodes();
    }
  });

  // Reject Node Mutation
  const rejectNodeMutation = useMutation({
    mutationFn: async (nodeId: number) => {
      await apiRequest("DELETE", `/api/knowledge-graph/nodes/${nodeId}`);
    },
    onSuccess: () => {
      toast({ title: "Node Rejected", description: "Node deleted." });
      refetchStaging();
    }
  });

  // Sanitize and filter nodes/edges for stability
  const sanitizedNodes = useMemo(() => {
    const rawNodes = nodesData?.nodes || [];
    return rawNodes.filter(n => n && n.id != null);
  }, [nodesData]);

  const sanitizedEdges = useMemo(() => {
    const rawEdges = edgesData?.edges || [];
    const nodeIds = new Set(sanitizedNodes.map(n => n.id));
    return rawEdges.filter(e =>
      e &&
      e.sourceId != null &&
      e.targetId != null &&
      nodeIds.has(e.sourceId) &&
      nodeIds.has(e.targetId)
    );
  }, [edgesData, sanitizedNodes]);

  return {
    // View state
    viewMode,
    setViewMode,
    viewContext,
    setViewContext,

    // Selection state
    selectedPipelines,
    setSelectedPipelines,
    selectedDatasets,
    setSelectedDatasets,
    selectedRunId,
    setSelectedRunId,
    activeDatasetId,

    // Filter state
    filters,
    setFilters,
    isFilterOpen,
    setIsFilterOpen,
    isNLQMode,
    setIsNLQMode,

    // Node selection
    selectedNode,
    setSelectedNode,

    // Dialog state
    dialogs,
    setDialogOpen,

    // Edit state
    editingNode,
    setEditingNode,

    // Query results
    nodes: sanitizedNodes,
    edges: sanitizedEdges,
    stagingNodes,
    datasetKeys,
    isLoadingNodes,
    isLoadingEdges,

    // Mutation functions
    approveNode: async (nodeId: number) => {
      await approveNodeMutation.mutateAsync(nodeId);
    },
    rejectNode: async (nodeId: number) => {
      await rejectNodeMutation.mutateAsync(nodeId);
    },

    // Refetch functions
    refetchNodes,
    refetchEdges,
    refetchStaging,
  };
}

