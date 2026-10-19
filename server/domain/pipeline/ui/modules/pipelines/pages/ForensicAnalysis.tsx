import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { Loader2, ArrowRight, ChevronDown, Search, Activity, BarChart3, Clock, Layers } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface Pipeline {
    id: number;
    name: string;
}

interface KnowledgeNode {
    id: number;
    label: string;
    name: string;
    data: Record<string, any>;
    pipelineExecutionId: number;
    createdAt: string;
}

interface ExecutionResult {
    executionCount: number;
    nodeCount: number;
    executions: any[];
    nodes: KnowledgeNode[];
}

interface AnalysisResult {
    baselineResults: ExecutionResult;
    comparisonResults: ExecutionResult;
}

// Helper function to format date for datetime-local input (YYYY-MM-DDTHH:mm)
function formatDateTimeLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Helper function to get start of day
function getStartOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

// Helper function to get end of day
function getEndOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

import { AgentTraceTimeline } from "@domain-ui/analytics/ui/modules/observability";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";

export default function ForensicAnalysisPage() {
    const { toast } = useToast();

    // ... (keep existing state and logic for Ingestion Analysis) ...
    // Note: I need to wrap the existing "Configuration" + "Results" in a default tab content
    // But since I'm replacing the whole file content structure effectively, I should be careful.
    // The previous view_file showed lines 1-425.
    // I will keep the component logic but wrap the return JSX.

    // ... (existing helper functions and hooks) ...

    // Helper to get default dates
    const getDefaultDates = () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        return {
            baselineStart: formatDateTimeLocal(getStartOfDay(yesterday)),
            baselineEnd: formatDateTimeLocal(getEndOfDay(yesterday)),
            comparisonStart: formatDateTimeLocal(getStartOfDay(today)),
            comparisonEnd: formatDateTimeLocal(getEndOfDay(today)),
        };
    };

    // Configuration State
    const [selectedPipelines, setSelectedPipelines] = useState<string[]>([]);
    const [baselineStart, setBaselineStart] = useState<string>(() => getDefaultDates().baselineStart);
    const [baselineEnd, setBaselineEnd] = useState<string>(() => getDefaultDates().baselineEnd);
    const [comparisonStart, setComparisonStart] = useState<string>(() => getDefaultDates().comparisonStart);
    const [comparisonEnd, setComparisonEnd] = useState<string>(() => getDefaultDates().comparisonEnd);

    // Update dates when component mounts or when user navigates to this page
    useEffect(() => {
        const defaults = getDefaultDates();
        setBaselineStart(defaults.baselineStart);
        setBaselineEnd(defaults.baselineEnd);
        setComparisonStart(defaults.comparisonStart);
        setComparisonEnd(defaults.comparisonEnd);
    }, []); // Empty dependency array means this runs once on mount

    // Results State
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [groupingKeys, setGroupingKeys] = useState<string[]>(["label"]);
    const [searchQuery, setSearchQuery] = useState<string>("");

    // Fetch Pipelines
    const { data: pipelines = [] } = useQuery<Pipeline[]>({
        queryKey: ["/api/pipelines"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/pipelines");
            return res.json();
        },
    });

    // Analysis Mutation
    const analysisMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/knowledge-graph/forensics/aggregate-diff", {
                target_pipelines: selectedPipelines,
                baseline_window: {
                    start_time: new Date(baselineStart).toISOString(),
                    end_time: new Date(baselineEnd).toISOString(),
                },
                comparison_window: {
                    start_time: new Date(comparisonStart).toISOString(),
                    end_time: new Date(comparisonEnd).toISOString(),
                }
            });
            return res.json();
        },
        onSuccess: (data) => {
            setAnalysisResult(data);
            toast({
                title: "Analysis Complete",
                description: `Compared ${data.baselineResults.executionCount} baseline runs with ${data.comparisonResults.executionCount} comparison runs.`
            });
        },
        onError: (error: any) => {
            toast({
                title: "Analysis Failed",
                description: error.message,
                variant: "destructive"
            });
        }
    });

    // Aggregation Logic
    const aggregatedData = useMemo(() => {
        if (!analysisResult) return [];

        const groupKey = (node: KnowledgeNode, key: string) => {
            if (key === "label") return node.label;
            if (key === "name") return node.name;
            // Try to find in data
            return node.data?.[key] || "Unknown";
        };

        const processNodes = (nodes: KnowledgeNode[]) => {
            const map = new Map<string, number>();
            nodes.forEach(node => {
                const parts = groupingKeys.map(k => groupKey(node, k));
                const compositeKey = parts.join("::");
                map.set(compositeKey, (map.get(compositeKey) || 0) + 1);
            });
            return map;
        };

        const baselineMap = processNodes(analysisResult.baselineResults.nodes);
        const comparisonMap = processNodes(analysisResult.comparisonResults.nodes);

        const allKeys = new Set([...baselineMap.keys(), ...comparisonMap.keys()]);

        return Array.from(allKeys).map(key => {
            const parts = key.split("::");

            const groupData: Record<string, string> = {};
            groupingKeys.forEach((keyName, index) => {
                groupData[keyName] = parts[index] || "Unknown";
            });

            const baseCount = baselineMap.get(key) || 0;
            const compCount = comparisonMap.get(key) || 0;
            const netChange = compCount - baseCount;

            return {
                key,
                groupData,
                baseCount,
                compCount,
                netChange
            };
        }).filter(item => {
            if (!searchQuery) return true;
            return Object.values(item.groupData).some(val =>
                String(val).toLowerCase().includes(searchQuery.toLowerCase())
            );
        }).sort((a, b) => b.netChange - a.netChange); // Sort by biggest positive change

    }, [analysisResult, groupingKeys, searchQuery]);

    // Extract available grouping keys from data
    const availableKeys = useMemo(() => {
        const keys = new Set<string>(["label", "name"]);
        if (analysisResult) {
            const sample = [...analysisResult.baselineResults.nodes, ...analysisResult.comparisonResults.nodes].slice(0, 50);
            sample.forEach(node => {
                Object.keys(node.data || {}).forEach(k => keys.add(k));
            });
        }
        return Array.from(keys);
    }, [analysisResult]);

    return (
        <div className="flex flex-col h-screen bg-muted/50 dark:bg-background/50">
            {/* Header */}
            <header className="bg-white/80 dark:bg-card/80 backdrop-blur-md border-b px-8 py-6 sticky top-0 z-30">
                <div className="flex items-center gap-3 mb-1">
                    <Activity className="w-6 h-6 text-primary animate-pulse" />
                    <h1 className="text-2xl font-black tracking-tight text-foreground dark:text-white uppercase italic">Forensic Analysis</h1>
                </div>
                <p className="text-sm text-muted-foreground font-medium tracking-wide">Investigate ingestion variances and cross-process reasoning lineages</p>
            </header>

            <div className="flex-1 overflow-hidden">
                <Tabs defaultValue="ingestion" className="h-full flex flex-col">
                    <div className="px-6 py-2 border-b bg-card">
                        <TabsList>
                            <TabsTrigger value="ingestion">Pipeline Ingestion</TabsTrigger>
                            <TabsTrigger value="agent-timeline">Agent Timeline (Beta)</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="ingestion" className="flex-1 overflow-auto p-6 space-y-6 m-0">
                        {/* Configuration Panel */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground font-bold">Configuration</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                    {/* Column 1: Pipelines */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Target Pipelines</label>
                                        <div className="border rounded-md h-40 overflow-y-auto p-2 bg-card">
                                            {pipelines.map(p => (
                                                <div key={p.id} className="flex items-center space-x-2 py-1">
                                                    <Checkbox
                                                        id={`p-${p.id}`}
                                                        checked={selectedPipelines.includes(String(p.id))}
                                                        onCheckedChange={(checked) => {
                                                            setSelectedPipelines(prev =>
                                                                checked
                                                                    ? [...prev, String(p.id)]
                                                                    : prev.filter(id => id !== String(p.id))
                                                            );
                                                        }}
                                                    />
                                                    <label htmlFor={`p-${p.id}`} className="text-sm cursor-pointer select-none">
                                                        {p.name}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {selectedPipelines.length} pipelines selected
                                        </div>
                                    </div>

                                    {/* Column 2: Baseline Window */}
                                    <div className="space-y-4">
                                        <label className="text-sm font-medium">Baseline Window</label>
                                        <div className="space-y-2">
                                            <div>
                                                <span className="text-xs text-muted-foreground">Start</span>
                                                <Input
                                                    type="datetime-local"
                                                    value={baselineStart}
                                                    onChange={(e) => setBaselineStart(e.target.value)}
                                                />
                                            </div>
                                            <div>
                                                <span className="text-xs text-muted-foreground">End</span>
                                                <Input
                                                    type="datetime-local"
                                                    value={baselineEnd}
                                                    onChange={(e) => setBaselineEnd(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Column 3: Comparison Window */}
                                    <div className="space-y-4">
                                        <label className="text-sm font-medium">Comparison Window</label>
                                        <div className="space-y-2">
                                            <div>
                                                <span className="text-xs text-muted-foreground">Start</span>
                                                <Input
                                                    type="datetime-local"
                                                    value={comparisonStart}
                                                    onChange={(e) => setComparisonStart(e.target.value)}
                                                />
                                            </div>
                                            <div>
                                                <span className="text-xs text-muted-foreground">End</span>
                                                <Input
                                                    type="datetime-local"
                                                    value={comparisonEnd}
                                                    onChange={(e) => setComparisonEnd(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Column 4: Action */}
                                    <div className="flex flex-col justify-end space-y-4">
                                        <div className="bg-muted p-3 rounded text-xs text-muted-foreground">
                                            <p>Ready to analyze?</p>
                                            <p className="mt-1">This will aggregate node creation events from all executions in the selected windows.</p>
                                        </div>
                                        <Button
                                            onClick={() => analysisMutation.mutate()}
                                            disabled={selectedPipelines.length === 0 || analysisMutation.isPending}
                                            className="w-full"
                                        >
                                            {analysisMutation.isPending ? (
                                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...</>
                                            ) : (
                                                "Run Comparison Analysis"
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Results Area */}
                        {analysisResult && (
                            <div className="space-y-6">
                                <div className="flex flex-row items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-primary/10 p-2 rounded-lg">
                                            <BarChart3 className="w-5 h-5 text-primary" />
                                        </div>
                                        <h2 className="text-lg font-bold tracking-tight">Ingestion Variance Analysis</h2>
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">GroupBy:</span>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="outline" className="w-[180px] justify-between glass-panel border-white/20 shadow-sm text-xs font-bold">
                                                        {groupingKeys.length > 0 ? `${groupingKeys.length} SELECTED` : "SELECT COLUMNS"}
                                                        <ChevronDown className="h-4 w-4 opacity-50" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent className="w-[200px] glass-panel border-white/20 shadow-2xl">
                                                    <DropdownMenuLabel className="text-[10px] font-black tracking-tighter uppercase opacity-50">Available Dimensions</DropdownMenuLabel>
                                                    <DropdownMenuSeparator />
                                                    {availableKeys.map((key) => (
                                                        <DropdownMenuCheckboxItem
                                                            key={key}
                                                            checked={groupingKeys.includes(key)}
                                                            className="text-xs font-medium"
                                                            onCheckedChange={(checked) => {
                                                                setGroupingKeys(prev => {
                                                                    if (checked) return [...prev, key];
                                                                    return prev.filter(k => k !== key);
                                                                });
                                                            }}
                                                        >
                                                            {key.toUpperCase()}
                                                        </DropdownMenuCheckboxItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                        <div className="relative w-64">
                                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder="Filter results..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="pl-10 glass-panel border-white/20 shadow-sm text-xs font-medium"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <AnimatePresence mode="popLayout">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
                                        {aggregatedData.length === 0 ? (
                                            <div className="col-span-full h-40 flex items-center justify-center glass-panel rounded-2xl border-dashed border-2">
                                                <p className="text-muted-foreground font-medium italic">No alignment found matching selected dimensions</p>
                                            </div>
                                        ) : (
                                            aggregatedData.map((row, idx) => {
                                                const maxCount = Math.max(row.baseCount, row.compCount);
                                                const basePercent = (row.baseCount / maxCount) * 100;
                                                const compPercent = (row.compCount / maxCount) * 100;

                                                return (
                                                    <motion.div
                                                        key={row.key}
                                                        layout
                                                        initial={{ opacity: 0, scale: 0.95 }}
                                                        animate={{ opacity: 1, scale: 1 }}
                                                        exit={{ opacity: 0, scale: 0.95 }}
                                                        transition={{ duration: 0.2, delay: idx * 0.02 }}
                                                        className="glass-card p-5 rounded-2xl flex flex-col group relative overflow-hidden"
                                                    >
                                                        {/* Background Glow based on change */}
                                                        {row.netChange > 0 && (
                                                            <div className="absolute -right-10 -top-10 w-24 h-24 bg-green-500/5 blur-3xl rounded-full" />
                                                        )}
                                                        {row.netChange < 0 && (
                                                            <div className="absolute -right-10 -top-10 w-24 h-24 bg-red-500/5 blur-3xl rounded-full" />
                                                        )}

                                                        <div className="flex justify-between items-start mb-6">
                                                            <div className="space-y-1">
                                                                {groupingKeys.map(key => (
                                                                    <div key={key} className="flex items-center gap-2">
                                                                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{key}:</span>
                                                                        <span className="text-sm font-bold text-foreground dark:text-white truncate max-w-[150px]">{row.groupData[key]}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <div className={cn(
                                                                "flex flex-col items-end px-3 py-1 rounded-lg border shadow-inner",
                                                                row.netChange > 0 ? "bg-green-500/10 border-green-500/20 text-green-600 neon-glow-green" : 
                                                                row.netChange < 0 ? "bg-red-500/10 border-red-500/20 text-red-500" : 
                                                                "bg-muted/10 border-slate-500/20 text-muted-foreground"
                                                            )}>
                                                                <span className="text-[9px] font-black uppercase tracking-tighter">Delta</span>
                                                                <span className="text-lg font-black leading-none tabular-nums">
                                                                    {row.netChange > 0 ? '+' : ''}{row.netChange}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="space-y-4 mt-auto">
                                                            {/* Baseline vs Comparison Visualizer */}
                                                            <div className="space-y-2">
                                                                <div className="flex justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                                                    <span>Baseline</span>
                                                                    <span className="text-foreground dark:text-foreground/70 tabular-nums">{row.baseCount}</span>
                                                                </div>
                                                                <div className="h-1.5 bg-muted dark:bg-muted rounded-full overflow-hidden">
                                                                    <motion.div 
                                                                        initial={{ width: 0 }}
                                                                        animate={{ width: `${basePercent}%` }}
                                                                        className="h-full bg-slate-400/50 rounded-full" 
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <div className="flex justify-between text-[10px] font-bold text-primary uppercase tracking-widest">
                                                                    <span>Comparison</span>
                                                                    <span className="text-foreground dark:text-foreground/70 tabular-nums font-black">{row.compCount}</span>
                                                                </div>
                                                                <div className="h-1.5 bg-muted dark:bg-muted rounded-full overflow-hidden shadow-inner">
                                                                    <motion.div 
                                                                        initial={{ width: 0 }}
                                                                        animate={{ width: `${compPercent}%` }}
                                                                        className={cn(
                                                                            "h-full rounded-full transition-all duration-1000",
                                                                            row.netChange > 0 ? "bg-green-500 neon-glow-green" : 
                                                                            row.netChange < 0 ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]" : 
                                                                            "bg-primary"
                                                                        )} 
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                );
                                            })
                                        )}
                                    </div>
                                </AnimatePresence>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="agent-timeline" className="flex-1 overflow-hidden p-6 m-0">
                        <AgentTraceTimeline />
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}

