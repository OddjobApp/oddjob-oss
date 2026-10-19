import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface LineageNode {
    id: string;
    type: "job" | "pipeline" | "dataset" | "field";
    data: {
        label: string;
        jobType?: string;
        stepId?: number;
        jobId?: number;
    };
    position?: { x: number; y: number };
}

export interface LineageEdge {
    source: string;
    target: string;
    type: "explicit" | "implicit" | "data_flow";
    label?: string;
}

export interface LineageGraph {
    nodes: LineageNode[];
    edges: LineageEdge[];
}

export function usePipelineLineage(pipelineId: number) {
    return useQuery<LineageGraph>({
        queryKey: ['/pipelines', pipelineId, 'lineage'],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/pipelines/${pipelineId}/lineage`);
            return res.json();
        },
        enabled: !!pipelineId,
    });
}

export function useJobImpact(jobId: number) {
    return useQuery<{
        affectedPipelines: { id: number; name: string; stepOrder: number }[];
        affectedJobs: { id: number; name: string }[];
    }>({
        queryKey: ['/jobs', jobId, 'impact'],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/jobs/${jobId}/impact`);
            return res.json();
        },
        enabled: !!jobId
    });
}
