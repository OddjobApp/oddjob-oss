
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { KnowledgeEdge, KnowledgeNode } from "@shared/schema/knowledge/graph";
import { ViewMode, ViewContext } from './useKnowledgeFilters.js';

export interface UseKnowledgeDataOptions {
    activeDatasetId: number | null;
    searchQuery: string;
    sourceLabel?: string;
    relation?: string;
    targetLabel?: string;
    targetFilter?: string;
    viewMode: ViewMode;
    viewContext: ViewContext;
    selectedRunId: number | null;
    pagination: { pageIndex: number; pageSize: number };
}

export function useKnowledgeData({
    activeDatasetId,
    searchQuery,
    sourceLabel,
    relation,
    targetLabel,
    targetFilter,
    viewMode,
    viewContext,
    selectedRunId,
    pagination
}: UseKnowledgeDataOptions) {

    // Fetch Semantic Graph (Specialized for 3D)
    const { data: semanticResponse, isLoading: isLoadingSemantic, refetch: refetchSemantic } = useQuery<{ nodes: any[], edges: KnowledgeEdge[] }>({
        queryKey: ["/api/knowledge-graph/graph/semantic", activeDatasetId, searchQuery, sourceLabel, viewMode],
        queryFn: async () => {
            const params = new URLSearchParams({ limit: "2000" });
            if (activeDatasetId) params.append("datasetId", activeDatasetId.toString());
            if (searchQuery) params.append("query", searchQuery);
            if (sourceLabel) params.append("label", sourceLabel);

            const res = await apiRequest("GET", `/api/knowledge-graph/graph/semantic?${params.toString()}`);
            return res.json();
        },
        enabled: viewMode === "3d"
    });

    // Fetch Master Nodes
    const { data: nodesResponse, isLoading: isLoadingNodes, refetch: refetchNodes } = useQuery<{ nodes: KnowledgeNode[], total: number }>({
        queryKey: ["/api/knowledge-graph/nodes", activeDatasetId, pagination, searchQuery, sourceLabel, viewMode],
        queryFn: async () => {
            const isVisualization = ['graph', 'flow', 'matrix', 'tree', 'pivot'].includes(viewMode);
            const limit = isVisualization ? 3000 : pagination.pageSize;
            const offset = (pagination.pageIndex - 1) * pagination.pageSize;

            const params = new URLSearchParams({
                limit: limit.toString(),
                offset: offset.toString()
            });

            if (activeDatasetId) params.append("datasetId", activeDatasetId.toString());
            if (searchQuery) params.append("query", searchQuery);
            if (sourceLabel) params.append("label", sourceLabel);

            const res = await apiRequest("GET", `/api/knowledge-graph/nodes?${params.toString()}`);
            return res.json();
        },
        enabled: viewMode !== "3d"
    });

    // Fetch Master Edges
    const { data: edgesResponse, isLoading: isLoadingEdges, refetch: refetchEdges } = useQuery<{ edges: KnowledgeEdge[], total: number }>({
        queryKey: ["/api/knowledge-graph/edges", activeDatasetId, viewMode, searchQuery, sourceLabel, relation, targetLabel],
        queryFn: async () => {
            if (!['graph', 'schema', 'flow', 'matrix'].includes(viewMode)) return { edges: [], total: 0 };

            const params = new URLSearchParams({ limit: "5000" });
            if (activeDatasetId) params.append("datasetId", activeDatasetId.toString());
            if (searchQuery) params.append("query", searchQuery);
            if (sourceLabel) params.append("sourceLabel", sourceLabel);
            if (relation) params.append("relation", relation);
            if (targetLabel) params.append("targetLabel", targetLabel);

            const res = await apiRequest("GET", `/api/knowledge-graph/edges?${params.toString()}`);
            return res.json();
        },
        enabled: viewMode !== "3d"
    });

    // Fetch Staging Nodes
    const { data: stagingNodesData, isLoading: isLoadingStaging } = useQuery<{ nodes: KnowledgeNode[] }>({
        queryKey: ["/api/knowledge-graph/nodes/staging", viewMode],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/knowledge-graph/nodes?verificationStatus=staging");
            return res.json();
        },
        enabled: viewMode === "staging"
    });

    // Fetch Matrix Summary
    const { data: matrixSummary, isLoading: isLoadingMatrix } = useQuery<any>({
        queryKey: ["/api/knowledge-graph/analytics/matrix", activeDatasetId, searchQuery, viewMode, selectedRunId],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (viewContext === 'run' && selectedRunId) params.append("runId", selectedRunId.toString());
            if (viewContext === 'dataset' && activeDatasetId) params.append("datasetId", activeDatasetId.toString());
            if (viewContext === 'global' && searchQuery) params.append("query", searchQuery);

            const res = await apiRequest("GET", `/api/knowledge-graph/analytics/matrix?${params.toString()}`);
            return res.json();
        },
        enabled: viewMode === 'matrix'
    });

    // Fetch Run Context
    const { data: runContextData } = useQuery<{ nodes: KnowledgeNode[], edges: KnowledgeEdge[] }>({
        queryKey: ["/api/knowledge-graph/run-context", selectedRunId],
        queryFn: async () => {
            if (!selectedRunId) return { nodes: [], edges: [] };
            const res = await apiRequest("GET", `/api/knowledge-graph/run-context/${selectedRunId}`);
            return res.json();
        },
        enabled: viewContext === 'run' && !!selectedRunId
    });

    // Fetch Pipelines
    const { data: pipelines = [] } = useQuery<any[]>({
        queryKey: ["/api/pipelines"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/pipelines");
            return res.json();
        },
    });

    // Fetch Datasets
    const { data: datasets = [] } = useQuery<any[]>({
        queryKey: ["/api/datasets"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/datasets");
            return res.json();
        },
    });

    // Fetch Executions
    const { data: executions = [] } = useQuery<any[]>({
        queryKey: ["/api/pipeline-executions"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/pipeline-executions");
            return res.json();
        },
    });

    return {
        nodes: viewMode === "3d" ? (semanticResponse?.nodes || []) : (nodesResponse?.nodes || []),
        totalNodes: viewMode === "3d" ? (semanticResponse?.nodes?.length || 0) : (nodesResponse?.total || 0),
        edges: viewMode === "3d" ? (semanticResponse?.edges || []) : (edgesResponse?.edges || []),
        totalEdges: viewMode === "3d" ? (semanticResponse?.edges?.length || 0) : (edgesResponse?.total || 0),
        stagingNodes: stagingNodesData?.nodes || [],
        matrixSummary,
        runContextData,
        pipelines,
        datasets,
        executions,
        isLoading: isLoadingNodes || isLoadingEdges || isLoadingMatrix || isLoadingStaging || isLoadingSemantic,
        refetchAll: () => { refetchNodes(); refetchEdges(); refetchSemantic(); }
    };
}
