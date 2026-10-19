import React, { useState, Suspense, lazy, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Loader2, Search } from "lucide-react";
import { useAgentMemory } from "@domain-ui/agents/ui/modules/agents/hooks/use-agent-memory";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

// Lazy load heavy agent components
const AgentRunList = lazy(() => import("../components/AgentRunList"));
const AgentExecutionTrace = lazy(() => import("../components/AgentExecutionTrace"));
const AgentOptimizationPanel = lazy(() => import("../components/AgentOptimizationPanel"));
const ResponsePalette = lazy(() => import("../components/ResponsePalette"));
const AgentLongTermMemoryList = lazy(() => import("../components/AgentLongTermMemoryList"));

// Loading fallback
const ComponentLoader = () => (
    <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
);

export default function AgentMemoryView() {
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [statusFilter, setStatusFilter] = useState<string>("all");

    // Use custom hook for all data fetching and mutations
    const {
        runs,
        runsLoading,
        steps,
        stepsLoading,
        suggestions,
        suggestionsLoading,
        optimizeMutation,
        applyMutation
    } = useAgentMemory(selectedRunId);

    // Filter and search runs
    const filteredRuns = useMemo(() => {
        if (!runs) return [];

        return runs.filter((run: any) => {
            // Status filter
            if (statusFilter !== "all") {
                const hasError = run.steps?.some((s: any) => s.status === 'error');
                if (statusFilter === "success" && hasError) return false;
                if (statusFilter === "error" && !hasError) return false;
            }

            // Search filter
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                const matchesRunId = run.runId?.toLowerCase().includes(query);
                const matchesGoal = run.goal?.toLowerCase().includes(query);
                return matchesRunId || matchesGoal;
            }

            return true;
        });
    }, [runs, searchQuery, statusFilter]);


    return (
        <div className="w-full p-4 md:p-6 h-[calc(100vh-64px)] flex flex-col gap-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Agent Memory</h1>
                    <p className="text-muted-foreground mt-1">
                        Browse full execution history and thought processes of agent runs.
                    </p>
                </div>
            </div>

            {/* Search and Filter Bar */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by run ID or goal..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[150px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Runs</SelectItem>
                        <SelectItem value="success">Success Only</SelectItem>
                        <SelectItem value="error">Errors Only</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
                <Suspense fallback={<ComponentLoader />}>
                    <AgentRunList
                        runs={filteredRuns}
                        runsLoading={runsLoading}
                        selectedRunId={selectedRunId}
                        onRunSelect={setSelectedRunId}
                    />
                </Suspense>

                <Tabs defaultValue="trace" className="col-span-8 flex flex-col">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="trace">Execution Trace</TabsTrigger>
                        <TabsTrigger value="optimize">Run Analysis</TabsTrigger>
                        <TabsTrigger value="knowledge">System Knowledge</TabsTrigger>
                        <TabsTrigger value="palette">Response Palette</TabsTrigger>
                    </TabsList>

                    <TabsContent value="trace" className="flex-1 min-h-0 m-0">
                        <Suspense fallback={<ComponentLoader />}>
                            <AgentExecutionTrace
                                selectedRunId={selectedRunId}
                                steps={steps}
                                stepsLoading={stepsLoading}
                            />
                        </Suspense>
                    </TabsContent>

                    <TabsContent value="optimize" className="flex-1 min-h-0 m-0">
                        <Suspense fallback={<ComponentLoader />}>
                            <AgentOptimizationPanel
                                selectedRunId={selectedRunId}
                                suggestions={suggestions}
                                suggestionsLoading={suggestionsLoading}
                                optimizeMutation={optimizeMutation}
                                applyMutation={applyMutation}
                                onApplySuggestion={(suggestionId) => applyMutation.mutate(suggestionId)}
                            />
                        </Suspense>
                    </TabsContent>

                    <TabsContent value="knowledge" className="flex-1 min-h-0 m-0">
                        <Suspense fallback={<ComponentLoader />}>
                            <AgentLongTermMemoryList searchQuery={searchQuery} />
                        </Suspense>
                    </TabsContent>

                    <TabsContent value="palette" className="flex-1 min-h-0 m-0">
                        <Suspense fallback={<ComponentLoader />}>
                            <ResponsePalette
                                selectedRunId={selectedRunId}
                            />
                        </Suspense>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}

