import React, { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Bot, Terminal, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

interface ReasoningStep {
    text: string;
    changedBy: string;
    createdAt: string;
}

interface ThoughtStreamProps {
    missionRunId: number;
}

export function ThoughtStream({ missionRunId }: ThoughtStreamProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const { data: feed, isLoading } = useQuery<ReasoningStep[]>({
        queryKey: ["/api/mission-runs", missionRunId, "reasoning"],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/mission-runs/${missionRunId}/reasoning`);
            return res.json();
        },
        refetchInterval: 5000, // Refresh every 5 seconds for "live" feel
    });

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
            });
        }
    }, [feed]);

    return (
        <Card className="bg-card border-primary/20 shadow-md overflow-hidden">
            <CardHeader className="bg-muted/50 border-b py-3">
                <CardTitle className="text-sm font-black text-primary flex items-center gap-2 uppercase tracking-widest">
                    <Terminal className="w-4 h-4" />
                    Recursive Reasoning Stream
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <ScrollArea className="h-[400px] p-4 bg-muted/30 font-mono text-[11px]" ref={scrollRef}>
                    {isLoading && !feed ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground animate-pulse">
                            Initializing neural link...
                        </div>
                    ) : feed?.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground italic">
                            No active reasoning detected. Waiting for agent initiation.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {Array.isArray(feed) && feed.map((step, idx) => (
                                <div key={idx} className="group border-l-2 border-primary/20 pl-4 py-1 hover:border-primary transition-colors">
                                    <div className="flex items-center justify-between mb-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                        <div className="flex items-center gap-2 text-primary font-bold uppercase tracking-tighter">
                                            <Bot className="w-3 h-3" />
                                            {step.changedBy.split(':')[0]}
                                        </div>
                                        <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                            <Clock className="w-2.5 h-2.5" />
                                            {format(new Date(step.createdAt), "HH:mm:ss")}
                                        </div>
                                    </div>
                                    <div className="text-foreground leading-relaxed break-words whitespace-pre-wrap">
                                        {typeof step.text === 'object' ? JSON.stringify(step.text) : step.text}
                                    </div>
                                </div>
                            ))}
                            <div className="flex items-center gap-2 text-primary/40 pt-2 animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                                Listening for incoming cognition...
                            </div>
                        </div>
                    )}
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
