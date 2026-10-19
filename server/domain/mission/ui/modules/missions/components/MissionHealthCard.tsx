/**
 * Workgroup Health Card
 * Displays health score (0-100) and contributing factors.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Activity, TrendingUp, AlertTriangle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MissionHealthCardProps {
    missionId: number;
}

export function MissionHealthCard({ missionId }: MissionHealthCardProps) {
    const { data: health, isLoading } = useQuery<{
        score: number;
        label: "healthy" | "degraded" | "critical";
        factors: { name: string; value: number; max: number; description: string }[];
    }>({
        queryKey: [`/api/missions/${missionId}/health`],
        enabled: !!missionId,
        refetchInterval: 30_000,
    });

    if (isLoading) return (
        <Card className="bg-background/40 backdrop-blur-md border-border">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Activity className="w-5 h-5 text-muted-foreground" />
                        <Skeleton className="h-5 w-28" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-md" />
                </div>
                <Skeleton className="h-3 w-48 mt-1" />
            </CardHeader>
            <CardContent className="space-y-2">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-3 w-20" />
                    </div>
                ))}
            </CardContent>
        </Card>
    );

    if (!health) return null;

    const Icon = health.label === "healthy" ? TrendingUp : health.label === "degraded" ? AlertTriangle : AlertCircle;
    const scoreColor =
        health.label === "healthy"
            ? "text-emerald-400 border-emerald-500/30"
            : health.label === "degraded"
                ? "text-amber-400 border-amber-500/30"
                : "text-red-400 border-red-500/30";

    return (
        <Card className="bg-background/40 backdrop-blur-md border-border">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Activity className="w-5 h-5 text-muted-foreground" />
                        <CardTitle className="text-lg font-bold tracking-tight">Health Score</CardTitle>
                    </div>
                    <div
                        className={cn(
                            "flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-sm font-bold uppercase",
                            scoreColor
                        )}
                    >
                        <Icon className="w-4 h-4" />
                        {health.score}
                    </div>
                </div>
                <CardDescription>
                    {health.label === "healthy" && "Mission is operating normally."}
                    {health.label === "degraded" && "Some factors need attention."}
                    {health.label === "critical" && "Immediate attention recommended."}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                {health.factors.map((f) => (
                    <div key={f.name} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{f.name}</span>
                        <span className="font-medium" title={f.description}>
                            {f.description}
                        </span>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
