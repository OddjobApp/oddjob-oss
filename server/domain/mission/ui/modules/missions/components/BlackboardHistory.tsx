
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { History, Clock, ArrowRight, User, Bot } from "lucide-react";
import { format } from "date-fns";

interface BlackboardHistoryProps {
    missionId: number;
    currentBlackboard: any;
}

export function BlackboardHistory({ missionId, currentBlackboard }: BlackboardHistoryProps) {
    const { data: history = [] } = useQuery<any[]>({
        queryKey: [`/api/missions/${missionId}/history`],
    });

    const [selectedIndex, setSelectedIndex] = useState<number>(-1);

    // Combine current state with history for a full timeline
    const timeline = useMemo(() => {
        const sortedHistory = [...history].sort((a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        // Add "Now" as the last entry
        return [
            ...sortedHistory,
            {
                id: 'current',
                createdAt: new Date().toISOString(),
                changedBy: 'Current State',
                blackboard: currentBlackboard
            }
        ];
    }, [history, currentBlackboard]);

    // Handle initial load or when new history arrives
    const maxIndex = timeline.length - 1;
    const effectiveIndex = selectedIndex === -1 ? maxIndex : selectedIndex;
    const selectedSnapshot = timeline[effectiveIndex];

    const handleValueChange = (val: number[]) => {
        setSelectedIndex(val[0]);
    };

    if (timeline.length <= 1) {
        return (
            <div className="text-center text-muted-foreground p-8">
                <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No history recorded yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-background/20 p-4 rounded-lg border border-border space-y-4">
                <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-primary">
                        <Clock className="w-4 h-4" />
                        <span className="font-mono font-bold">
                            {selectedSnapshot.id === 'current' ? 'LATEST' : `SNAPSHOT #${selectedSnapshot.id}`}
                        </span>
                    </div>
                    <div className="text-muted-foreground">
                        {format(new Date(selectedSnapshot.createdAt), "MMM d, h:mm:ss a")}
                    </div>
                </div>

                <Slider
                    defaultValue={[maxIndex]}
                    value={[effectiveIndex]}
                    max={maxIndex}
                    step={1}
                    onValueChange={handleValueChange}
                    className="py-4 cursor-pointer"
                />

                <div className="flex items-center justify-between text-xs text-muted-foreground/70 px-1">
                    <span>Mission Start</span>
                    <span>Now</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-foreground/5 border-border/50 col-span-1">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Change Context</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <div>
                            <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Author</span>
                            <div className="flex items-center gap-2">
                                {selectedSnapshot.changedBy?.includes('user') ? (
                                    <User className="w-4 h-4 text-primary" />
                                ) : (
                                    <Bot className="w-4 h-4 text-blue-400" />
                                )}
                                <span className="font-mono">{selectedSnapshot.changedBy || 'System'}</span>
                            </div>
                        </div>
                        {selectedSnapshot.changeReason && (
                            <div>
                                <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Reason</span>
                                <p className="italic text-foreground/80">"{selectedSnapshot.changeReason}"</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="bg-background/40 border-primary/20 col-span-2">
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                        <div className="flex items-center gap-2">
                            <History className="w-4 h-4 text-primary" />
                            <CardTitle className="text-sm font-medium text-primary">Blackboard State</CardTitle>
                        </div>
                        {selectedSnapshot.id !== 'current' && (
                            <div className="text-xs text-yellow-500 flex items-center gap-1">
                                <History size={12} />
                                Viewing Historical State
                            </div>
                        )}
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] overflow-auto rounded-md bg-background/50 p-4 border border-border">
                            <pre className="text-xs font-mono text-green-400/90 whitespace-pre-wrap">
                                {JSON.stringify(selectedSnapshot.blackboard, null, 2)}
                            </pre>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
