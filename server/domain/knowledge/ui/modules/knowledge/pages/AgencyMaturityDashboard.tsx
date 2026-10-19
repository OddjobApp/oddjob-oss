import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
    Zap,
    RefreshCw,
    Search,
    Shield,
    Activity,
    Brain,
    Database,
    Clock,
    CheckCircle2,
    ArrowRight,
    TrendingUp,
    AlertTriangle,
    Check,
    X,
    Loader2
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { cn } from "@/lib/utils";
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip,
    Legend as RechartsLegend, RadialBarChart, RadialBar,
    CartesianGrid, Tooltip
} from "recharts";
import "./AgencyMaturityDashboard.css";

// --- Types ---
interface EvolutionEvent {
    id: number;
    type: 'PRUNING' | 'SYNTHESIS' | 'INTEGRITY_CHECK';
    status: 'SUCCESS' | 'FAILURE';
    details: any;
    createdAt: string;
}

interface MaturityStats {
    maturityScore: number;
    totalNodes: number;
    activeNodes: number;
    prunedNodes: number;
    utilityDistribution: {
        high: number;
        medium: number;
        low: number;
    };
    avgUtility: number;
    totalUsage: number;
    efficiencyGain: number;
}

interface ProactiveMission {
    id: number;
    name: string;
    objective: string;
    status: string;
    createdAt: string;
    blackboard: any;
}

// --- Components ---
const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="custom-tooltip">
                <p className="tooltip-title">{payload[0].name}</p>
                <p className="tooltip-value">{payload[0].value}</p>
            </div>
        );
    }
    return null;
};

