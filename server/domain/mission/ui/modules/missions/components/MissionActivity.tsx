import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, isValid } from "date-fns";
import {
    Activity,
    CheckCircle2,
    XCircle,
    PlayCircle,
    Clock,
    AlertCircle
} from "lucide-react";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Link } from "wouter";

interface MissionActivityProps {
    missionId: number;
}

interface ActivityItem {
    id: number | string;
    type: string;
    status: string;
    timestamp: string;
    message?: string;
    missionName?: string;
    details?: {
        pipelineId?: number;
        pipelineName?: string;
        runUuid: string;
        jobId?: number;
        jobName?: string;
        content?: string;
        stepType?: string;
    };
}

export function MissionActivity({ missionId }: MissionActivityProps) {
    const { data: activities, isLoading } = useQuery<ActivityItem[]>({
        queryKey: [`/api/missions/${missionId}/activity`],
        refetchInterval: 5000,
    });

    if (isLoading) {
        return (
            <div className="space-y-4 p-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-[200px]" />
                            <Skeleton className="h-4 w-[150px]" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (!Array.isArray(activities) || activities.length === 0) {
        return (
            <div className="text-center py-8 text-muted-foreground text-sm">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-20" />
                No recent activity recorded.
            </div>
        );
    }

    const getStatusIcon = (status: string, type: string) => {
        if (type === 'agent_step' || type === 'agent_action') {
            return <Activity className="w-4 h-4 text-primary" />;
        }
        switch (status) {
            case "completed":
                return <CheckCircle2 className="w-4 h-4 text-green-500" />;
            case "running":
                return <PlayCircle className="w-4 h-4 text-blue-500 animate-pulse" />;
            case "failed":
                return <XCircle className="w-4 h-4 text-red-500" />;
            case "cancelled":
                return <AlertCircle className="w-4 h-4 text-orange-500" />;
            default:
                return <Clock className="w-4 h-4 text-muted-foreground" />;
        }
    };

    const getStatusColor = (status: string, type: string) => {
        if (type === 'agent_step' || type === 'agent_action') return "border-primary/20 bg-primary/5";
        switch (status) {
            case "completed": return "border-green-500/20 bg-green-500/5";
            case "running": return "border-blue-500/20 bg-blue-500/5";
            case "failed": return "border-red-500/20 bg-red-500/5";
            default: return "border-border bg-foreground/5";
        }
    };

    return (
        <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3 p-4">
                {activities.map((item) => (
                    <div
                        key={`${item.type}-${item.id}`}
                        className={`flex gap-3 p-3 rounded-lg border ${getStatusColor(item.status, item.type)} transition-colors`}
                    >
                        <div className="mt-0.5">
                            {getStatusIcon(item.status, item.type)}
                        </div>
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium leading-none">
                                    {item.type === 'execution' && item.details?.pipelineId ? (
                                        <Link
                                            href={`/operations/workstreams/${item.details.pipelineId}`}
                                            className="hover:text-primary hover:underline transition-colors"
                                        >
                                            {item.details.pipelineName ?? item.missionName ?? 'Pipeline'}
                                        </Link>
                                    ) : (item.type === 'agent_step' || item.type === 'agent_action') && item.details?.jobId ? (
                                        <Link
                                            href={`/operations/agents/${item.details.jobId}`}
                                            className="hover:text-primary hover:underline transition-colors"
                                        >
                                            {item.details.jobName ?? 'Agent'}
                                        </Link>
                                    ) : (
                                        item.missionName ?? (item.type === 'execution' ? 'Pipeline' : 'Agent')
                                    )}
                                </p>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                    {isValid(new Date(item.timestamp))
                                        ? formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })
                                        : "recently"}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                                {item.type === 'execution' ? (
                                    <>
                                        {`${item.message || `Execution ${item.status}`} • Run #${item.details?.runUuid?.substring(0, 8) ?? 'N/A'}`}
                                        {item.status === 'failed' && item.details?.content && (
                                            <span className="block mt-1 text-red-400 font-mono text-[10px] bg-red-500/10 p-1 rounded border border-red-500/20">
                                                Reason: {item.details.content}
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <span className="font-semibold">{item.details?.stepType?.toUpperCase() ?? 'STEP'}: </span>
                                        {item.message || item.details?.content || 'Autonomous system event'}
                                    </>
                                )}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}
