import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { AgentRunSummary, AgentRunStep } from "@/types/agent-types";

export function useAgentMemory(selectedRunId: string | null) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: runs, isLoading: runsLoading } = useQuery<AgentRunSummary[]>({
        queryKey: ["agent-runs"],
        queryFn: async () => {
            const res = await fetch("/api/agent/memory");
            if (!res.ok) throw new Error("Failed to fetch agent runs");
            return res.json();
        },
    });

    const { data: steps, isLoading: stepsLoading } = useQuery<AgentRunStep[]>({
        queryKey: ["agent-run-steps", selectedRunId],
        queryFn: async () => {
            if (!selectedRunId) return [];
            const res = await fetch(`/api/agent/memory/${selectedRunId}`);
            if (!res.ok) throw new Error("Failed to fetch run steps");
            return res.json();
        },
        enabled: !!selectedRunId,
    });

    const { data: suggestions, refetch: refetchSuggestions, isLoading: suggestionsLoading } = useQuery({
        queryKey: ["agent-suggestions", selectedRunId],
        queryFn: async () => {
            if (!selectedRunId) return [];
            const res = await fetch(`/api/agent/memory/${selectedRunId}/suggestions`);
            if (!res.ok) throw new Error("Failed to fetch suggestions");
            return res.json();
        },
        enabled: !!selectedRunId
    });

    const optimizeMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/agent/memory/${selectedRunId}/optimize`);
            return res.json();
        },
        onSuccess: (data) => {
            toast({ title: "Analysis Complete", description: `Found ${data.length} suggestions.` });
            refetchSuggestions();
        },
        onError: (err: any) => {
            toast({ title: "Analysis Failed", description: err.message, variant: "destructive" });
        }
    });

    const applyMutation = useMutation({
        mutationFn: async (suggestionId: number) => {
            const res = await apiRequest("POST", `/api/agent/memory/suggestions/${suggestionId}/apply`);
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "Success", description: "Optimization applied successfully." });
            refetchSuggestions();
        },
        onError: (err: any) => {
            toast({ title: "Failed", description: err.message, variant: "destructive" });
        }
    });

    return {
        runs,
        runsLoading,
        steps,
        stepsLoading,
        suggestions,
        suggestionsLoading,
        refetchSuggestions,
        optimizeMutation,
        applyMutation
    };
}

