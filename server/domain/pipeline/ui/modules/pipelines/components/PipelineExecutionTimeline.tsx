
import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { format, differenceInMilliseconds, addMilliseconds } from 'date-fns';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@domain-ui/core/ui/components/ui/tooltip";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

interface PipelineExecutionTimelineProps {
    execution: any;
    stepExecutions: any[];
}

export function PipelineExecutionTimeline({ execution, stepExecutions }: PipelineExecutionTimelineProps) {

    const timelineData = useMemo(() => {
        if (!execution || !execution.startedAt || stepExecutions.length === 0) return null;

        const start = new Date(execution.startedAt).getTime();
        // Use completedAt for end, or now if running, or last step end
        let end = execution.completedAt ? new Date(execution.completedAt).getTime() : new Date().getTime();

        // Ensure end is at least after the last step
        const lastStepEnd = Math.max(...stepExecutions.map(s => s.completedAt ? new Date(s.completedAt).getTime() : 0));
        if (lastStepEnd > end) end = lastStepEnd;

        // If very short duration, add some buffer
        if (end - start < 1000) end = start + 1000;

        const totalDuration = end - start;

        return stepExecutions.map(step => {
            const stepStart = new Date(step.executedAt).getTime();
            const stepEnd = step.completedAt ? new Date(step.completedAt).getTime() : (step.status === 'running' ? new Date().getTime() : stepStart);

            const offsetMs = stepStart - start;
            const durationMs = stepEnd - stepStart;

            // Calculate percentages for CSS positioning
            const leftPercent = Math.max(0, (offsetMs / totalDuration) * 100);
            const widthPercent = Math.max(0.5, (durationMs / totalDuration) * 100); // Min width 0.5% for visibility

            return {
                ...step,
                offsetMs,
                durationMs,
                leftPercent,
                widthPercent,
                stepStart,
                stepEnd
            };
        });
    }, [execution, stepExecutions]);

    if (!timelineData || !execution.startedAt) return null;

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'success': return 'bg-green-500';
            case 'failure': return 'bg-red-500';
            case 'running': return 'bg-blue-500';
            case 'cancelled': return 'bg-gray-500';
            case 'skipped': return 'bg-yellow-500'; // Or gray/dashed
            default: return 'bg-slate-400';
        }
    };

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-lg font-medium flex justify-between items-center">
                    Execution Timeline
                    <div className="text-sm font-normal text-muted-foreground">
                        Total Duration: {((new Date(execution.completedAt || new Date()).getTime() - new Date(execution.startedAt).getTime()) / 1000).toFixed(1)}s
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {/* Time Axis Labels (Simplified) */}
                    <div className="flex justify-between text-xs text-muted-foreground border-b pb-1">
                        <span>0s</span>
                        <span>50%</span>
                        <span>100%</span>
                    </div>

                    <div className="relative space-y-2 min-h-[100px]">
                        {timelineData.map((step, index) => (
                            <div key={step.id || index} className="grid grid-cols-[150px_1fr] gap-4 items-center group">
                                <div className="text-sm truncate font-medium text-right" title={step.outputName || `Step ${step.stepOrder}`}>
                                    {step.outputName || `Step ${step.stepOrder}`}
                                </div>

                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="relative h-6 bg-muted dark:bg-muted rounded w-full overflow-hidden cursor-pointer">
                                                {/* Background grid lines could go here */}
                                                <div
                                                    className={`absolute h-full rounded ${getStatusColor(step.status)} transition-all hover:brightness-110`}
                                                    style={{
                                                        left: `${step.leftPercent}%`,
                                                        width: `${step.widthPercent}%`
                                                    }}
                                                />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            <div className="text-xs space-y-1">
                                                <p className="font-semibold">{step.outputName || `Step ${step.stepOrder}`}</p>
                                                <p>Status: <Badge variant="outline" className="h-5 text-[10px] px-1">{step.status}</Badge></p>
                                                <p>Start: +{(step.offsetMs / 1000).toFixed(2)}s</p>
                                                <p>Duration: {(step.durationMs).toFixed(0)}ms</p>
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                        ))}
                    </div>

                    {/* Legend */}
                    <div className="flex gap-4 justify-end text-xs pt-2">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-500 rounded"></div> Success</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded"></div> Running</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 rounded"></div> Failed</div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