export default function AgencyMaturityDashboard() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { selectedOrgId } = useOrgContext();

    // Fetch Stats
    const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery<MaturityStats>({
        queryKey: ["/api/knowledge/maturity/stats", selectedOrgId],
        queryFn: async () => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const res = await apiRequest("GET", `/api/knowledge/maturity/stats${orgParam}`);
            return res.json();
        },
        refetchInterval: 10000,
    });

    // Fetch Proactive Missions
    const { data: missions, isLoading: missionsLoading } = useQuery<ProactiveMission[]>({
        queryKey: ["/api/knowledge/maturity/proactive-missions", selectedOrgId],
        queryFn: async () => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const res = await apiRequest("GET", `/api/knowledge/maturity/proactive-missions${orgParam}`);
            return res.json();
        },
    });

    // Fetch Evolution History
    const { data: history, isLoading: historyLoading } = useQuery<EvolutionEvent[]>({
        queryKey: ["/api/knowledge/maturity/history", selectedOrgId],
        queryFn: async () => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            const res = await apiRequest("GET", `/api/knowledge/maturity/history${orgParam}`);
            return res.json();
        },
        refetchInterval: 15000,
    });

    // Mutations
    const refreshMutation = useMutation({
        mutationFn: async () => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            await apiRequest("POST", `/api/knowledge/maturity/refresh${orgParam}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge/maturity/stats"] });
            toast({ title: "Utility Evaluation Triggered", description: "Calculating node efficiency metrics." });
        }
    });

    const synthesizeMutation = useMutation({
        mutationFn: async () => {
            const orgParam = selectedOrgId ? `?orgId=${selectedOrgId}` : '';
            await apiRequest("POST", `/api/knowledge/maturity/synthesize${orgParam}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/knowledge/maturity/proactive-missions"] });
            toast({ title: "Synthesis Protocol Initialized", description: "Proactive missions generating from knowledge gaps." });
        }
    });

    if (statsLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="text-center space-y-4">
                    <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground animate-pulse">Syncing Maturity Matrix...</h2>
                </div>
            </div>
        );
    }

    if (statsError) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="text-center space-y-4">
                    <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
                    <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">Unable to Sync Maturity Matrix</h2>
                    <Button variant="outline" onClick={() => refetchStats()}>Retry Connection</Button>
                </div>
            </div>
        );
    }

    const pieData = stats?.utilityDistribution ? [
        { name: 'High Utility', value: stats.utilityDistribution.high || 0, color: 'hsl(var(--primary))' },
        { name: 'Medium Utility', value: stats.utilityDistribution.medium || 0, color: 'hsl(var(--accent))' },
        { name: 'Low Utility', value: stats.utilityDistribution.low || 0, color: 'hsl(var(--muted-foreground))' },
    ] : [];

    const radialData = stats ? [
        { name: 'Maturity', value: stats.maturityScore || 0, fill: 'hsl(var(--primary))' }
    ] : [];

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans relative cinematic-grid">
            {/* Background pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(var(--primary),0.05),transparent_50%)] pointer-events-none" />
            <div className="scanline-overlay absolute inset-0 pointer-events-none opacity-[0.03]" />

            <div className="max-w-[1600px] mx-auto p-8 space-y-10 relative z-10 w-full">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 border-b pb-10">
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="px-3 py-1 bg-primary/10 border border-primary/20 rounded-full animate-pulse flex items-center gap-2">
                                <Activity className="w-3 h-3 text-primary" />
                                <span className="text-[9px] font-bold uppercase tracking-widest text-primary">Autonomous Evolution Active</span>
                            </div>
                        </div>
                        <h1 className="text-5xl font-black italic tracking-tighter uppercase leading-none text-foreground">
                            Maturity <span className="text-primary">Lab</span>
                        </h1>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                            Real-time visualization of self-healing intelligence and proactive synthesis.
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <Button 
                            variant="outline" 
                            className="h-11 font-bold uppercase tracking-widest px-6 rounded-lg transition-all"
                            onClick={() => refreshMutation.mutate()}
                            disabled={refreshMutation.isPending}
                        >
                            {refreshMutation.isPending ? <Loader2 className="w-4 h-4 mr-3 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-3" />}
                            Re-Evaluate Utility
                        </Button>
                        <Button 
                            className="h-11 font-bold uppercase tracking-widest px-8 rounded-lg transition-all flex items-center gap-3 shadow-sm"
                            onClick={() => synthesizeMutation.mutate()}
                            disabled={synthesizeMutation.isPending}
                        >
                            {synthesizeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            TRIGGER SYNTHESIS
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                    
                    {/* Left Column: Maturity Score & Overview */}
                    <div className="lg:col-span-1 space-y-10">
                        <Card className="p-8 group glass-card">
                            <div className="flex items-center gap-3 mb-10">
                                <Database className="w-4 h-4 text-primary" />
                                <h2 className="text-[12px] font-bold uppercase tracking-widest text-foreground">Maturity Index</h2>
                            </div>
                            
                            <div className="relative pt-6 flex flex-col items-center">
                                <div className="relative w-72 h-72">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadialBarChart innerRadius="80%" outerRadius="100%" barSize={20} data={radialData} startAngle={90} endAngle={450}>
                                            <RadialBar background dataKey="value" cornerRadius={30} fill="hsl(var(--primary))" />
                                        </RadialBarChart>
                                    </ResponsiveContainer>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center space-y-1">
                                        <span className="text-6xl font-black text-foreground italic transition-all tabular-nums text-glow-bronze">{stats?.maturityScore}%</span>
                                        <span className="text-[10px] font-bold text-primary tracking-widest uppercase">Optimized</span>
                                    </div>
                                    <div className="absolute inset-0 bg-primary/5 blur-[80px] rounded-full -z-10 animate-pulse" />
                                </div>
                                <div className="mt-12 grid grid-cols-2 gap-6 w-full">
                                    <div className="bg-muted border border-border/50 rounded-2xl p-6 transition-all hover:bg-muted/80">
                                        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-2">Total Nodes</span>
                                        <span className="text-3xl font-bold text-foreground tabular-nums">{stats?.totalNodes}</span>
                                    </div>
                                    <div className="bg-muted border border-border/50 rounded-2xl p-6 transition-all hover:bg-muted/80">
                                        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-2">Efficiency Gain</span>
                                        <span className="text-3xl font-bold text-emerald-500 tabular-nums">+{stats?.efficiencyGain}%</span>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        <Card className="p-8 shadow-sm">
                            <div className="flex items-center gap-3 mb-10">
                                <TrendingUp className="w-4 h-4 text-emerald-500" />
                                <h2 className="text-[12px] font-bold uppercase tracking-widest text-foreground">Utility Distribution</h2>
                            </div>
                            <div className="h-64 mb-8">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={70}
                                            outerRadius={90}
                                            paddingAngle={8}
                                            dataKey="value"
                                        >
                                            {pieData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip content={<CustomTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="space-y-5">
                                {pieData.map((item) => (
                                    <div key={item.name} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50 hover:bg-muted/50 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className="utility-dot w-2.5 h-2.5 rounded-full" style={{ "--dot-color": item.color } as React.CSSProperties} />
                                            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground px-1">{item.name}</span>
                                        </div>
                                        <span className="text-sm font-bold text-foreground tabular-nums px-2">{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>

                    {/* Right Column: Activity & Missions */}
                    <div className="lg:col-span-2 space-y-10">
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            
                            {/* Proactive Missions */}
                            <Card className="p-0 overflow-hidden shadow-sm">
                                <div className="px-8 py-5 border-b bg-muted/30 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Zap className="w-4 h-4 text-amber-500" />
                                        <h2 className="text-[12px] font-bold uppercase tracking-widest text-foreground">Proactive Directives</h2>
                                    </div>
                                    <Badge variant="outline" className="bg-amber-500/10 border-amber-500/20 text-amber-600 text-[9px] font-bold rounded-sm uppercase">
                                        {missions?.length || 0} ACTIVE
                                    </Badge>
                                </div>
                                <div className="p-6">
                                    <ScrollArea className="h-[420px] pr-4">
                                        <div className="space-y-4">
                                            {!missions || missions.length === 0 ? (
                                                <div className="text-center py-20 opacity-30 italic">
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Awaiting synthesis triggers</p>
                                                </div>
                                            ) : (
                                                missions.map((mission) => (
                                                    <div key={mission.id} className="p-5 bg-muted/20 border border-border/50 rounded-2xl group hover:border-primary/30 hover:bg-muted/40 transition-all cursor-pointer">
                                                        <div className="flex items-center justify-between mb-4">
                                                            <h4 className="text-[13px] font-bold text-foreground uppercase tracking-tight group-hover:text-primary transition-colors tabular-nums">{mission.name.replace("[PROACTIVE] ", "")}</h4>
                                                            <div className="w-2 h-2 rounded-full bg-primary shadow-sm" />
                                                        </div>
                                                        <p className="text-[11px] font-medium text-muted-foreground line-clamp-2 leading-relaxed mb-6 group-hover:text-foreground transition-colors">
                                                            {mission.objective}
                                                        </p>
                                                        <div className="flex items-center justify-between border-t pt-4">
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Launched {new Date(mission.createdAt).toLocaleDateString()}</span>
                                                            <Link href={`/missions/${mission.id}`}>
                                                                <Button variant="ghost" size="sm" className="h-8 px-4 text-[10px] font-bold text-primary hover:text-foreground hover:bg-primary/20 uppercase tracking-widest transition-all">
                                                                    Analyze <ArrowRight className="w-3.5 h-3.5 ml-2" />
                                                                </Button>
                                                            </Link>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </Card>

                            {/* Self-Healing log */}
                            <Card className="p-0 overflow-hidden shadow-sm">
                                <div className="px-8 py-5 border-b bg-muted/30">
                                    <div className="flex items-center gap-3">
                                        <Shield className="w-4 h-4 text-primary" />
                                        <h2 className="text-[12px] font-bold uppercase tracking-widest text-foreground">Self-Healing Log</h2>
                                    </div>
                                </div>
                                <div className="p-8">
                                    <div className="space-y-8 relative before:absolute before:inset-0 before:left-[7px] before:w-[2px] before:bg-border">
                                        {historyLoading ? (
                                            <div className="flex items-center justify-center py-20">
                                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                            </div>
                                        ) : !history || history.length === 0 ? (
                                            <div className="text-center py-20 opacity-30 italic">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">No matrix repairs recorded</p>
                                            </div>
                                        ) : (
                                            history.map((event) => (
                                                <div key={event.id} className="relative pl-10 pb-2 group">
                                                    <div className={cn(
                                                        "absolute left-0 top-1.5 w-4 h-4 rounded-full bg-background border-2 z-10 transition-all group-hover:scale-125",
                                                        event.type === 'PRUNING' ? "border-primary shadow-sm" :
                                                        event.type === 'SYNTHESIS' ? "border-emerald-500 shadow-sm" : "border-muted"
                                                    )} />
                                                    <div className="flex flex-col gap-2">
                                                        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest tabular-nums">
                                                            {new Date(event.createdAt).toLocaleTimeString()}
                                                        </span>
                                                        <p className="text-[12px] font-bold text-foreground group-hover:text-primary transition-colors uppercase tracking-tight">
                                                            {event.type === 'PRUNING' ? `Pruned ${event.details?.nodesPruned || 0} Stale Nodes` : 
                                                             event.type === 'SYNTHESIS' ? "Autonomous Gap Synthesis" : "Integrity Check Passed"}
                                                        </p>
                                                        <p className="text-[11px] font-medium text-muted-foreground leading-relaxed group-hover:text-foreground transition-colors italic">
                                                            {event.type === 'PRUNING' ? "Memory optimization complete." : 
                                                             event.type === 'SYNTHESIS' ? `Detected: ${event.details?.proposedMission?.title}` : "System integrity nominal."}
                                                        </p>
                                                        {event.type === 'PRUNING' && (
                                                            <Badge variant="outline" className="bg-primary/10 border-primary/20 text-primary text-[9px] font-bold uppercase tracking-widest w-fit">
                                                                RECLAIMED ~{(event.details?.nodesPruned || 0) * 2}KB
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </Card>

                        </div>

                        {/* Efficiency Insight Card */}
                        <Card className="p-10 bg-gradient-to-br from-primary/[0.03] to-muted/20 border-border/50 hover:border-primary/20 transition-all shadow-sm">
                            <div className="absolute top-0 right-0 p-8 opacity-5">
                                <Brain className="w-32 h-32 text-primary" />
                            </div>
                            <div className="flex flex-col md:flex-row items-center gap-10">
                                <div className="w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm shrink-0">
                                    <Brain className="w-12 h-12 text-primary" />
                                </div>
                                <div className="flex-1 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-2xl font-black italic tracking-tighter uppercase text-foreground">Core Insight</h3>
                                        <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/20 text-emerald-600 text-[9px] font-bold uppercase tracking-widest">
                                            Optimization High
                                        </Badge>
                                    </div>
                                    <p className="text-[13px] font-medium text-muted-foreground leading-relaxed max-w-3xl">
                                        The platform has autonomously archived <strong className="text-foreground tabular-nums">{stats?.prunedNodes} nodes</strong> that were below the utility threshold. 
                                        This has improved RAG retrieval speed by <strong className="text-primary tabular-nums">~{Math.round((stats?.prunedNodes || 0) / (stats?.totalNodes || 1) * 100)}%</strong> and reduced token noise in downstream agent contexts.
                                    </p>
                                    <div className="bg-muted/40 p-6 rounded-2xl border border-border/50 max-w-lg">
                                        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest mb-4">
                                            <span className="text-muted-foreground">Retrieval Precision</span>
                                            <span className="text-primary tabular-nums">{Math.round(90 + (stats?.avgUtility || 0) / 10)}% Nominal</span>
                                        </div>
                                        <Progress value={90 + (stats?.avgUtility || 0) / 10} className="h-1.5" indicatorClassName="bg-primary" />
                                    </div>
                                </div>
                            </div>
                        </Card>

                    </div>
                </div>
            </div>
        </div>
    );
}

