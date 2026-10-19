import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { ResponseTemplate } from "@/types/agent-types";

export function useResponseTemplates(selectedRunId: string | null) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Fetch response templates
    const { data: templates = [], isLoading: templatesLoading } = useQuery<ResponseTemplate[]>({
        queryKey: ["response-templates"],
        queryFn: async () => {
            const res = await fetch("/api/agent/response-templates");
            if (!res.ok) throw new Error("Failed to fetch response templates");
            return res.json();
        },
    });

    // Create/Update template mutation
    const templateMutation = useMutation({
        mutationFn: async ({ id, data }: { id?: number; data: any }) => {
            if (id) {
                return apiRequest("PUT", `/api/agent/response-templates/${id}`, data);
            } else {
                return apiRequest("POST", "/api/agent/response-templates", data);
            }
        },
        onSuccess: (_data, variables) => {
            toast({
                title: variables.id ? "Template updated" : "Template created",
                description: `The response template has been ${variables.id ? 'updated' : 'created'} successfully.`,
            });
            queryClient.invalidateQueries({ queryKey: ["response-templates"] });
        },
        onError: (error: any) => {
            toast({
                title: "Error",
                description: error.message || "Failed to save template",
                variant: "destructive",
            });
        },
    });

    // Delete template mutation
    const deleteMutation = useMutation({
        mutationFn: async (templateId: number) => {
            return apiRequest("DELETE", `/api/agent/response-templates/${templateId}`);
        },
        onSuccess: () => {
            toast({
                title: "Template deleted",
                description: "The response template has been deleted successfully.",
            });
            queryClient.invalidateQueries({ queryKey: ["response-templates"] });
        },
        onError: (error: any) => {
            toast({
                title: "Error",
                description: error.message || "Failed to delete template",
                variant: "destructive",
            });
        },
    });

    // Apply template to agent learning mutation
    const applyMutation = useMutation({
        mutationFn: async (templateId: number) => {
            return apiRequest("POST", `/api/agent/response-templates/${templateId}/apply`, {
                runId: selectedRunId
            });
        },
        onSuccess: () => {
            toast({
                title: "Template applied",
                description: "The response template has been applied to agent learning.",
            });
        },
        onError: (error: any) => {
            toast({
                title: "Application failed",
                description: error.message || "Failed to apply template",
                variant: "destructive",
            });
        },
    });

    // Analyze template effectiveness mutation
    const analyzeMutation = useMutation({
        mutationFn: async (templateId: number) => {
            const res = await apiRequest("POST", `/api/agent/response-templates/${templateId}/analyze`);
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Analysis complete",
                description: `Template effectiveness: ${Math.round(data.effectiveness * 100)}%`,
            });
            queryClient.invalidateQueries({ queryKey: ["response-templates"] });
        },
        onError: (error: any) => {
            toast({
                title: "Analysis failed",
                description: error.message || "Failed to analyze template",
                variant: "destructive",
            });
        },
    });

    return {
        templates,
        templatesLoading,
        templateMutation,
        deleteMutation,
        applyMutation,
        analyzeMutation
    };
}

