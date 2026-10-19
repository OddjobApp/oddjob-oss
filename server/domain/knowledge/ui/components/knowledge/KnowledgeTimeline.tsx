import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { format } from 'date-fns';
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea, ScrollBar } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@domain-ui/core/ui/components/ui/tooltip";
import { Clock, Activity, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface KnowledgeTimelineProps {
    executions: any[];
    onExecutionClick?: (execution: any) => void;
}

const KnowledgeTimeline: React.FC<KnowledgeTimelineProps> = ({ executions, onExecutionClick }) => {

    // 1. Prepare Data
    // Group by Pipeline or Service?
    // Sort by startedAt desc
    const sortedExecutions = useMemo(() => {
        if (!executions) return [];
        return [...executions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    }, [executions]);

    // Group by Pipeline Name for Swimlanes
    const groupedExecutions = useMemo(() => {
        const groups: Record<string, any[]> = {};
        sortedExecutions.forEach(exec => {
            const key = exec.pipeline?.name || exec.job?.name || 'Unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push(exec);
        });
        return groups;
    }, [sortedExecutions]);

    if (!executions || executions.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                <Clock className="w-10 h-10 opacity-20" />
                <p>No execution history available.</p>
                <p className="text-xs">Run a pipeline to see the timeline.</p>
            </div>
        );
    }

    // Determine status color
    const getStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'completed': return 'bg-green-500';
            case 'failed': return 'bg-red-500';
            case 'running': return 'bg-blue-500';
            default: return 'bg-muted';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'completed': return <CheckCircle className="w-3 h-3 text-foreground" />;
            case 'failed': return <XCircle className="w-3 h-3 text-foreground" />;
            case 'running': return <Activity className="w-3 h-3 text-foreground animate-pulse" />;
            default: return <div className="w-2 h-2 rounded-full bg-card" />;
        }
    };

    return (
        <Card className="h-full border-0 shadow-none bg-transparent flex flex-col">
            <CardHeader className="pb-2 flex-none">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="w-5 h-5 text-indigo-600" />
                    Interactive Timeline
                </CardTitle>
                <CardDescription>Execution history across pipelines and services.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden relative p-0 border rounded-tl-lg mt-2 bg-muted/50">
                <ScrollArea className="h-full w-full p-4">
                    <div className="flex flex-col gap-6">
                        {Object.entries(groupedExecutions).map(([groupName, groupExecs]) => (
                            <div key={groupName} className="relative pl-4 border-l-2 border-border">
                                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                    <Badge variant="outline">{groupName}</Badge>
                                    <span className="text-xs text-muted-foreground">{groupExecs.length} runs</span>
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {groupExecs.map((exec) => (
                                        <TooltipProvider key={exec.id}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div
                                                        className={`
                                                            group relative h-12 min-w-[120px] rounded-md border shadow-sm 
                                                            cursor-pointer hover:shadow-md transition-all flex items-center px-3 gap-2 bg-foreground
                                                            ${onExecutionClick ? 'hover:scale-[1.02]' : ''}
                                                        `}
                                                        onClick={() => onExecutionClick && onExecutionClick(exec)}
                                                    >
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${getStatusColor(exec.status)}`}>
                                                            {getStatusIcon(exec.status)}
                                                        </div>
                                                        <div className="flex flex-col overflow-hidden">
                                                            <span className="text-xs font-medium truncate w-full">Run #{exec.id}</span>
                                                            <span className="text-[10px] text-muted-foreground truncate">
                                                                {format(new Date(exec.startedAt), 'MMM d, HH:mm')}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent align="start" className="w-64 p-3">
                                                    <div className="space-y-1">
                                                        <p className="font-semibold text-sm">{exec.pipeline?.name} - Run #{exec.id}</p>
                                                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                                            <span>Status: <span className={exec.status === 'failed' ? 'text-red-500' : 'text-green-500'}>{exec.status}</span></span>
                                                            <span>Duration: {exec.duration ? `${Math.round(exec.duration / 1000)}s` : 'N/A'}</span>
                                                        </div>
                                                        {exec.error && (
                                                            <div className="mt-2 p-2 bg-red-50 text-red-700 rounded text-xs border border-red-100 flex gap-2">
                                                                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                                                <span className="break-words line-clamp-2">{exec.error}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
};

export default KnowledgeTimeline;
