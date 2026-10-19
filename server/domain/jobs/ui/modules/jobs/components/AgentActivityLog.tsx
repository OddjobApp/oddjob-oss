import React from 'react';
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Activity, CheckCircle2, XCircle, Clock, AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface ActivityStep {
    id: number | string;
    type: string;
    status: string;
    timestamp: string | Date;
    details?: {
        content?: string;
        stepType?: string;
        jobName?: string;
        [key: string]: any;
    };
}

interface AgentActivityLogProps {
    steps: ActivityStep[];
    isLoading?: boolean;
    className?: string;
}

export function AgentActivityLog({ steps, isLoading, className }: AgentActivityLogProps) {
    if (isLoading) {
        return (
            <div className="space-y-4 p-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-start gap-3">
                        <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                        <div className="flex-1 space-y-2 py-1">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-3 w-2/3" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (!steps || steps.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                <Activity className="w-12 h-12 mb-4 opacity-10" />
                <p className="text-sm font-medium">No activity recorded yet</p>
                <p className="text-xs opacity-60">Real-time reasoning logs will appear here</p>
            </div>
        );
    }

    const getStatusIcon = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'completed':
            case 'success':
                return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
            case 'failed':
            case 'error':
                return <XCircle className="w-4 h-4 text-rose-500" />;
            case 'running':
            case 'active':
                return <Activity className="w-4 h-4 text-blue-500 animate-pulse" />;
            case 'pending':
                return <Clock className="w-4 h-4 text-amber-500" />;
            default:
                return <ChevronRight className="w-4 h-4 text-muted-foreground" />;
        }
    };

    const getStatusBg = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'completed':
            case 'success':
                return "bg-emerald-500/10 border-emerald-500/20";
            case 'failed':
            case 'error':
                return "bg-rose-500/10 border-rose-500/20";
            case 'running':
            case 'active':
                return "bg-blue-500/10 border-blue-500/20";
            default:
                return "bg-muted/5 border-border/10";
        }
    };

    return (
        <ScrollArea className={cn("h-full", className)}>
            <div className="p-4 space-y-4">
                {steps.map((step) => (
                    <div 
                        key={step.id} 
                        className={cn(
                            "flex gap-4 p-3 rounded-lg border transition-all hover:bg-foreground/5",
                            getStatusBg(step.status)
                        )}
                    >
                        <div className="mt-0.5 shrink-0">
                            {getStatusIcon(step.status)}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-bold text-foreground truncate uppercase tracking-tight">
                                    {step.details?.jobName || step.type?.replace(/_/g, ' ') || 'Process Step'}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                                    {formatDistanceToNow(new Date(step.timestamp), { addSuffix: true })}
                                </span>
                            </div>
                            
                            {(step.details?.content || step.details?.stepType) && (
                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 italic">
                                    {step.details.stepType && (
                                        <span className="font-bold text-[10px] uppercase mr-2 text-primary/70">
                                            [{step.details.stepType}]
                                        </span>
                                    )}
                                    {step.details.content}
                                </p>
                            )}
                            
                            <div className="flex items-center gap-2 pt-1">
                                <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest h-4 px-1 border-foreground/10">
                                    {step.status}
                                </Badge>
                                {step.id && (
                                    <span className="text-[9px] font-mono opacity-30">
                                        #{String(step.id).substring(0, 8)}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}
