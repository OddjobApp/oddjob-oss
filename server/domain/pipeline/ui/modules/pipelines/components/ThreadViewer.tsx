
import React, { useState } from 'react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import {
    History,
    BrainCircuit,
    Bot,
    Wrench,
    ArrowRight,
    RotateCcw,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Play
} from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";

interface ThreadItem {
    id: string;
    type: "replan" | "critique" | "handoff" | "thought";
    observation: string;
    thought?: string;
    timestamp: string;
}

interface ThreadViewerProps {
    executionId: number;
    className?: string;
}

export function ThreadViewer({ executionId, className }: ThreadViewerProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [forkDialogOpen, setForkDialogOpen] = useState(false);
    const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);
    const [modifiedThought, setModifiedThought] = useState("");

    const { data: threadData, isLoading } = useQuery({
        queryKey: ['observability', 'thread', executionId],
        queryFn: async () => {
            const res = await fetch(`/api/observability/execution/${executionId}/thread`);
            if (!res.ok) throw new Error("Failed to fetch thread");
            return res.json();
        },
        refetchInterval: (query) => {
            const data = query.state.data;
            return data?.status === 'running' ? 2000 : false;
        }
    });

    const forkMutation = useMutation({
        mutationFn: async (data: { originalExecutionId: number, historyIndex: number, modifiedThought?: string }) => {
            const res = await fetch("/api/observability/fork", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Fork failed");
            }
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Time Travel Successful",
                description: "New execution started from the selected point.",
            });
            setForkDialogOpen(false);
            // Optional: Redirect to new execution
            window.location.href = `/operations/workstream-executions/${data.forkedExecutionId}`;
        },
        onError: (err) => {
            toast({
                title: "Time Travel Failed",
                description: err.message,
                variant: "destructive"
            });
        }
    });

    const handleRewindClick = (index: number, thought?: string) => {
        setSelectedHistoryIndex(index);
        setModifiedThought(thought || "");
        setForkDialogOpen(true);
    };

    const handleForkSubmit = () => {
        if (selectedHistoryIndex === null) return;
        forkMutation.mutate({
            originalExecutionId: executionId,
            historyIndex: selectedHistoryIndex,
            modifiedThought: modifiedThought
        });
    };

    if (isLoading) {
        return <div className="p-4 text-center">Loading execution thread...</div>;
    }

    if (!threadData || !threadData.thread) {
        return <div className="p-4 text-center text-muted-foreground">No execution history available.</div>;
    }

    return (
        <Card className={`flex flex-col h-full bg-background/50 border-border backdrop-blur-sm ${className}`}>
            <CardHeader className="py-3 px-4 border-b border-border flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                    <BrainCircuit className="w-5 h-5 text-indigo-400" />
                    <CardTitle className="text-sm font-medium text-foreground">
                        Decision Trace
                    </CardTitle>
                </div>
                <Badge variant={threadData.status === 'running' ? 'default' : 'secondary'}>
                    {threadData.status}
                </Badge>
            </CardHeader>

            <ScrollArea className="flex-1 p-4">
                <div className="space-y-6">
                    {/* Intent / Goal */}
                    <div className="relative pl-6 pb-2 border-l-2 border-indigo-500/30">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-indigo-900 border-2 border-indigo-500 flex items-center justify-center">
                            <Play className="w-2 h-2 text-indigo-200 fill-indigo-200" />
                        </div>
                        <div className="mb-1 text-xs font-semibold text-indigo-400">ORIGINAL INTENT</div>
                        <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-500/20 text-indigo-100 text-sm">
                            {threadData.intent}
                        </div>
                    </div>

                    {/* Timeline Items */}
                    {threadData.thread.map((item: ThreadItem, index: number) => (
                        <div key={item.id} className="relative pl-6 pb-2 border-l-2 border-border last:border-0">
                            {/* Timeline Dot */}
                            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 flex items-center justify-center
                 ${item.type === 'thought' ? 'bg-purple-900 border-purple-500' :
                                    item.type === 'critique' ? 'bg-red-900 border-red-500' :
                                        item.type === 'handoff' ? 'bg-blue-900 border-blue-500' :
                                            'bg-card border-border'}
               `}>
                                {item.type === 'thought' && <BrainCircuit className="w-2 h-2 text-purple-200" />}
                                {item.type === 'critique' && <AlertTriangle className="w-2 h-2 text-red-200" />}
                                {item.type === 'handoff' && <ArrowRight className="w-2 h-2 text-blue-200" />}
                                {item.type === 'replan' && <RotateCcw className="w-2 h-2 text-foreground" />}
                            </div>

                            <div className="group relative">
                                {/* Header */}
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-xs font-semibold uppercase 
                      ${item.type === 'thought' ? 'text-purple-400' :
                                            item.type === 'critique' ? 'text-red-400' :
                                                item.type === 'handoff' ? 'text-blue-400' :
                                                    'text-muted-foreground'}
                    `}>
                                        {item.type}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">{new Date(item.timestamp).toLocaleTimeString()}</span>
                                </div>

                                {/* Content Card */}
                                <div className="p-3 rounded-lg bg-card/50 border border-border text-sm text-foreground">
                                    {item.thought && (
                                        <div className="mb-2 pb-2 border-b border-border font-mono text-xs text-purple-300/80 italic">
                                            "{item.thought}"
                                        </div>
                                    )}
                                    <div className="whitespace-pre-wrap">{item.observation}</div>
                                </div>

                                {/* Time Travel Button (Hover) */}
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="absolute -right-3 -top-2 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full bg-muted border-border hover:bg-indigo-600 hover:border-indigo-500"
                                    onClick={() => handleRewindClick(index, item.thought)}
                                    title="Rewind to this state"
                                >
                                    <RotateCcw className="w-3 h-3 text-foreground" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            {/* Time Travel Dialog */}
            <Dialog open={forkDialogOpen} onOpenChange={setForkDialogOpen}>
                <DialogContent className="sm:max-w-[500px] bg-background border-border text-foreground">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <RotateCcw className="w-5 h-5 text-indigo-400" />
                            Time Travel / Fork Execution
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            You are about to rewind the execution to this point. You can optionally modify the agent's thought process to guide it down a different path.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-2">
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                            Inject Modified Thought (Optional)
                        </label>
                        <Textarea
                            value={modifiedThought}
                            onChange={(e) => setModifiedThought(e.target.value)}
                            className="bg-card border-border text-foreground focus:ring-indigo-500 min-h-[100px]"
                            placeholder="Enter a new thought to steer the agent..."
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setForkDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleForkSubmit} className="bg-indigo-600 hover:bg-indigo-700 text-foreground gap-2">
                            <Play className="w-4 h-4" />
                            Resume from Here
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

