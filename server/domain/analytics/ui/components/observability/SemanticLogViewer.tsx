import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { Bot, Terminal, Eye, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronRight, Zap, Target } from 'lucide-react';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ForensicEvent {
    id: number;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    jobType: string;
    status: string;
    attributes: any;
    errorMessage?: string;
    createdAt: string;
    startTimeNs: string;
}

interface SemanticLogViewerProps {
    executionId: number;
}

export function SemanticLogViewer({ executionId }: SemanticLogViewerProps) {
    const { data: events, isLoading, error } = useQuery<ForensicEvent[]>({
        queryKey: ['semantic-trace', executionId],
        queryFn: async () => {
            // First get traceId from execution
            const execRes = await apiRequest('GET', `/api/pipeline-executions/${executionId}`);
            if (!execRes.ok) throw new Error("Failed to fetch execution");
            const execution = await execRes.json();

            if (!execution.traceId) return [];

            // Get all spans for this trace
            const res = await apiRequest('GET', `/api/observability/traces/${execution.traceId}`);
            if (!res.ok) throw new Error("Failed to fetch trace data");
            return res.json();
        }
    });

    if (isLoading) return (
        <div className="space-y-4 p-4">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-3/4 rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
    );

    if (error) return (
        <div className="p-12 text-center text-destructive border rounded-2xl bg-red-50/50">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="font-semibold">Failed to load reasoning trace</p>
            <p className="text-sm opacity-70">{(error as any).message}</p>
        </div>
    );

    // Filter and group events by iteration if possible
    // We look for agent.* events or thoughts
    const semanticEvents = (events || []).filter(e =>
        e.attributes?.event?.startsWith('agent.') ||
        e.attributes?.thought ||
        e.jobType === 'ai_agent'
    );

    if (semanticEvents.length === 0) return (
        <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-3xl bg-muted/50">
            <Bot className="w-12 h-12 mx-auto mb-4 opacity-10" />
            <p className="font-medium text-muted-foreground italic">No autonomous reasoning captured for this execution.</p>
            <p className="text-[10px] mt-2 text-foreground uppercase tracking-widest">Forensic trace: empty or pending</p>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between px-2 mb-2">
                <div>
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                        <Target className="w-4 h-4 text-indigo-500" />
                        Execution Reasoning
                    </h3>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold opacity-70">Autonomous Thinking Loop</p>
                </div>
                <div className="flex gap-2">
                    <Badge variant="outline" className="bg-foreground/50 text-[10px] h-5">
                        {semanticEvents.length} DECISIONS
                    </Badge>
                </div>
            </div>

            <ScrollArea className="h-[600px] w-full rounded-3xl bg-muted/30 border border-border p-6">
                <div className="space-y-10 relative">
                    {/* Vertical line connector */}
                    <div className="absolute left-[27px] top-6 bottom-6 w-0.5 bg-indigo-100/50 z-0" />

                    <AnimatePresence>
                        {semanticEvents.map((event, idx) => (
                            <LogStep key={event.id} event={event} index={idx} />
                        ))}
                    </AnimatePresence>
                </div>
            </ScrollArea>
        </div>
    );
}

function LogStep({ event, index }: { event: ForensicEvent, index: number }) {
    const isThought = event.attributes?.event === 'agent.thought' || (!event.attributes?.event && event.jobType === 'ai_agent');
    const isToolCall = event.attributes?.event === 'agent.tool_call';
    const isToolResult = event.attributes?.event === 'agent.tool_result';

    const icon = isThought ? <Bot className="w-5 h-5" /> :
        isToolCall ? <Terminal className="w-5 h-5" /> :
            <Eye className="w-5 h-5" />;

    const colors = isThought ? "bg-indigo-600 text-foreground shadow-indigo-100 ring-4 ring-indigo-50" :
        isToolCall ? "bg-muted text-foreground shadow-slate-100 ring-4 ring-slate-50" :
            "bg-emerald-500 text-foreground shadow-emerald-50 ring-4 ring-emerald-50";

    const title = isThought ? "Reasoning" :
        isToolCall ? `Action: ${event.attributes?.tool || 'External Call'}` :
            `Observation`;

    // Process content to remove JSON if present in thought
    let content = event.attributes?.content || "";
    if (isThought) {
        // Remove code blocks if they look like tool calls to keep it "semantic"
        content = content.replace(/```json[\s\S]*?```/g, '').trim();
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="relative flex gap-8 z-10"
        >
            <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-lg transition-transform hover:scale-105", colors)}>
                {icon}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.2em] flex items-center gap-2",
                        isThought ? "text-indigo-600" : isToolCall ? "text-muted-foreground" : "text-emerald-600"
                    )}>
                        {isThought && <Zap className="w-3 h-3 fill-current" />}
                        {title}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground font-medium">
                        {new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                </div>

                <div className={cn(
                    "rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-md",
                    isThought ? "bg-indigo-50/50 border border-indigo-100" :
                        isToolCall ? "bg-card border border-border" :
                            "bg-card border border-border shadow-sm"
                )}>
                    <div className="p-5">
                        {isThought ? (
                            <div className="prose prose-sm prose-slate max-w-none text-muted-foreground leading-relaxed font-medium">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {content || "_The agent is formulating a strategy..._"}
                                </ReactMarkdown>
                            </div>
                        ) : isToolCall ? (
                            <div className="space-y-4">
                                <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-2 border-b border-border pb-2 mb-2">
                                    <Terminal className="w-3 h-3" />
                                    EXECUTE_ACTION
                                </div>
                                <div className="font-mono text-[12px] text-amber-300/90 whitespace-pre-wrap break-all leading-tight bg-background/30 p-4 rounded-xl">
                                    {JSON.stringify(event.attributes?.params, null, 2)}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-2">
                                    <Eye className="w-3 h-3" />
                                    Environmental Observation
                                </div>
                                <div className="prose prose-sm prose-slate max-w-none text-muted-foreground bg-muted/80 p-4 rounded-xl border border-border overflow-x-auto shadow-inner">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {event.attributes?.result_snippet || event.attributes?.content || "Result received successfully."}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
