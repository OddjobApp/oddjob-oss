import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AlertConfigEditor from '../components/AlertConfigEditor.js';
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export default function ErrorAlerts() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data, isLoading, refetch } = useQuery({
        queryKey: ["/api/alert-configs"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/alert-configs");
            return res as unknown as { configs: any[] };
        }
    });

    const saveMutation = useMutation({
        mutationFn: async (config: any) => {
            if (config.id) {
                return apiRequest("PUT", `/api/alert-configs/${config.id}`, config);
            } else {
                return apiRequest("POST", "/api/alert-configs", config);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/alert-configs"] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            return apiRequest("DELETE", `/api/alert-configs/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/alert-configs"] });
            toast({ title: "Alert deleted" });
        },
        onError: (err: any) => {
            toast({ title: "Delete failed", description: err.message, variant: "destructive" });
        }
    });

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Error Alerts</h1>
                    <p className="text-muted-foreground">
                        Configure automated alerts for recurring error patterns.
                    </p>
                </div>
            </div>

            <AlertConfigEditor
                configs={data?.configs || []}
                onSave={async (config) => { await saveMutation.mutateAsync(config); }}
                onDelete={async (id) => { await deleteMutation.mutateAsync(id); }}
                onRefresh={refetch}
            />
        </div>
    );
}

