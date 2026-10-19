import { useQuery } from "@tanstack/react-query";
import PatternManager from '../components/PatternManager.js';
import { apiRequest } from "@/lib/queryClient";

export default function ErrorPatterns() {
    const { data, isLoading, refetch } = useQuery({
        queryKey: ["/api/patterns"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/patterns");
            return res as unknown as { patterns: any[] };
        }
    });

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Pattern Management</h1>
                    <p className="text-muted-foreground">
                        Import, export, and manage error diagnosis patterns across organizations.
                    </p>
                </div>
            </div>

            <PatternManager
                patterns={data?.patterns || []}
                loading={isLoading}
                onRefresh={refetch}
            />
        </div>
    );
}
