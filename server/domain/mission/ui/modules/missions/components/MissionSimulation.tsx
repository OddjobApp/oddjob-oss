import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { AlertCircle, CheckCircle2, DollarSign, Clock, AlertTriangle, Play } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { format } from "date-fns";

interface TaskEstimate {
    id: string;
    name: string;
    costUsd: number;
    timeMs: number;
}

interface SimulationResults {
    estimatedTotalCostUsd: number;
    estimatedTimeMs: number;
    riskLevel: "low" | "medium" | "high";
    bottlenecks: string[];
    taskEstimates: TaskEstimate[];
}

interface MissionSimulationProps {
    missionRunId: number;
}

export function MissionSimulation({ missionRunId }: MissionSimulationProps) {
    const [results, setResults] = useState<SimulationResults | null>(null);
    const { toast } = useToast();

    const simulateMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/mission-runs/${missionRunId}/simulate`);
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || "Simulation failed");
            }
            return res.json() as Promise<SimulationResults>;
        },
        onSuccess: (data) => {
            setResults(data);
            toast({
                title: "Simulation Complete",
                description: "Predictive analysis has been generated.",
            });
        },
        onError: (error: any) => {
            toast({
                title: "Simulation Failed",
                description: error.message || "Failed to run mission simulation.",
                variant: "destructive",
            });
        }
    });

    const getRiskBadge = (level: string) => {
        switch (level) {
            case "low":
                return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Low Risk</Badge>;
            case "medium":
                return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Medium Risk</Badge>;
            case "high":
                return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">High Risk</Badge>;
            default:
                return null;
        }
    };

    return (
        <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Play className="w-5 h-5 text-primary" />
                            Mission Simulation Engine
                        </CardTitle>
                        <CardDescription>
                            Predictive analysis of mission cost, time, and potential stalls.
                        </CardDescription>
                    </div>
                    <Button
                        onClick={() => simulateMutation.mutate()}
                        disabled={simulateMutation.isPending}
                        variant="default"
                        size="sm"
                    >
                        {simulateMutation.isPending ? "Simulating..." : "Run Simulation"}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                {results ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card className="bg-background/50">
                            <CardContent className="pt-6">
                                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                    <DollarSign className="w-4 h-4" />
                                    <span className="text-xs font-semibold uppercase tracking-wider">Estimated Cost</span>
                                </div>
                                <div className="text-2xl font-bold">${results.estimatedTotalCostUsd.toFixed(2)}</div>
                                <div className="text-xs text-muted-foreground mt-1">Heuristic projection</div>
                            </CardContent>
                        </Card>

                        <Card className="bg-background/50">
                            <CardContent className="pt-6">
                                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                    <Clock className="w-4 h-4" />
                                    <span className="text-xs font-semibold uppercase tracking-wider">Estimated Duration</span>
                                </div>
                                <div className="text-2xl font-bold">~{(results.estimatedTimeMs / 1000 / 60).toFixed(1)}m</div>
                                <div className="text-xs text-muted-foreground mt-1">Processing time estimate</div>
                            </CardContent>
                        </Card>

                        <Card className="bg-background/50">
                            <CardContent className="pt-6">
                                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                    <AlertTriangle className="w-4 h-4" />
                                    <span className="text-xs font-semibold uppercase tracking-wider">Operational Risk</span>
                                </div>
                                <div className="mt-1">{getRiskBadge(results.riskLevel)}</div>
                                <div className="text-xs text-muted-foreground mt-2">Based on complexity</div>
                            </CardContent>
                        </Card>

                        {results.bottlenecks.length > 0 && (
                            <div className="col-span-full bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-red-500 mb-2 font-semibold text-sm">
                                    <AlertCircle className="w-4 h-4" />
                                    Detected Potential Bottlenecks
                                </div>
                                <ul className="space-y-1">
                                    {Array.isArray(results.bottlenecks) && results.bottlenecks.map((b, i) => (
                                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                                            <span className="mt-1.5 w-1 h-1 rounded-full bg-red-500 shrink-0" />
                                            {b}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="col-span-full">
                            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-primary" />
                                Task Breakdown Estimates
                            </h4>
                            <ScrollArea className="h-[200px] border rounded-md p-4 bg-background/30">
                                <div className="space-y-3">
                                    {Array.isArray(results.taskEstimates) && results.taskEstimates.map((task) => (
                                        <div key={task.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                                            <div>
                                                <div className="text-sm font-medium">{task.name}</div>
                                                <div className="text-xs text-muted-foreground">ID: {task.id.split('-')[0]}...</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-semibold">${task.costUsd.toFixed(3)}</div>
                                                <div className="text-xs text-muted-foreground">~{(task.timeMs / 1000).toFixed(1)}s</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-primary/10 rounded-lg">
                        <Play className="w-12 h-12 text-primary/20 mb-4" />
                        <h3 className="text-lg font-semibold">Dry-Run Ready</h3>
                        <p className="text-sm text-muted-foreground max-w-[280px]">
                            Click Run Simulation to predict mission performance before launching.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

