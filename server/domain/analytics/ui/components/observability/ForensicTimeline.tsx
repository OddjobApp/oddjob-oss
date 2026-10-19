
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { AlertCircle, CheckCircle, Clock, Search } from 'lucide-react';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@domain-ui/core/ui/components/ui/tooltip";

interface TraceSpan {
    spanId: string;
    parentSpanId?: string | null;
    name: string;
    startTime: number; // ms offset
    endTime?: number;
    duration?: number;
    status: 'success' | 'failure' | 'timeout' | 'cancelled' | 'running';
    jobType: string;
    errorMessage?: string;
    children: TraceSpan[];
}

interface ForensicTimelineProps {
    executionId: number;
}

export function ForensicTimeline({ executionId }: ForensicTimelineProps) {
    const { data: spans, isLoading, error } = useQuery<TraceSpan[]>({
        queryKey: ['trace', executionId],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/observability/traces/execution/${executionId}`);
            return res.json();
        }
    });

    if (isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-64 w-full" /></div>;
    if (error) return <div className="p-4 text-destructive flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Failed to load trace data.</div>;
    if (!spans || spans.length === 0) return <div className="p-4 text-muted-foreground text-center">No forensic trace data found for this execution.</div>;

    // Calculate timeline bounds
    const rootStart = Math.min(...spans.map(s => s.startTime));
    const rootEnd = Math.max(...spans.map(s => (s.endTime || s.startTime)));
    const totalDuration = Math.max(rootEnd - rootStart, 100); // Avoid 0/0

    const renderSpan = (span: TraceSpan, depth = 0) => {
        const offset = Math.max(0, span.startTime - rootStart);
        const duration = span.duration || 0;
        const leftPct = (offset / totalDuration) * 100;
        const widthPct = Math.max((duration / totalDuration) * 100, 0.5); // Min 0.5% for visibility

        const statusColor = {
            success: 'bg-green-500',
            failure: 'bg-red-500',
            timeout: 'bg-yellow-500',
            cancelled: 'bg-gray-500',
            running: 'bg-blue-500 animate-pulse'
        }[span.status] || 'bg-gray-400';

        const statusIcon = {
            success: <CheckCircle className="w-3 h-3 text-green-500" />,
            failure: <AlertCircle className="w-3 h-3 text-red-500" />,
            timeout: <Clock className="w-3 h-3 text-yellow-500" />,
            cancelled: <Clock className="w-3 h-3 text-muted-foreground" />,
            running: <Clock className="w-3 h-3 text-blue-500" />
        }[span.status];

        return (
            <div key={span.spanId} className="group relative mb-1">
                {/* Row */}
                <div className="flex items-center h-8 hover:bg-muted dark:hover:bg-card rounded px-2 text-sm">
                    {/* Label Column (Tree) */}
                    <div className="w-1/3 flex items-center gap-2 overflow-hidden" style={{ paddingLeft: `${depth * 20}px` }}>
                        {statusIcon}
                        <span className="truncate font-medium">{span.name}</span>
                        <Badge variant="outline" className="text-[10px] h-4 px-1">{span.jobType}</Badge>
                    </div>

                    {/* Timeline Column */}
                    <div className="flex-1 relative h-6">

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div
                                        className={cn("absolute h-4 top-1 rounded opacity-80 group-hover:opacity-100 transition-all", statusColor)}
                                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                    />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <div className="text-xs">
                                        <div className="font-bold">{span.name}</div>
                                        <div>Duration: {duration.toFixed(0)}ms</div>
                                        <div>Status: {span.status}</div>
                                        {span.errorMessage && <div className="text-red-400 mt-1">{span.errorMessage}</div>}
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        {/* Grid Lines (Visual Guide) */}
                        <div className="absolute inset-0 pointer-events-none border-l border-slate-100 dark:border-border" style={{ left: '0%' }}></div>
                        <div className="absolute inset-0 pointer-events-none border-l border-slate-100 dark:border-border" style={{ left: '25%' }}></div>
                        <div className="absolute inset-0 pointer-events-none border-l border-slate-100 dark:border-border" style={{ left: '50%' }}></div>
                        <div className="absolute inset-0 pointer-events-none border-l border-slate-100 dark:border-border" style={{ left: '75%' }}></div>
                    </div>

                    {/* Duration Label */}
                    <div className="w-24 text-right text-xs text-muted-foreground tabular-nums">
                        {duration.toFixed(0)}ms
                    </div>
                </div>

                {/* Recursion */}
                {span.children?.map(child => renderSpan(child, depth + 1))}
            </div>
        );
    };

    return (
        <Card className="border-none shadow-none">
            <CardHeader className="p-4 pb-2">
                <div className="flex justify-between items-center">
                    <div className="flex gap-2 items-center">
                        <Search className="w-4 h-4 text-muted-foreground" />
                        <CardTitle className="text-lg">Execution Forensics</CardTitle>
                    </div>
                    <Badge variant="outline">Total: {totalDuration.toFixed(0)}ms</Badge>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <ScrollArea className="h-[500px] w-full p-4 pt-0">
                    <div className="min-w-[600px]">
                        {/* Header */}
                        <div className="flex items-center h-8 border-b mb-2 text-xs font-semibold text-muted-foreground">
                            <div className="w-1/3 pl-2">Span Name</div>
                            <div className="flex-1">Timeline</div>
                            <div className="w-24 text-right pr-2">Duration</div>
                        </div>
                        {spans.map(s => renderSpan(s))}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
