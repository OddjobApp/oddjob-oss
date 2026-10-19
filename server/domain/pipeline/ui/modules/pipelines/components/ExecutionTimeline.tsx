/**
 * ExecutionTimeline Component
 * 
 * Visualizes pipeline execution progress with a timeline view.
 * Shows step durations, statuses, and allows drilling into details.
 */

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@domain-ui/core/ui/components/ui/tooltip';
import {
    CheckCircle2,
    XCircle,
    Clock,
    Loader2,
    AlertTriangle,
    ChevronRight,
    Timer,
    Zap,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

export interface TimelineStep {
    id: number;
    name: string;
    status: StepStatus;
    startTime?: string | Date;
    endTime?: string | Date;
    durationMs?: number;
    order: number;
    error?: string;
    output?: string;
    retryCount?: number;
}

export interface ExecutionTimelineProps {
    /** Execution ID */
    executionId: number;
    /** Pipeline name */
    pipelineName?: string;
    /** Overall execution status */
    status: StepStatus;
    /** Start time of execution */
    startTime?: string | Date;
    /** End time of execution */
    endTime?: string | Date;
    /** Total duration in milliseconds */
    totalDurationMs?: number;
    /** Individual step executions */
    steps: TimelineStep[];
    /** Currently active step index */
    activeStepIndex?: number;
    /** Callback when a step is clicked */
    onStepClick?: (step: TimelineStep) => void;
    /** Show compact view */
    compact?: boolean;
    /** Additional className */
    className?: string;
}

const statusConfig: Record<StepStatus, { icon: React.ReactNode; color: string; bgColor: string }> = {
    pending: {
        icon: <Clock className="h-4 w-4" />,
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
    },
    running: {
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100',
    },
    completed: {
        icon: <CheckCircle2 className="h-4 w-4" />,
        color: 'text-green-500',
        bgColor: 'bg-green-100',
    },
    failed: {
        icon: <XCircle className="h-4 w-4" />,
        color: 'text-red-500',
        bgColor: 'bg-red-100',
    },
    skipped: {
        icon: <ChevronRight className="h-4 w-4" />,
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
    },
    cancelled: {
        icon: <AlertTriangle className="h-4 w-4" />,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-100',
    },
};

/**
 * Format duration in a human-readable way
 */
function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes < 60) return `${minutes}m ${seconds}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

/**
 * Individual timeline step component
 */
const TimelineStepItem = memo(function TimelineStepItem({
    step,
    isLast,
    isActive,
    onClick,
    compact,
}: {
    step: TimelineStep;
    isLast: boolean;
    isActive: boolean;
    onClick?: () => void;
    compact?: boolean;
}) {
    const config = statusConfig[step.status];

    return (
        <div className="relative flex gap-3">
            {/* Timeline line */}
            {!isLast && (
                <div
                    className={cn(
                        'absolute left-[15px] top-8 w-0.5 h-full -translate-x-1/2',
                        step.status === 'completed' ? 'bg-green-300' :
                        step.status === 'running' ? 'bg-blue-300' :
                        step.status === 'failed' ? 'bg-red-300' :
                        'bg-muted'
                    )}
                />
            )}

            {/* Status icon */}
            <div
                className={cn(
                    'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center z-10',
                    config.bgColor,
                    config.color,
                    isActive && 'ring-2 ring-offset-2 ring-blue-500'
                )}
            >
                {config.icon}
            </div>

            {/* Step content */}
            <div
                className={cn(
                    'flex-1 pb-6',
                    !isLast && 'border-l-0',
                    onClick && 'cursor-pointer hover:bg-muted/50 rounded-lg -ml-2 pl-2 pr-2 transition-colors'
                )}
                onClick={onClick}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className={cn(
                            'font-medium text-sm',
                            step.status === 'skipped' && 'text-muted-foreground'
                        )}>
                            {step.name}
                        </span>
                        {step.retryCount && step.retryCount > 0 && (
                            <Badge variant="outline" className="text-xs">
                                Retry #{step.retryCount}
                            </Badge>
                        )}
                    </div>
                    {step.durationMs !== undefined && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Timer className="h-3 w-3" />
                            {formatDuration(step.durationMs)}
                        </span>
                    )}
                </div>

                {!compact && (
                    <>
                        {step.startTime && (
                            <p className="text-xs text-muted-foreground mt-1">
                                Started {formatDistanceToNow(new Date(step.startTime), { addSuffix: true })}
                            </p>
                        )}
                        {step.error && (
                            <p className="text-xs text-red-500 mt-1 line-clamp-2">
                                {step.error}
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
});

/**
 * Progress bar showing overall execution progress
 */
const ExecutionProgressBar = memo(function ExecutionProgressBar({
    steps,
}: {
    steps: TimelineStep[];
}) {
    const { completed, failed, running, total } = useMemo(() => {
        return {
            completed: steps.filter(s => s.status === 'completed').length,
            failed: steps.filter(s => s.status === 'failed').length,
            running: steps.filter(s => s.status === 'running').length,
            total: steps.length,
        };
    }, [steps]);

    const completedPercent = (completed / total) * 100;
    const failedPercent = (failed / total) * 100;
    const runningPercent = (running / total) * 100;

    return (
        <div className="w-full">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{completed} of {total} steps completed</span>
                {failed > 0 && <span className="text-red-500">{failed} failed</span>}
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                {completedPercent > 0 && (
                    <div
                        className="bg-green-500 transition-all duration-500"
                        style={{ width: `${completedPercent}%` }}
                    />
                )}
                {runningPercent > 0 && (
                    <div
                        className="bg-blue-500 animate-pulse transition-all duration-500"
                        style={{ width: `${runningPercent}%` }}
                    />
                )}
                {failedPercent > 0 && (
                    <div
                        className="bg-red-500 transition-all duration-500"
                        style={{ width: `${failedPercent}%` }}
                    />
                )}
            </div>
        </div>
    );
});

/**
 * Memoized execution timeline component.
 * Visualizes the progress and timing of pipeline steps.
 */
export const ExecutionTimeline = memo(function ExecutionTimeline({
    executionId,
    pipelineName,
    status,
    startTime,
    endTime,
    totalDurationMs,
    steps,
    activeStepIndex,
    onStepClick,
    compact = false,
    className,
}: ExecutionTimelineProps) {
    const config = statusConfig[status];
    const sortedSteps = useMemo(
        () => [...steps].sort((a, b) => a.order - b.order),
        [steps]
    );

    return (
        <Card className={cn('w-full', className)}>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            'w-10 h-10 rounded-full flex items-center justify-center',
                            config.bgColor,
                            config.color
                        )}>
                            {config.icon}
                        </div>
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                {pipelineName || `Execution #${executionId}`}
                                <Badge
                                    variant={status === 'failed' ? 'destructive' : 
                                            status === 'completed' ? 'default' : 'secondary'}
                                    className="capitalize"
                                >
                                    {status}
                                </Badge>
                            </CardTitle>
                            <p className="text-xs text-muted-foreground">
                                {startTime && (
                                    <>Started {format(new Date(startTime), 'MMM d, yyyy HH:mm:ss')}</>
                                )}
                                {totalDurationMs && (
                                    <span className="ml-2 inline-flex items-center gap-1">
                                        <Zap className="h-3 w-3" />
                                        {formatDuration(totalDurationMs)}
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="mt-4">
                    <ExecutionProgressBar steps={sortedSteps} />
                </div>
            </CardHeader>

            <CardContent>
                <div className="space-y-0">
                    {sortedSteps.map((step, index) => (
                        <TimelineStepItem
                            key={step.id}
                            step={step}
                            isLast={index === sortedSteps.length - 1}
                            isActive={activeStepIndex === index}
                            onClick={onStepClick ? () => onStepClick(step) : undefined}
                            compact={compact}
                        />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
});

export default ExecutionTimeline;
