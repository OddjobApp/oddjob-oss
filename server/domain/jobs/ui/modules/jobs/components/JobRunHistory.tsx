import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle 
} from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { 
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import { 
    Play,
    Activity,
    CheckCircle2,
    XCircle,
    Clock,
    MoreVertical
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";

interface JobRunHistoryProps {
    jobId: number;
}

export default function JobRunHistory({ jobId }: JobRunHistoryProps) {
    const { data: executions, isLoading } = useQuery<any[]>({
        queryKey: [`/api/jobs/${jobId}/executions`],
        enabled: !!jobId,
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
        );
    }

    if (!executions || executions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
                <Activity className="w-12 h-12 text-muted-foreground/20" />
                <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No Execution History</p>
                    <p className="text-[11px] text-muted-foreground/60 max-w-[300px]">This agent has not been deployed yet.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead>Started</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead className="text-right">Input</TableHead>
                            <TableHead className="text-right">Output</TableHead>
                            <TableHead className="text-right">Dedup</TableHead>
                            <TableHead className="text-right">Null Drop</TableHead>
                            <TableHead className="text-right">Valid Drop</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                            <TableHead></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {executions.map((exec) => (
                            <ExecutionRow key={exec.id} execution={exec} />
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

function ExecutionRow({ execution }: { execution: any }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const hasTrace = !!execution.traceId;

    const getStatusBadge = () => {
        switch (execution.status) {
            case 'completed':
                return <Badge variant="default" className="bg-emerald-100 text-emerald-800 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" /> Success</Badge>;
            case 'failed':
                return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
            case 'running':
                return <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200"><Play className="w-3 h-3 mr-1 animate-pulse" /> Running</Badge>;
            default:
                return <Badge variant="secondary">{execution.status}</Badge>;
        }
    };

    const getDuration = () => {
        if (!execution.startedAt || !execution.completedAt) return '-';
        const start = new Date(execution.startedAt);
        const end = new Date(execution.completedAt);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return '-';
        const diff = end.getTime() - start.getTime();
        if (diff < 1000) return `${diff}ms`;
        if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
        return `${(diff / 60000).toFixed(1)}m`;
    };

    return (
        <>
            <TableRow>
                <TableCell>{getStatusBadge()}</TableCell>
                <TableCell className="text-sm">
                    {execution.startedAt && !isNaN(new Date(execution.startedAt).getTime())
                        ? formatDistanceToNow(new Date(execution.startedAt), { addSuffix: true })
                        : '—'}
                </TableCell>
                <TableCell className="text-sm font-mono">
                    {getDuration()}
                </TableCell>
                <TableCell className="text-right">
                    {execution.executionStats?.inputCount ?? '-'}
                </TableCell>
                <TableCell className="text-right font-medium">
                    {execution.executionStats?.outputCount ?? '-'}
                </TableCell>
                <TableCell className="text-right text-orange-600/80">
                    {execution.executionStats?.deduplicatedCount ? (
                        <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50">
                            {execution.executionStats.deduplicatedCount}
                        </Badge>
                    ) : '-'}
                </TableCell>
                <TableCell className="text-right text-red-600/80">
                    {execution.executionStats?.nullDroppedCount ? (
                        <span className="text-xs">{execution.executionStats.nullDroppedCount}</span>
                    ) : '-'}
                </TableCell>
                <TableCell className="text-right text-red-600/80">
                    {execution.executionStats?.validationDroppedCount ? (
                        <span className="text-xs">{execution.executionStats.validationDroppedCount}</span>
                    ) : '-'}
                </TableCell>
                <TableCell className="text-right text-blue-600/80 font-mono text-xs">
                    {execution.aiUsage?.costUsd ? `$${Number(execution.aiUsage.costUsd).toFixed(5)}` : '-'}
                </TableCell>
                <TableCell>
                    {hasTrace && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setIsExpanded(!isExpanded)}
                        >
                            <Activity className={`h-4 w-4 ${isExpanded ? 'text-primary' : 'text-muted-foreground'}`} />
                        </Button>
                    )}
                </TableCell>
            </TableRow>
            {isExpanded && execution.traceId && (
                <TableRow>
                    <TableCell colSpan={10} className="p-0 border-b-2 border-primary/10 bg-muted/20">
                        <div className="p-4">
                            <div className="text-sm text-muted-foreground font-mono">
                                Trace ID: <span className="text-foreground">{execution.traceId}</span>
                            </div>
                        </div>
                    </TableCell>
                </TableRow>
            )}
        </>
    );
}
