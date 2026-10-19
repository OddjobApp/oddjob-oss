
import React from 'react';
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@domain-ui/core/ui/components/ui/tooltip';
import { formatDistance } from 'date-fns';
import { getStepStatusBadge } from '@/lib/status-badges';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';

interface StepExecution {
    id: number;
    stepOrder: number;
    status: string;
    executedAt: string;
    completedAt: string | null;
    jobName?: string;
    outputName?: string | null;
    traceId?: string;
}

interface TraceWaterfallProps {
    executionStartedAt?: string;
    executionCompletedAt?: string | null;
    steps?: StepExecution[];
    traceId?: string;
}

export function TraceWaterfall({ executionStartedAt, executionCompletedAt, steps, traceId }: TraceWaterfallProps) {
    const { data: traceSteps, isLoading } = useQuery({
        queryKey: ["trace-waterfall", traceId],
        queryFn: async () => {
            const res = await fetch(`/api/observability/traces/${traceId}`);
            if (!res.ok) throw new Error("Failed to fetch trace");
            return res.json();
        },
        enabled: !!traceId && !steps
    });

    if (isLoading && !steps) return <Skeleton className="h-48 w-full" />;

    const effectiveSteps = steps || traceSteps || [];
    if (effectiveSteps.length === 0) return null;

    const start = new Date(executionStartedAt || effectiveSteps[0].executedAt).getTime();
    const end = executionCompletedAt
        ? new Date(executionCompletedAt).getTime()
        : (effectiveSteps.length > 0 ? new Date(effectiveSteps[effectiveSteps.length - 1].completedAt || Date.now()).getTime() : Date.now());

    const totalDuration = Math.max(end - start, 1000); // Avoid div by zero

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    Trace Waterfall
                    <span className="text-xs font-normal text-muted-foreground ml-auto">
                        Total Duration: {(totalDuration / 1000).toFixed(2)}s
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-2 relative min-h-[100px]">
                    <div className="absolute top-0 bottom-0 left-0 w-px bg-border z-10" />
                    <div className="absolute top-0 bottom-0 right-0 w-px bg-border z-10" />

                    {effectiveSteps.map((step: StepExecution) => {
                        const stepStart = new Date(step.executedAt).getTime();
                        const stepEnd = step.completedAt ? new Date(step.completedAt).getTime() : Date.now();
                        const duration = Math.max(stepEnd - stepStart, 0); // min 0

                        // Calculate relative position and width
                        const left = Math.max(0, ((stepStart - start) / totalDuration) * 100);
                        const width = Math.max(0.5, (duration / totalDuration) * 100); // min 0.5% visibility

                        const statusColor =
                            step.status === 'success' ? 'bg-green-500' :
                                step.status === 'failure' ? 'bg-red-500' :
                                    step.status === 'running' ? 'bg-blue-500' : 'bg-gray-400';

                        return (
                            <div key={step.id} className="relative h-8 flex items-center group">
                                {/* Label */}
                                <div className="w-1/4 pr-2 text-xs truncate flex items-center gap-1">
                                    <span className="font-mono text-muted-foreground">#{step.stepOrder}</span>
                                    <span title={step.jobName || 'Step'}>{step.jobName || 'Step'}</span>
                                </div>

                                {/* Bar Track */}
                                <div className="flex-1 relative h-full bg-muted/20 rounded">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div
                                                    className={`absolute h-4 top-2 rounded-sm ${statusColor} opacity-80 hover:opacity-100 transition-opacity cursor-pointer`}
                                                    style={{ left: `${left}%`, width: `${width}%` }}
                                                />
                                            </TooltipTrigger>
                                            <TooltipContent className="text-xs">
                                                <div className="font-bold">{step.jobName || 'Step'}</div>
                                                <div>Status: {step.status}</div>
                                                <div>Duration: {duration}ms</div>
                                                <div>Start: +{Math.round(stepStart - start)}ms</div>
                                                {step.traceId && <div className="font-mono text-[10px] mt-1 text-muted-foreground">Trace: {step.traceId.substring(0, 8)}...</div>}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
