
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from './use-toast.js';

export interface EntityVersion {
    id: number;
    entityType: "job" | "pipeline";
    entityId: number;
    version: number;
    snapshot: any;
    changeSummary?: string;
    changedFields?: string[];
    userId?: number;
    organizationId?: number;
    createdAt: string;
}

export interface DiffResult {
    field: string;
    oldValue: any;
    newValue: any;
}

export function useEntityVersions(entityType: "job" | "pipeline", entityId: number) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const result = useQuery<EntityVersion[]>({
        queryKey: [`/${entityType}s/${entityId}/versions`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/${entityType}s/${entityId}/versions`);
            return res.json();
        }
    });

    return result;
}

export function useRollbackVersion(entityType: "job" | "pipeline", entityId: number) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (version: number) => {
            const res = await apiRequest("POST", `/api/${entityType}s/${entityId}/rollback/${version}`);
            return res.json();
        },
        onSuccess: (data, version) => {
            toast({
                title: "Rollback Successful",
                description: `Restored version ${version}`,
            });
            // Invalidate versions and the entity itself
            queryClient.invalidateQueries({ queryKey: [`/${entityType}s/${entityId}/versions`] });
            queryClient.invalidateQueries({ queryKey: [`/api/${entityType}s/${entityId}`] }); // Assuming this is the key for the entity
        },
        onError: (error: Error) => {
            toast({
                title: "Rollback Failed",
                description: error.message,
                variant: "destructive",
            });
        }
    });
}

export function useVersionDiff(entityType: "job" | "pipeline", entityId: number, v1?: number, v2?: number) {
    return useQuery<DiffResult[]>({
        queryKey: [`/${entityType}s/${entityId}/versions/diff`, v1, v2],
        queryFn: async () => {
            if (!v1 || !v2) return [];
            const res = await apiRequest("GET", `/api/${entityType}s/${entityId}/versions/diff?v1=${v1}&v2=${v2}`);
            return res.json();
        },
        enabled: !!v1 && !!v2,
    });
}
