import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@domain-ui/core/ui/components/ui/tooltip';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Clock, Hourglass, AlertTriangle } from 'lucide-react';

interface StepExecution {
    id: number;
    stepOrder: number;
    status: string;
    executedAt: string;
    completedAt: string | null;
    jobName?: string;
    outputName?: string | null;
    traceId?: string;
    waitReason?: string; // e.g., "Dependency: Job_A", "Cron: 08:00", "API Response"
}

interface ExecutionGanttChartProps {
    executionStartedAt?: string;
    executionCompletedAt?: string | null;
    steps?: StepExecution[];
    showTimeBreakdown?: boolean;
}

/**
 * ExecutionGanttChart - Enhanced Gantt-style visualization with state-aware latency tracking.
 * 
 * Features:
 * - Solid bars for "Active" execution time
 * - Hatched bars for "Wait" states (scheduled delay, dependency wait, API wait)
 * - Tooltips with wait cause explanation
 * - Time breakdown showing active vs wait time
 */
export function ExecutionGanttChart({
    executionStartedAt,
    executionCompletedAt,
    steps = [],
    showTimeBreakdown = true
}: ExecutionGanttChartProps) {
    if (steps.length === 0) return null;

    const start = new Date(executionStartedAt || steps[0].executedAt).getTime();
    const end = executionCompletedAt
        ? new Date(executionCompletedAt).getTime()
        : (steps.length > 0 ? new Date(steps[steps.length - 1].completedAt || Date.now()).getTime() : Date.now());

    const totalDuration = Math.max(end - start, 1000); // Avoid div by zero

    // Calculate wait times between steps
    const stepsWithWait = steps.map((step, index) => {
        const stepStart = new Date(step.executedAt).getTime();
        const stepEnd = step.completedAt ? new Date(step.completedAt).getTime() : Date.now();
        const activeDuration = Math.max(stepEnd - stepStart, 0);

        // Wait time is from previous step's completion to current step's start
        let waitDuration = 0;
        let waitStart = start;
        if (index > 0) {
            const prevStep = steps[index - 1];
            const prevEnd = prevStep.completedAt ? new Date(prevStep.completedAt).getTime() : stepStart;
            waitDuration = Math.max(stepStart - prevEnd, 0);
            waitStart = prevEnd;
        } else {
            // First step - wait from execution start to step start
            waitDuration = Math.max(stepStart - start, 0);
            waitStart = start;
        }

        return {
            ...step,
            activeDuration,
            waitDuration,
            waitStart,
            stepStart,
            stepEnd
        };
    });

    // Calculate totals
    const totalActiveDuration = stepsWithWait.reduce((sum, s) => sum + s.activeDuration, 0);
    const totalWaitDuration = stepsWithWait.reduce((sum, s) => sum + s.waitDuration, 0);
    const activePercentage = totalDuration > 0 ? Math.round((totalActiveDuration / totalDuration) * 100) : 0;
    const waitPercentage = totalDuration > 0 ? Math.round((totalWaitDuration / totalDuration) * 100) : 0;

    const formatDuration = (ms: number): string => {
        if (ms < 1000) return `${ms}ms`;
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    };

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        Execution Timeline
                    </CardTitle>
                    <span className="text-xs font-normal text-muted-foreground">
                        Total: {formatDuration(totalDuration)}
                    </span>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Time Breakdown */}
                {showTimeBreakdown && (
                    <div className="flex items-center gap-4 text-xs pb-2 border-b">
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 bg-green-500 rounded-sm" />
                            <span>Active: {formatDuration(totalActiveDuration)} ({activePercentage}%)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 bg-amber-400 rounded-sm opacity-60" style={{
                                backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)'
                            }} />
                            <span className="text-muted-foreground">Wait: {formatDuration(totalWaitDuration)} ({waitPercentage}%)</span>
                        </div>
                    </div>
                )}

                {/* Gantt Chart */}
                <div className="space-y-2 relative min-h-[100px]">
                    {/* Timeline markers */}
                    <div className="absolute top-0 bottom-0 left-0 w-px bg-border z-10" />
                    <div className="absolute top-0 bottom-0 right-0 w-px bg-border z-10" />

                    {stepsWithWait.map((step) => {
                        // Calculate relative positions
                        const waitLeft = ((step.waitStart - start) / totalDuration) * 100;
                        const waitWidth = Math.max(0.5, (step.waitDuration / totalDuration) * 100);
                        const activeLeft = ((step.stepStart - start) / totalDuration) * 100;
                        const activeWidth = Math.max(0.5, (step.activeDuration / totalDuration) * 100);

                        const statusColor =
                            step.status === 'success' ? 'bg-green-500' :
                                step.status === 'failure' ? 'bg-red-500' :
                                    step.status === 'running' ? 'bg-blue-500' : 'bg-gray-400';

                        return (
                            <div key={step.id} className="relative h-10 flex items-center group">
                                {/* Label */}
                                <div className="w-1/4 pr-2 text-xs truncate flex items-center gap-1">
                                    <span className="font-mono text-muted-foreground">#{step.stepOrder + 1}</span>
                                    <span title={step.jobName || 'Step'}>{step.jobName || 'Step'}</span>
                                </div>

                                {/* Bar Track */}
                                <div className="flex-1 relative h-full bg-muted/20 rounded">
                                    {/* Wait Bar (if any) */}
                                    {step.waitDuration > 0 && (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div
                                                        className="absolute h-4 top-3 rounded-sm bg-amber-400 opacity-50 cursor-pointer"
                                                        style={{
                                                            left: `${waitLeft}%`,
                                                            width: `${waitWidth}%`,
                                                            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)'
                                                        }}
                                                    />
                                                </TooltipTrigger>
                                                <TooltipContent className="text-xs">
                                                    <div className="flex items-center gap-1 font-bold text-amber-600">
                                                        <Hourglass className="w-3 h-3" />
                                                        Wait Time
                                                    </div>
                                                    <div>Duration: {formatDuration(step.waitDuration)}</div>
                                                    {step.waitReason && (
                                                        <div className="text-muted-foreground">{step.waitReason}</div>
                                                    )}
                                                    {!step.waitReason && step.stepOrder > 0 && (
                                                        <div className="text-muted-foreground">Waiting for previous step</div>
                                                    )}
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )}

                                    {/* Active Bar */}
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div
                                                    className={`absolute h-4 top-3 rounded-sm ${statusColor} opacity-80 hover:opacity-100 transition-opacity cursor-pointer`}
                                                    style={{ left: `${activeLeft}%`, width: `${activeWidth}%` }}
                                                />
                                            </TooltipTrigger>
                                            <TooltipContent className="text-xs">
                                                <div className="font-bold">{step.jobName || 'Step'}</div>
                                                <div className="flex items-center gap-1">
                                                    <Badge variant="outline" className="text-[10px] h-4">
                                                        {step.status}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-1 mt-1">
                                                    <Clock className="w-3 h-3" />
                                                    Active: {formatDuration(step.activeDuration)}
                                                </div>
                                                {step.waitDuration > 0 && (
                                                    <div className="flex items-center gap-1 text-amber-600">
                                                        <Hourglass className="w-3 h-3" />
                                                        Wait: {formatDuration(step.waitDuration)}
                                                    </div>
                                                )}
                                                {step.traceId && (
                                                    <div className="font-mono text-[10px] mt-1 text-muted-foreground">
                                                        Trace: {step.traceId.substring(0, 8)}...
                                                    </div>
                                                )}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Legend */}
                <div className="flex items-center justify-end gap-4 text-[10px] text-muted-foreground pt-2 border-t">
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full" />
                        Success
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-red-500 rounded-full" />
                        Failed
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                        Running
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-amber-400 rounded-full opacity-60" />
                        Wait Time
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export default ExecutionGanttChart;
