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
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@domain-ui/core/ui/components/ui/accordion";
import { 
    MessageSquare,
    CheckCircle,
    XCircle,
    Play,
    Clock,
    ChevronDown,
    ChevronUp
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";

interface AgentTraceViewerProps {
    traceId: string;
}

export default function AgentTraceViewer({ traceId }: AgentTraceViewerProps) {
    const { data: trace, isLoading } = useQuery<any>({
        queryKey: [`/api/traces/${traceId}`],
        enabled: !!traceId,
    });

    const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
        );
    }

    if (!trace || !trace.events) {
        return (
            <div className="text-sm text-muted-foreground p-4">
                No trace data available
            </div>
        );
    }

    const toggleEvent = (index: number) => {
        const newExpanded = new Set(expandedEvents);
        if (newExpanded.has(index)) {
            newExpanded.delete(index);
        } else {
            newExpanded.add(index);
        }
        setExpandedEvents(newExpanded);
    };

    return (
        <div className="space-y-2">
            {trace.events.map((event: any, index: number) => (
                <TraceEvent 
                    key={index} 
                    event={event} 
                    isExpanded={expandedEvents.has(index)}
                    onToggle={() => toggleEvent(index)}
                />
            ))}
        </div>
    );
}

function TraceEvent({ event, isExpanded, onToggle }: { event: any; isExpanded: boolean; onToggle: () => void }) {
    const { type, content, timestamp } = event;
    const timeStr = timestamp ? formatDistanceToNow(new Date(timestamp), { addSuffix: true }) : '';

    if (type === 'agent.thought') {
        return (
            <div className="border-l-2 border-blue-200 pl-3 py-2">
                <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-500 mt-0.5" />
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-blue-600">Thought</span>
                            <span className="text-xs text-muted-foreground">{timeStr}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{content.thought}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (type === 'agent.tool_call') {
        return (
            <div className="border-l-2 border-purple-200 pl-3 py-2">
                <div className="flex items-start gap-2">
                    <Play className="h-4 w-4 text-purple-500 mt-0.5" />
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-purple-600">Tool Call: {content.tool}</span>
                            <span className="text-xs text-muted-foreground">{timeStr}</span>
                        </div>
                        <Accordion type="single" collapsible className="w-full">
                            <AccordionItem value="params" className="border-none">
                                <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
                                    View Parameters
                                </AccordionTrigger>
                                <AccordionContent>
                                    <pre className="bg-secondary p-2 rounded text-xs overflow-x-auto">
                                        {JSON.stringify(content.params, null, 2)}
                                    </pre>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </div>
                </div>
            </div>
        );
    }

    if (type === 'agent.tool_result') {
        return (
            <div className="border-l-2 border-green-200 pl-3 py-2">
                <div className="flex items-start gap-2">
                    <div className={content.status === 'error' ? "bg-red-500/10 p-1.5 rounded-full" : "bg-green-500/10 p-1.5 rounded-full"}>
                        {content.status === 'error' ?
                            <XCircle className="h-3.5 w-3.5 text-red-500" /> :
                            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                        }
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-green-600">Tool Result: {content.tool}</span>
                            <span className="text-xs text-muted-foreground">{timeStr}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Length: {content.result_length || 0} chars
                        </div>
                        <Accordion type="single" collapsible className="w-full">
                            <AccordionItem value="result" className="border-none">
                                <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
                                    View Output
                                </AccordionTrigger>
                                <AccordionContent>
                                    <pre className="bg-secondary p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-[300px]">
                                        {content.result_snippet || "No output"}
                                    </pre>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </div>
                </div>
            </div>
        );
    }

    if (type === 'agent.response') {
        return (
            <div className="border-l-2 border-indigo-200 pl-3 py-2">
                <div className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-indigo-500 mt-0.5" />
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-indigo-600">Final Response</span>
                            <span className="text-xs text-muted-foreground">{timeStr}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{content.response}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="border-l-2 border-border pl-3 py-2">
            <div className="text-xs text-muted-foreground">
                Unknown Event: {type}
            </div>
        </div>
    );
}
