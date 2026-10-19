import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { AlertCircle, ArrowDown, History, Search, GitCommit, PlayCircle } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface RootCauseNode {
    stepExecutionId: number;
    stepName: string;
    stepId: number;
    status: string;
    error?: string;
    outputSummary?: string;
    executionTimeMs?: number;
    occurredAt: string;
    impactScore: number;
    relation: 'root_cause' | 'contributor' | 'victim' | 'unknown';
}

interface RootCauseTrace {
    targetErrorId: number;
    rootCauseNode: RootCauseNode | null;
    tracePath: RootCauseNode[];
    analysisSummary: string;
}

interface RootCauseGraphProps {
    stepExecutionId?: number;
    traceData?: RootCauseTrace;
    onAnalyze?: () => void;
}

export function RootCauseGraph({ stepExecutionId, traceData, onAnalyze }: RootCauseGraphProps) {
    const [trace, setTrace] = useState<RootCauseTrace | null>(traceData || null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTrace = async () => {
        if (!stepExecutionId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await apiRequest('GET', `/api/diagnosis/trace/${stepExecutionId}`) as unknown as RootCauseTrace;
            setTrace(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (traceData) {
            setTrace(traceData);
        } else if (stepExecutionId) {
            fetchTrace();
        }
    }, [stepExecutionId, traceData]);

    if (loading) {
        return (
            <Card>
                <CardContent className="py-6 space-y-4">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="border-red-200 bg-red-50">
                <CardContent className="py-6 text-center text-red-700">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                    <p>Failed to analyze root cause: {error}</p>
                    <Button variant="outline" size="sm" onClick={fetchTrace} className="mt-4 bg-card">
                        Retry Analysis
                    </Button>
                </CardContent>
            </Card>
        );
    }

    if (!trace) return null;

    return (
        <Card className="border-l-4 border-l-orange-500">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <Search className="h-5 w-5 text-orange-600" />
                    Root Cause Analysis
                </CardTitle>
                <CardDescription>
                    {trace.analysisSummary}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="relative pl-6 space-y-6 before:absolute before:left-[19px] before:top-4 before:bottom-4 before:w-0.5 before:bg-muted">
                    {trace.tracePath.map((node, index) => {
                        const isLast = index === trace.tracePath.length - 1;
                        const isRoot = node.relation === 'root_cause';
                        const isContributor = node.relation === 'contributor';
                        const isVictim = node.relation === 'victim';

                        return (
                            <div key={node.stepExecutionId} className="relative">
                                {/* Timeline dot */}
                                <div className={cn(
                                    "absolute -left-[31px] top-3 h-6 w-6 rounded-full border-4 bg-card flex items-center justify-center",
                                    isRoot ? "border-red-500" :
                                        isContributor ? "border-orange-400" :
                                            isVictim ? "border-gray-500" : "border-border"
                                )}>
                                    {isRoot ? <AlertCircle className="h-3 w-3 text-red-600" /> :
                                        isContributor ? <History className="h-3 w-3 text-orange-500" /> :
                                            <GitCommit className="h-3 w-3 text-muted-foreground" />}
                                </div>

                                <div className={cn(
                                    "p-4 rounded-lg border text-sm",
                                    isRoot ? "bg-red-50 border-red-200" :
                                        isContributor ? "bg-orange-50 border-orange-200" :
                                            "bg-muted border-border"
                                )}>
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="font-medium flex items-center gap-2">
                                            {node.relation === 'root_cause' && <Badge variant="destructive" className="text-[10px] h-5">ROOT CAUSE</Badge>}
                                            {node.relation === 'contributor' && <Badge variant="outline" className="text-[10px] h-5 bg-orange-100 text-orange-700 border-orange-300">CONTRIBUTOR</Badge>}
                                            {node.stepName}
                                            <span className="text-xs text-muted-foreground font-normal">
                                                ({formatDistanceToNow(new Date(node.occurredAt), { addSuffix: true })})
                                            </span>
                                        </div>
                                        <Badge variant={node.status === 'failed' ? 'destructive' : 'secondary'} className="capitalize text-[10px]">
                                            {node.status}
                                        </Badge>
                                    </div>

                                    {node.error && (
                                        <div className="bg-foreground/50 p-2 rounded text-xs font-mono text-red-700 mb-2 border border-red-100/50">
                                            Error: {node.error}
                                        </div>
                                    )}

                                    {node.outputSummary && node.outputSummary !== 'No output' && (
                                        <div className="text-xs text-muted-foreground">
                                            <span className="font-medium text-foreground">Output:</span> {node.outputSummary}
                                        </div>
                                    )}

                                    {/* Impact Score for non-victims */}
                                    {!isVictim && node.impactScore > 0 && (
                                        <div className="mt-2 text-xs flex items-center gap-1 text-orange-700">
                                            <ArrowDown className="h-3 w-3" />
                                            {(node.impactScore * 100).toFixed(0)}% probability of impact
                                        </div>
                                    )}
                                </div>

                                {!isLast && (
                                    <div className="absolute left-1/2 -bottom-4 transform -translate-x-1/2">
                                        <ArrowDown className="h-4 w-4 text-foreground" />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

export default RootCauseGraph;
