import React from "react";
import { format } from "date-fns";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Loader2, Search } from "lucide-react";
import { Input } from "@domain-ui/core/ui/components/ui/input";

interface AgentRunSummary {
    runId: string;
    jobId: number | null;
    lastActive: string;
    stepCount: number;
    summary: string; // approximate first user message or goal
}

interface AgentRunListProps {
    runs: AgentRunSummary[] | undefined;
    runsLoading: boolean;
    selectedRunId: string | null;
    onRunSelect: (runId: string) => void;
}

export default function AgentRunList({ runs, runsLoading, selectedRunId, onRunSelect }: AgentRunListProps) {
    return (
        <Card className="col-span-4 flex flex-col h-full overflow-hidden">
            <CardHeader className="py-4 px-6 border-b">
                <CardTitle className="text-lg">Recent Runs</CardTitle>
                <div className="relative mt-2">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search runs..." className="pl-8 h-9" />
                </div>
            </CardHeader>
            <div className="flex-1 overflow-auto">
                {runsLoading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <ScrollArea className="h-full">
                        <div className="divide-y">
                            {runs?.map((run) => (
                                <div
                                    key={run.runId}
                                    className={`p-4 cursor-pointer hover:bg-muted/50 transition-colors border-l-4 ${
                                        selectedRunId === run.runId
                                            ? "bg-muted border-primary"
                                            : "border-transparent"
                                    }`}
                                    onClick={() => onRunSelect(run.runId)}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {run.runId.substring(0, 8)}...
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {format(new Date(run.lastActive), "MMM d, HH:mm")}
                                        </span>
                                    </div>
                                    <div className="font-medium text-sm line-clamp-2 mb-2">
                                        {run.summary || "No description"}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-xs font-normal h-5">
                                            Job #{run.jobId || "N/A"}
                                        </Badge>
                                        <Badge variant="secondary" className="text-xs font-normal h-5">
                                            {run.stepCount} steps
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </div>
        </Card>
    );
}
