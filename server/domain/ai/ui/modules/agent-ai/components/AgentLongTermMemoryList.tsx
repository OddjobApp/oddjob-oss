
import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Brain, Bookmark, Shield, Zap, Clock } from "lucide-react";
import { useLongTermMemory } from "@domain-ui/agents/ui/modules/agents/hooks/use-long-term-memory";
import { formatDistanceToNow } from "date-fns";

interface AgentLongTermMemoryListProps {
    searchQuery?: string;
}

export default function AgentLongTermMemoryList({ searchQuery }: AgentLongTermMemoryListProps) {
    const { memories, isLoading } = useLongTermMemory(searchQuery);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-4 animate-pulse">
                {[1, 2, 3].map(i => (
                    <div key={i} className="h-32 bg-muted rounded-xl" />
                ))}
            </div>
        );
    }

    if (!memories || memories.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-xl border-muted">
                <Brain className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
                <h3 className="text-lg font-medium">No long-term memories found</h3>
                <p className="text-muted-foreground text-sm max-w-xs mt-1">
                    As the agent works across missions, it will autonomously store facts and preferences here.
                </p>
            </div>
        );
    }

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'preference': return <Bookmark className="h-4 w-4 text-blue-500" />;
            case 'fact': return <Shield className="h-4 w-4 text-green-500" />;
            case 'strategy': return <Zap className="h-4 w-4 text-purple-500" />;
            default: return <Brain className="h-4 w-4 text-muted-foreground" />;
        }
    };

    return (
        <div className="flex flex-col gap-4 overflow-y-auto pr-2">
            {memories.map((memory: any) => (
                <Card key={memory.id} className="group hover:border-primary/50 transition-all duration-300 bg-card/50 backdrop-blur-sm border-muted/20 shadow-sm">
                    <CardHeader className="p-4 pb-2">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                                <div className="p-2 bg-muted/50 rounded-lg">
                                    {getTypeIcon(memory.type)}
                                </div>
                                <div>
                                    <CardTitle className="text-sm font-semibold capitalize flex items-center gap-2">
                                        {memory.type}
                                        {memory.key && (
                                            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                                {memory.key}
                                            </span>
                                        )}
                                    </CardTitle>
                                    <CardDescription className="text-[10px] flex items-center gap-1 mt-0.5">
                                        <Clock className="h-3 w-3" />
                                        Learned {formatDistanceToNow(new Date(memory.createdAt))} ago
                                    </CardDescription>
                                </div>
                            </div>
                            <Badge variant={memory.importance > 7 ? "destructive" : "secondary"} className="text-[10px]">
                                Importance: {memory.importance}/10
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-2">
                        <p className="text-sm text-foreground/90 leading-relaxed">
                            {memory.content}
                        </p>
                        {memory.metadata && Object.keys(memory.metadata).length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {Object.entries(memory.metadata).map(([k, v]) => (
                                    <span key={k} className="text-[10px] px-1.5 py-0.5 bg-primary/5 text-primary rounded border border-primary/10">
                                        {k}: {String(v)}
                                    </span>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
