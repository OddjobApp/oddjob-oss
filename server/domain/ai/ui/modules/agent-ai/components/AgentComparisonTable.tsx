import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DataTable, Column } from "@domain-ui/core/ui/components/ui/data-table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Download, TrendingUp, TrendingDown, Minus, Cpu, Brain, Layers, Activity } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface AgentMetrics {
    totalRuns: number;
    totalSteps: number;
    avgStepsPerRun: number;
    uniqueTools: number;
    totalMessages: number;
    thumbsUp: number;
    thumbsDown: number;
    successRate: string | number;
    avgRating: number;
}

interface AgentComparison {
    agentId: number;
    agentName: string;
    agentType: string;
    metrics: AgentMetrics;
}

interface AgentComparisonTableProps {
    agents: any[];
}

export function AgentComparisonTable({ agents }: AgentComparisonTableProps) {
    const [selectedAgents, setSelectedAgents] = useState<number[]>([]);

    const { data: comparisonData = [], isLoading } = useQuery<AgentComparison[]>({
        queryKey: ['/api/agent/analytics/compare', selectedAgents],
        queryFn: async () => {
            if (selectedAgents.length === 0) return [];
            const agentIds = selectedAgents.join(',');
            const res = await apiRequest('GET', `/api/agent/analytics/compare?agentIds=${agentIds}`);
            return res.json();
        },
        enabled: selectedAgents.length > 0
    });

    const handleAgentToggle = (agentId: number) => {
        setSelectedAgents(prev =>
            prev.includes(agentId)
                ? prev.filter(id => id !== agentId)
                : [...prev, agentId]
        );
    };

    const handleExport = () => {
        const csv = [
            ['Agent', 'Type', 'Total Runs', 'Avg Steps/Run', 'Unique Tools', 'Success Rate', 'Thumbs Up', 'Thumbs Down'].join(','),
            ...comparisonData.map(agent => [
                agent.agentName,
                agent.agentType,
                agent.metrics.totalRuns,
                agent.metrics.avgStepsPerRun,
                agent.metrics.uniqueTools,
                agent.metrics.successRate,
                agent.metrics.thumbsUp,
                agent.metrics.thumbsDown
            ].join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agent-comparison-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getRank = (value: number, allValues: number[], higherIsBetter = true) => {
        const sorted = [...allValues].sort((a, b) => higherIsBetter ? b - a : a - b);
        return sorted.indexOf(value) + 1;
    };

    const getTrendIcon = (rank: number, total: number) => {
        if (rank === 1) return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
        if (rank === total && total > 1) return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
        return <Minus className="h-3.5 w-3.5 text-foreground/10" />;
    };

    const columns: Column<AgentComparison>[] = [
        {
            key: 'agentName',
            header: 'Agent_Unit',
            cell: (row) => (
                <div className="flex items-center gap-4 py-2">
                    <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                        <Cpu className="w-4 h-4 text-primary" />
                    </div>
                    <div className="space-y-1">
                        <div className="text-[11px] font-black italic uppercase text-foreground tracking-tighter">{row.agentName}</div>
                        <div className="text-[8px] font-black uppercase text-foreground/20 tracking-widest">{row.agentType}</div>
                    </div>
                </div>
            )
        },
        {
            key: 'totalRuns',
            header: 'Aggregate_Ops',
            cell: (row) => {
                const allRuns = comparisonData.map(a => a.metrics.totalRuns);
                const rank = getRank(row.metrics.totalRuns, allRuns);
                return (
                    <div className="flex items-center gap-3 tabular-nums">
                        {getTrendIcon(rank, comparisonData.length)}
                        <span className="text-[11px] font-black italic text-foreground/60">{row.metrics.totalRuns.toLocaleString()}</span>
                    </div>
                );
            }
        },
        {
            key: 'avgStepsPerRun',
            header: 'Inference_Depth',
            cell: (row) => (
                <span className="text-[11px] font-black italic text-primary/60 tabular-nums">
                    {Number(row.metrics.avgStepsPerRun).toFixed(1)} <span className="text-[8px] uppercase tracking-widest text-foreground/10">Steps/Run</span>
                </span>
            )
        },
        {
            key: 'uniqueTools',
            header: 'Capability_Breadth',
            cell: (row) => {
                const allTools = comparisonData.map(a => a.metrics.uniqueTools);
                const rank = getRank(row.metrics.uniqueTools, allTools);
                return (
                    <div className="flex items-center gap-3 tabular-nums">
                        {getTrendIcon(rank, comparisonData.length)}
                        <span className="text-[11px] font-black italic text-foreground/60">{row.metrics.uniqueTools} <span className="text-[8px] uppercase tracking-widest text-foreground/10">Tools</span></span>
                    </div>
                );
            }
        },
        {
            key: 'successRate',
            header: 'Reliability_Score',
            cell: (row) => {
                const rate = typeof row.metrics.successRate === 'string'
                    ? row.metrics.successRate
                    : `${row.metrics.successRate}%`;

                if (rate === 'N/A') {
                    return <Badge className="bg-foreground/5 text-foreground/20 border-none text-[8px] font-black tracking-widest uppercase italic">N/A</Badge>;
                }

                const numRate = parseFloat(rate);
                const isHigh = numRate >= 80;
                const isLow = numRate < 60;

                return (
                    <Badge className={cn(
                        "text-[9px] font-black tracking-tighter uppercase italic border-none",
                        isHigh ? "bg-emerald-500/10 text-emerald-400" : isLow ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"
                    )}>
                        {rate}
                    </Badge>
                );
            }
        },
        {
            key: 'feedback',
            header: 'User_Sentiment',
            cell: (row) => (
                <div className="flex gap-2">
                    <div className="px-3 py-1 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-[9px] font-black text-emerald-500/60 flex items-center gap-2 italic">
                        <TrendingUp className="w-3 h-3" /> {row.metrics.thumbsUp}
                    </div>
                    <div className="px-3 py-1 rounded-lg bg-red-500/5 border border-red-500/10 text-[9px] font-black text-red-500/60 flex items-center gap-2 italic">
                        <TrendingDown className="w-3 h-3" /> {row.metrics.thumbsDown}
                    </div>
                </div>
            )
        }
    ];

    return (
        <div className="space-y-8">
            {/* Tactical Agent Selector */}
            <div className="flex items-center justify-between gap-6">
                <div className="flex-1">
                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic mb-4 ml-1">Operational Unit Select</div>
                    <div className="flex flex-wrap gap-3 p-4 rounded-3xl bg-foreground/[0.02] border border-foreground/5">
                        {agents.filter(a => a.type === 'ai_agent' || a.type === 'agent_ai').slice(0, 10).map(agent => (
                            <Button
                                key={agent.id}
                                variant="ghost"
                                size="sm"
                                onClick={() => handleAgentToggle(agent.id)}
                                className={cn(
                                    "h-10 px-6 rounded-xl text-[9px] font-black uppercase tracking-widest italic transition-all border",
                                    selectedAgents.includes(agent.id) 
                                        ? "bg-primary/20 text-primary border-primary/40 shadow-glow shadow-primary/10" 
                                        : "bg-foreground/5 text-foreground/40 border-transparent hover:bg-foreground/10"
                                )}
                            >
                                <Brain className={cn("w-3.5 h-3.5 mr-2", selectedAgents.includes(agent.id) ? "text-primary" : "text-foreground/20")} />
                                {agent.name}
                            </Button>
                        ))}
                    </div>
                </div>
                {comparisonData.length > 0 && (
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleExport}
                        className="h-10 px-8 rounded-xl border-foreground/10 bg-foreground/5 text-[9px] font-black uppercase tracking-widest italic hover:bg-foreground/10 transition-all mt-6"
                    >
                        <Download className="h-3.5 w-3.5 mr-2" />
                        MANIFEST EXP
                    </Button>
                )}
            </div>

            {/* Comparison Table HUD */}
            <div className="relative">
                {selectedAgents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-80 space-y-6 glass-panel-deep border-foreground/5 rounded-[3rem] border-2 border-dashed">
                        <div className="w-16 h-16 rounded-full bg-foreground/5 border border-foreground/10 flex items-center justify-center opacity-20">
                            <Layers className="w-8 h-8" />
                        </div>
                        <div className="text-center space-y-2">
                            <h3 className="text-sm font-black text-foreground/40 uppercase tracking-widest italic">Matrix Empty</h3>
                            <p className="text-[10px] font-black text-foreground/10 uppercase tracking-[0.3em] italic leading-relaxed max-w-xs mx-auto">
                                SELECT MULTIPLE OPERATIONAL NODES ABOVE TO INITIALIZE PERFORMANCE BENCHMARKING
                            </p>
                        </div>
                    </div>
                ) : isLoading ? (
                    <div className="flex flex-col items-center justify-center h-80 space-y-4">
                        <div className="relative">
                            <div className="w-12 h-12 border-2 border-primary/20 rounded-full animate-ping" />
                            <div className="absolute inset-0 w-12 h-12 border-2 border-t-primary border-transparent rounded-full animate-spin" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary/60 italic animate-pulse">Scanning Neural Matrix...</span>
                    </div>
                ) : (
                    <div className="glass-panel-deep border-foreground/5 rounded-3xl overflow-hidden">
                        <DataTable
                            data={comparisonData}
                            columns={columns}
                        />
                    </div>
                )}
            </div>

            {/* Aggregate HUD HUD */}
            <AnimatePresence>
                {comparisonData.length > 1 && (
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-10 border-t border-foreground/5"
                    >
                        {[
                            { label: "Fleet_Total_Ops", value: comparisonData.reduce((sum, a) => sum + a.metrics.totalRuns, 0).toLocaleString(), icon: Activity },
                            { 
                                label: "Avg_Fleet_Success", 
                                value: `${(comparisonData.reduce((sum, a) => {
                                    const rate = typeof a.metrics.successRate === 'string'
                                        ? parseFloat(a.metrics.successRate) || 0
                                        : a.metrics.successRate;
                                    return sum + rate;
                                }, 0) / comparisonData.length).toFixed(1)}%`,
                                icon: TrendingUp
                            },
                            { 
                                label: "Consolidated_Feedback", 
                                value: comparisonData.reduce((sum, a) => sum + a.metrics.thumbsUp + a.metrics.thumbsDown, 0).toString(),
                                icon: Brain
                            },
                            { 
                                label: "Peak_Capability", 
                                value: `${Math.max(...comparisonData.map(a => a.metrics.uniqueTools))} Tools`,
                                icon: Layers
                            }
                        ].map((stat, i) => (
                            <div key={i} className="space-y-2 p-6 rounded-3xl bg-foreground/[0.01] border border-foreground/5">
                                <div className="flex items-center gap-3 text-[9px] font-black text-foreground/20 uppercase tracking-widest italic">
                                    <stat.icon className="w-3 h-3" />
                                    {stat.label}
                                </div>
                                <div className="text-2xl font-black italic tracking-tighter text-foreground">{stat.value}</div>
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
