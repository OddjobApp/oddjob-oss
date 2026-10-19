import { useQuery } from "@tanstack/react-query";
import ClusterReviewPanel from '../components/ClusterReviewPanel.js';
import { apiRequest } from "@/lib/queryClient";

export default function ErrorClusters() {
    const { data, isLoading, refetch } = useQuery({
        queryKey: ["/api/clusters"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/clusters");
            return res as unknown as { clusters: any[] };
        }
    });

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Error Clusters</h1>
                    <p className="text-muted-foreground">
                        Review and manage automatically detected error clusters.
                    </p>
                </div>
            </div>

            <ClusterReviewPanel
                clusters={data?.clusters || []}
                loading={isLoading}
                onRefresh={refetch}
            />
        </div>
    );
}
