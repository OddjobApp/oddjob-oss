
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface AgentWorkforceMember {
    id: number;
    jobId: number;
    title: string;
    soulArchetype: string;
    updatedAt: string;
    createdAt: string;
    slug: string;
    reliability: number;
}

export interface AgentPortfolio {
    id: number;
    name: string;
    archetype: string;
    legend: string;
    cv: any[];
    createdAt: string;
    slug: string;
}

export interface UpskillingCandidate {
    agentId: number;
    pipId: number;
    title: string;
    reliability: number;
    failureCount: number;
    status: 'OPTIMAL' | 'DEBT' | 'PROBATION';
}

export function useAgenticHR() {
    // Fetch the list of agents
    const workforceQuery = useQuery<AgentWorkforceMember[]>({
        queryKey: ["/api/agents/hr/workforce"],
    });

    // Fetch upskilling candidates
    const candidatesQuery = useQuery<UpskillingCandidate[]>({
        queryKey: ["/api/agents/hr/upskilling/candidates"],
    });

    const upskillMutation = useMutation({
        mutationFn: async (agentId: number) => {
            const response = await apiRequest("POST", `/api/agents/hr/${agentId}/upskill`);
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/agents/hr/upskilling/candidates"] });
            queryClient.invalidateQueries({ queryKey: ["/api/agents/hr/workforce"] });
        },
    });

    // Function to fetch a specific portfolio
    const usePortfolio = (id?: number) => {
        return useQuery<AgentPortfolio>({
            queryKey: [`/api/agents/hr/${id}/portfolio`],
            enabled: !!id,
        });
    };

    return {
        workforce: workforceQuery.data || [],
        candidates: candidatesQuery.data || [],
        isLoading: workforceQuery.isLoading || candidatesQuery.isLoading,
        error: workforceQuery.error || candidatesQuery.error,
        startUpskilling: upskillMutation.mutateAsync,
        isUpskilling: upskillMutation.isPending,
        usePortfolio,
    };
}
