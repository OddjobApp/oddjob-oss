import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type { ExecutionStrategy } from "@/modules/missions/config/mission-strategies.config";

const strategyLabels: Record<ExecutionStrategy, string> = {
    pre_planned: "Pre-planned",
    dynamic_autonomous: "Dynamic autonomous",
    rolling_wave: "Rolling wave",
    human_driven: "Human driven",
    parallel_fan_out: "Parallel fan-out",
    reactive: "Reactive",
};

interface SimilarMission {
    id: number;
    missionId: number;
    objective: string;
    outcome: "success" | "partial" | "failure";
    strategy?: string;
}

interface SimilarMissionsPanelProps {
    objective: string;
    organizationId?: number;
    currentMissionId?: number;
    onStrategySelect?: (strategy: ExecutionStrategy) => void;
    compact?: boolean;
}

export function SimilarMissionsPanel({ objective, organizationId, currentMissionId, onStrategySelect, compact = false }: SimilarMissionsPanelProps) {
    const { toast } = useToast();
    const [search, setSearch] = useState("");
    const trimmedObjective = objective.trim();
    useEffect(() => {
        const timer = setTimeout(() => setSearch(trimmedObjective), 400);
        return () => clearTimeout(timer);
    }, [trimmedObjective]);

    const ready = !!organizationId && search.length >= 10 && search === trimmedObjective;
    const { data = [], isFetching, isError, refetch } = useQuery<SimilarMission[]>({
        queryKey: ["/api/missions/similar", organizationId, search, currentMissionId, compact],
        enabled: ready,
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({ objective: search, orgId: String(organizationId) });
            const res = await apiRequest("GET", `/api/missions/similar?${params}`, undefined, undefined, signal);
            const result = await res.json();
            if (!Array.isArray(result.missions)) throw new Error("Invalid similar missions response");
            return result.missions.filter((mission: SimilarMission) =>
                Number.isInteger(mission.missionId) && mission.missionId !== currentMissionId
            ).slice(0, compact ? 3 : 5);
        },
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Similar past missions</CardTitle>
                <CardDescription>Prior outcomes with related objective wording. Reuse an execution strategy while keeping your brief and team.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {!organizationId ? <p className="text-sm text-muted-foreground">Select an organization to see its mission history.</p>
                    : trimmedObjective.length < 10 ? <p className="text-sm text-muted-foreground">Enter a detailed objective to find prior work.</p>
                    : !ready || isFetching ? <p role="status" className="text-sm text-muted-foreground">Finding similar missions...</p>
                    : isError ? <div role="alert" className="space-y-2">
                        <p className="text-sm">Could not load similar missions.</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
                    </div>
                    : data.length === 0 ? <p className="text-sm text-muted-foreground">No matching mission outcomes found in this organization.</p>
                    : data.map((mission) => {
                        const strategy = mission.strategy && Object.prototype.hasOwnProperty.call(strategyLabels, mission.strategy)
                            ? mission.strategy as ExecutionStrategy : null;
                        return (
                            <div key={mission.id} className="space-y-3 rounded-lg border p-3">
                                <p className="break-words text-sm font-medium">{mission.objective}</p>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant={mission.outcome === "failure" ? "destructive" : "secondary"}>
                                        {mission.outcome === "success" ? "Succeeded" : mission.outcome === "failure" ? "Failed" : mission.outcome === "partial" ? "Partial" : "Outcome unknown"}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">{strategy ? strategyLabels[strategy] : "Strategy unavailable"}</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {strategy && onStrategySelect && <Button type="button" size="sm" onClick={() => {
                                        onStrategySelect(strategy);
                                        toast({ title: "Strategy selected", description: `${strategyLabels[strategy]} will be used for this mission. Review it before creating the mission.` });
                                    }}>Use this strategy</Button>}
                                    <Button type="button" variant="outline" size="sm" asChild>
                                        <Link href={`/operations/missions/${mission.missionId}`}>View mission</Link>
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
            </CardContent>
        </Card>
    );
}

export default SimilarMissionsPanel;
