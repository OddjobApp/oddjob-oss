
import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import "../styles/cycles.css";
import {
    Card, CardContent, CardDescription, CardHeader, CardTitle
} from "@/components/ui/card";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
    Workflow, Target, DollarSign, Activity,
    Plus, ChevronRight, Zap, RefreshCcw,
    Pause, Play, ShieldCheck, Trash2, Loader2,
    Database, Key, Link as LinkIcon, FileText, Hash,
    ArrowRight, Search, SortAsc, CheckSquare
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useCycleEvents } from "../hooks/use-cycle-events";
import { CycleGanttChart } from "../components/CycleGanttChart";
import { HypothesisExplorer } from "../components/HypothesisExplorer";
import { motion, AnimatePresence } from "framer-motion";
import { SettingsPanel } from "../components/SettingsPanel";
import { normalizeCycleInputRequirements } from "@shared/cycle-inputs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Blueprint { name: string; objective: string; }

interface SimulationResult {
    missionCount: number;
    totalEstimatedCost: number;
    totalEstimatedTokens: number;
    recommendedPriority: number;
    stratagem: string;
}

const STATUS_FILTERS = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "pending_approval", label: "Gated" },
    { value: "paused", label: "Paused" },
    { value: "closed", label: "Closed" },
] as const;

const VIEW_MODES = [
    { value: "grid", label: "Grid" },
    { value: "gantt", label: "Gantt" },
    { value: "prediction", label: "Prediction" },
    { value: "settings", label: "Settings" },
] as const;

function formatCurrency(value: number) {
    return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function getCycleBlueprintCount(cycle: any) {
    return (cycle.metadata?.forecast?.missionCount ?? cycle.metadata?.blueprints?.length ?? 0) as number;
}

function getCycleAlignment(cycle: any) {
    return cycle.outcomeMetrics?.alignmentScore ?? 100;
}

function getCycleStatusMeta(cycle: any) {
    switch (cycle.status) {
        case "active":
            return {
                label: "Active",
                icon: Activity,
                badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/30",
                dot: "bg-blue-400 shadow-[0_0_16px_rgba(96,165,250,0.55)]",
                card: "border-blue-400/25 bg-blue-500/[0.07]",
            };
        case "pending_approval":
            return {
                label: "Gate Review",
                icon: ShieldCheck,
                badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30",
                dot: "bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.45)]",
                card: "border-amber-400/25 bg-amber-500/[0.07]",
            };
        case "paused":
            return {
                label: "Paused",
                icon: Pause,
                badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-400/30",
                dot: "bg-violet-300 shadow-[0_0_16px_rgba(196,181,253,0.45)]",
                card: "border-violet-400/20 bg-violet-500/[0.05]",
            };
        case "closed":
            return {
                label: "Closed",
                icon: Target,
                badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30",
                dot: "bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.45)]",
                card: "border-emerald-400/20 bg-emerald-500/[0.05]",
            };
        default:
            return {
                label: String(cycle.status || "Draft").replace("_", " "),
                icon: Workflow,
                badge: "bg-muted/15 text-foreground border-border/20",
                dot: "bg-muted",
                card: "border-foreground/10 bg-foreground/[0.04]",
            };
    }
}

function getCycleUrgency(cycle: any) {
    switch (cycle.status) {
        case "pending_approval":
            return 0;
        case "active":
            return 1;
        case "paused":
            return 2;
        case "closed":
            return 4;
        default:
            return 3;
    }
}

// ─── Launch Dialog ────────────────────────────────────────────────────────────



// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function CyclesDashboard() {
    const { toast } = useToast();

    const [page, setPage] = useState(0);
    const [selectedCycle, setSelectedCycle] = useState<any | null>(null);
    const [resourceAnswers, setResourceAnswers] = useState<Record<string, Record<string, any>>>({});
    const [configuring, setConfiguring] = useState(false);
    const [showLaunchForm, setShowLaunchForm] = useState(false);
    
    // Core Edit State
    const [editName, setEditName] = useState("");
    const [editObjective, setEditObjective] = useState("");
    const [editPriority, setEditPriority] = useState("5");
    const [editBudget, setEditBudget] = useState("100");

    const [viewMode, setViewMode] = useState<'grid' | 'gantt' | 'prediction' | 'settings'>('grid');
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [sortBy, setSortBy] = useState<'urgency' | 'created' | 'priority' | 'spend'>('urgency');
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const PAGE_SIZE = 20;
    useCycleEvents(); // Real-time invalidation via SSE — no more polling lag

    const urlOrgId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get("orgId") : null;

    const { data: cycleData, isLoading, error } = useQuery<{ cycles: any[]; total: number; limit: number; offset: number }>({
        queryKey: ["/api/cycles", page, urlOrgId],
        queryFn: async () => {
            const orgParam = urlOrgId ? `&orgId=${urlOrgId}` : "";
            const res = await apiRequest("GET", `/api/cycles?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${orgParam}`);
            return res.json();
        },
    });
    const cycles = cycleData?.cycles;
    const totalPages = cycleData ? Math.ceil(cycleData.total / PAGE_SIZE) : 0;

    const launchMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest("POST", "/api/cycles/launch", data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            setShowLaunchForm(false);
            toast({ title: "Cycle Staged", description: "Program orchestration has commenced." });
        },
        onError: (err: any) => {
            toast({ title: "Launch failed", description: err.message, variant: "destructive" });
        },
    });

    const approveCycleMutation = useMutation({
        mutationFn: async (cycleId: number) => {
            const res = await apiRequest("POST", `/api/cycles/${cycleId}/approve`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            toast({ title: "Cycle Approved", description: "The autonomous program has been released." });
        },
    });

    const deleteCycleMutation = useMutation({
        mutationFn: async (cycleId: number) => {
            const res = await apiRequest("DELETE", `/api/cycles/${cycleId}`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            toast({ title: "Cycle Deleted", description: "The strategic blueprint has been purged." });
        },
        onError: (err: any) => {
            toast({ title: "Deletion Failed", description: err.message, variant: "destructive" });
        }
    });

    const togglePauseMutation = useMutation({
        mutationFn: async ({ cycleId, action }: { cycleId: number; action: 'pause' | 'resume' }) => {
            const res = await apiRequest("POST", `/api/cycles/${cycleId}/${action}`);
            return res.json();
        },
        onSuccess: (_, { action }) => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            toast({
                title: action === 'pause' ? "Cycle Paused" : "Cycle Resumed",
                description: `Autonomous triggers have been ${action === 'pause' ? 'halted' : 'reactivated'}.`,
            });
        },
        onError: (err: any) => {
            toast({
                title: "Action Failed",
                description: err.message || "Could not update cycle status.",
                variant: "destructive"
            });
        }
    });

    const triggerCycleMutation = useMutation({
        mutationFn: async (cycleId: number) => {
            const res = await apiRequest("POST", `/api/cycles/${cycleId}/trigger`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            toast({
                title: "Cycle Triggered",
                description: "Manual run has been initiated successfully.",
            });
        },
        onError: (err: any) => {
            toast({
                title: "Trigger Failed",
                description: err.message || "Could not trigger cycle.",
                variant: "destructive"
            });
        }
    });

    const updateCycleMutation = useMutation({
        mutationFn: async ({ cycleId, data }: { cycleId: number; data: any }) => {
            const res = await apiRequest("PATCH", `/api/cycles/${cycleId}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            setConfiguring(false);
            setSelectedCycle(null);
            toast({ title: "Configuration Updated", description: "The cycle strategy has been refined." });
        },
    });

    const bulkApproveMutation = useMutation({
        mutationFn: async (ids: number[]) => {
            await Promise.all(ids.map(id => apiRequest("POST", `/api/cycles/${id}/approve`)));
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            setSelectedIds(new Set());
            toast({ title: "Cycles Approved", description: `${selectedIds.size} cycles released.` });
        },
    });

    const bulkDeleteMutation = useMutation({
        mutationFn: async (ids: number[]) => {
            await Promise.all(ids.map(id => apiRequest("DELETE", `/api/cycles/${id}`)));
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            setSelectedIds(new Set());
            toast({ title: "Cycles Deleted" });
        },
    });

    const toggleSelect = (id: number) => setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const handleOpenConfigure = (cycle: any) => {
        setSelectedCycle(cycle);
        setResourceAnswers(cycle.metadata?.resource_answers || {});
        setEditName(cycle.name);
        setEditObjective(cycle.objective);
        setEditPriority(String(cycle.priority || 5));
        setEditBudget(cycle.budgetLimitUsd || "100");
        setConfiguring(true);
    };

    const handleSaveConfig = () => {
        if (!selectedCycle) return;
        updateCycleMutation.mutate({
            cycleId: selectedCycle.id,
            data: {
                name: editName,
                objective: editObjective,
                priority: parseInt(editPriority),
                budgetLimitUsd: editBudget,
                metadata: {
                    ...selectedCycle.metadata,
                    resource_answers: resourceAnswers
                }
            }
        });
    };

    if (error) {
        return (
            <div className="p-6 flex flex-col items-center justify-center min-h-[400px] text-center gap-4">
                <Activity className="w-12 h-12 text-destructive opacity-50" />
                <p className="text-muted-foreground">Failed to load cycles: {(error as Error).message}</p>
                <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/cycles"] })}>
                    <RefreshCcw className="w-4 h-4 mr-2" /> Retry
                </Button>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
                </div>
                <Skeleton className="h-[400px] w-full rounded-3xl" />
            </div>
        );
    }

    const activeCycles = cycles?.filter(c => c.status === 'active') || [];
    const pendingCycles = cycles?.filter(c => c.status === 'pending_approval') || [];
    const pausedCycles = cycles?.filter(c => c.status === 'paused') || [];
    const getSpend = (c: any) => parseFloat((c.outcomeMetrics as any)?.totalSpend ?? c.currentSpend ?? 0) || 0;
    const totalSpend = cycles?.reduce((acc, c) => acc + getSpend(c), 0) || 0;
    const averageAlignment = activeCycles.length > 0
        ? Math.round(activeCycles.reduce((acc, c) => acc + getCycleAlignment(c), 0) / activeCycles.length)
        : null;

    const displayCycles = (cycles ?? [])
        .filter(c => {
            if (statusFilter !== "all" && c.status !== statusFilter) return false;
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return c.name?.toLowerCase().includes(q) || c.objective?.toLowerCase().includes(q);
        })
        .sort((a, b) => {
            if (sortBy === 'urgency') {
                const urgencyDelta = getCycleUrgency(a) - getCycleUrgency(b);
                if (urgencyDelta !== 0) return urgencyDelta;
                return (b.priority ?? 5) - (a.priority ?? 5);
            }
            if (sortBy === 'priority') return (b.priority ?? 5) - (a.priority ?? 5);
            if (sortBy === 'spend') return getSpend(b) - getSpend(a);
            return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
        });

    const summaryCards = [
        {
            label: "Active cycles",
            value: String(activeCycles.length),
            helper: `${cycles?.length || 0} total programs tracked`,
            icon: Workflow,
            tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        },
        {
            label: "Governance gates",
            value: String(pendingCycles.length),
            helper: "awaiting HIL clearance",
            icon: ShieldCheck,
            tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        },
        {
            label: "Aggregate spend",
            value: formatCurrency(totalSpend),
            helper: "across current cycle portfolio",
            icon: DollarSign,
            tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        },
        {
            label: "Strategic alignment",
            value: averageAlignment === null ? "N/A" : `${averageAlignment}%`,
            helper: pausedCycles.length > 0 ? `${pausedCycles.length} paused cycles` : "active objective signal",
            icon: Activity,
            tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
        },
    ];

    const cycleLanes = [
        {
            label: "In Flight",
            accent: "blue",
            cycles: displayCycles.filter(cycle => cycle.status === "active"),
        },
        {
            label: "Gate Review",
            accent: "amber",
            cycles: displayCycles.filter(cycle => cycle.status === "pending_approval"),
        },
        {
            label: "Watchlist",
            accent: "violet",
            cycles: displayCycles.filter(cycle => cycle.status !== "active" && cycle.status !== "pending_approval"),
        },
    ];

    return (
        <div className="relative min-h-screen overflow-hidden bg-background px-4 pb-20 pt-4 text-foreground md:px-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/15 via-cyan-500/5 to-transparent" />

            <div className="relative z-10 mx-auto flex w-full max-w-[2000px] flex-col gap-5 animate-in fade-in duration-700">


            <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_16px_rgba(var(--primary),0.65)]" />
                        <span className="text-[10px] font-black uppercase text-primary">Domain Cycle Command</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                            Domain Cycles
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm font-medium text-muted-foreground">
                            Portfolio command for recurring domain programs, governance gates, spend controls, strategic drift, and mission-producing cycles.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-1 rounded-2xl border border-foreground/10 bg-foreground/[0.03] p-1">
                        {VIEW_MODES.map(mode => (
                            <Button
                                key={mode.value}
                                variant="ghost"
                                size="sm"
                                className={`h-9 rounded-xl px-4 text-[10px] font-black uppercase transition-all ${
                                    viewMode === mode.value
                                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                                        : "text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                                }`}
                                onClick={() => setViewMode(mode.value as typeof viewMode)}
                            >
                                {mode.label}
                            </Button>
                        ))}
                    </div>
                    <Button
                        onClick={() => window.location.href = "/operations/cycles/new"}
                        className="h-11 rounded-xl bg-primary px-6 text-[10px] font-black uppercase text-primary-foreground shadow-lg shadow-primary/10 hover:bg-primary/90"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        New Cycle
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summaryCards.map(card => (
                    <div key={card.label} className="rounded-2xl border border-foreground/10 bg-foreground/[0.04] p-4 backdrop-blur-xl">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-black uppercase text-muted-foreground">{card.label}</p>
                                <p className="mt-2 text-2xl font-black text-foreground">{card.value}</p>
                            </div>
                            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${card.tone}`}>
                                <card.icon className="h-5 w-5" />
                            </div>
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground">{card.helper}</p>
                    </div>
                ))}
            </div>

            {/* Filter & Sort Bar */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search cycles…"
                        className="pl-9 h-9 bg-foreground/5 border-foreground/10 rounded-full text-sm"
                    />
                </div>

                {/* Status chips */}
                <div className="flex gap-1.5 flex-wrap">
                    {[
                        { value: "all", label: "All" },
                        { value: "active", label: "Active" },
                        { value: "pending_approval", label: "Pending" },
                        { value: "paused", label: "Paused" },
                        { value: "closed", label: "Closed" },
                    ].map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => setStatusFilter(value)}
                            className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                                statusFilter === value
                                    ? "bg-primary text-foreground shadow-sm shadow-primary/30"
                                    : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-foreground/10"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Sort */}
                <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                    <SelectTrigger className="h-9 w-36 bg-foreground/5 border-foreground/10 rounded-full text-xs">
                        <SortAsc className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="urgency">Urgency</SelectItem>
                        <SelectItem value="created">Latest</SelectItem>
                        <SelectItem value="priority">Priority</SelectItem>
                        <SelectItem value="spend">Spend</SelectItem>
                    </SelectContent>
                </Select>

                <span className="text-xs text-muted-foreground ml-auto">{displayCycles.length} cycles</span>
            </div>

            {/* Bulk Action Bar */}
            {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-primary/10 border border-primary/20">
                    <CheckSquare className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold text-primary">{selectedIds.size} selected</span>
                    <div className="flex gap-2 ml-auto">
                        <Button size="sm" variant="outline"
                            className="rounded-full border-primary/30 text-primary hover:bg-primary/10 text-xs"
                            onClick={() => bulkApproveMutation.mutate([...selectedIds])}
                            disabled={bulkApproveMutation.isPending}>
                            <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Approve All
                        </Button>
                        <Button size="sm" variant="outline"
                            className="rounded-full border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
                            onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
                            disabled={bulkDeleteMutation.isPending}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete All
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-full text-xs"
                            onClick={() => setSelectedIds(new Set())}>
                            Clear
                        </Button>
                    </div>
                </div>
            )}

            {/* Cycle Grid / Gantt */}
            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <AnimatePresence>
                        {displayCycles.map((cycle, idx) => {
                            const forecast: SimulationResult | undefined = cycle.metadata?.forecast;
                            const missionCount = forecast?.missionCount ?? (cycle.metadata?.blueprints as any[])?.length ?? null;
                            const isSelected = selectedIds.has(cycle.id);
                            const alignmentScore = cycle.outcomeMetrics?.alignmentScore ?? 100;

                            return (
                                <motion.div
                                    key={cycle.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4, delay: idx * 0.05 }}
                                >
                                    <Card
                                        className={`relative overflow-hidden border-foreground/5 bg-background/20 backdrop-blur-2xl transition-all group
                                            ${cycle.status === 'paused' ? 'opacity-70 grayscale-[0.5]' : 'hover:border-primary/30 hover:bg-background/40'}
                                            ${cycle.status === 'pending_approval' ? 'border-primary/40 ring-1 ring-primary/10 shadow-2xl shadow-primary/5' : ''}
                                            ${isSelected ? 'ring-2 ring-primary/50 border-primary/40' : ''}`}
                                    >
                                        {/* Sentinel Alignment Badge */}
                                        <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-primary/50 via-primary/20 to-transparent opacity-50" />
                                        
                                        {/* Select checkbox */}
                                        <div
                                            className="absolute top-3 left-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={e => { e.stopPropagation(); toggleSelect(cycle.id); }}
                                        >
                                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                                                isSelected ? "bg-primary border-primary" : "border-foreground/30 hover:border-primary/60 bg-background/40"
                                            }`}>
                                                {isSelected && <span className="text-foreground text-[10px] font-bold">✓</span>}
                                            </div>
                                        </div>
                                        <div className="absolute top-0 right-0 p-4 flex items-center gap-3">
                                            {cycle.status === 'active' && (
                                                <div className="flex flex-col items-end">
                                                    <p className="text-[8px] font-black uppercase text-primary tracking-widest">Alignment</p>
                                                    <p className="text-xs font-black text-foreground">{alignmentScore}%</p>
                                                </div>
                                            )}
                                            <Badge className={
                                                cycle.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                                cycle.status === 'pending_approval' ? 'bg-primary/10 text-primary border-primary/20 animate-pulse' :
                                                cycle.status === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                                'bg-muted text-muted-foreground'
                                            }>
                                                {cycle.status.replace('_', ' ').toUpperCase()}
                                            </Badge>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-red-500/10 hover:text-red-500 transition-colors" onClick={() => deleteCycleMutation.mutate(cycle.id)}>
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>

                                        <CardHeader className="p-8 pb-4">
                                            <div className="space-y-2">
                                                <CardTitle className="flex items-center gap-3 group-hover:text-primary transition-colors cursor-pointer text-xl font-black min-w-0 pr-44">
                                                    <Link href={`/operations/cycles/${cycle.id}`} className="min-w-0">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <span className="text-2xl drop-shadow-lg shrink-0">{cycle.icon || "🌀"}</span>
                                                            <span className="truncate">{cycle.name}</span>
                                                        </div>
                                                    </Link>
                                                </CardTitle>
                                                <CardDescription className="line-clamp-2 text-sm leading-relaxed min-h-[3rem] text-muted-foreground/80">
                                                    {cycle.objective}
                                                </CardDescription>
                                            </div>
                                        </CardHeader>

                                        <CardContent className="p-8 pt-0 space-y-8">
                                            {/* Stats Row */}
                                            <div className="grid grid-cols-3 gap-8 py-6 border-y border-foreground/5 bg-foreground/[0.02] rounded-2xl px-6">
                                                <div className="space-y-1">
                                                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-black">Missions</p>
                                                    <p className="text-xl font-black">{missionCount ?? '?'}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-black">Priority</p>
                                                    <p className="text-xl font-black text-primary">{cycle.priority}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-black">Fiscal Cap</p>
                                                    <p className="text-xl font-black text-emerald-400">${cycle.budgetLimitUsd}</p>
                                                </div>
                                            </div>

                                            {/* Footer Actions */}
                                            <div className="flex items-center justify-between pt-2">
                                                <div className="flex gap-2">
                                                    {cycle.status === 'pending_approval' ? (
                                                        <>
                                                            <Button 
                                                                size="sm" 
                                                                className="bg-primary hover:bg-primary/90 rounded-full px-6 h-9 font-bold text-xs shadow-lg shadow-primary/20"
                                                                onClick={() => approveCycleMutation.mutate(cycle.id)}
                                                            >
                                                                <ShieldCheck className="w-4 h-4 mr-2" /> Approve & Launch
                                                            </Button>
                                                            <Button variant="ghost" size="sm" className="h-9 rounded-full px-4 text-xs font-bold bg-foreground/5 hover:bg-foreground/10" onClick={() => handleOpenConfigure(cycle)}>
                                                                <Zap className="w-4 h-4 mr-2" /> Configure
                                                            </Button>
                                                        </>
                                                    ) : cycle.status === 'active' ? (
                                                        <>
                                                            <Button 
                                                                size="sm" variant="outline" 
                                                                className="rounded-full px-6 h-9 font-bold text-xs border-amber-500/20 text-amber-500 hover:bg-amber-500/10"
                                                                onClick={() => togglePauseMutation.mutate({ cycleId: cycle.id, action: 'pause' })}
                                                                disabled={togglePauseMutation.isPending && togglePauseMutation.variables?.cycleId === cycle.id}
                                                            >
                                                                {togglePauseMutation.isPending && togglePauseMutation.variables?.cycleId === cycle.id && togglePauseMutation.variables?.action === 'pause' ? (
                                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                                ) : (
                                                                    <Pause className="w-4 h-4 mr-2" />
                                                                )}
                                                                Pause Program
                                                            </Button>
                                                            <Button 
                                                                size="sm" 
                                                                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-6 h-9 font-bold text-xs shadow-lg shadow-primary/20"
                                                                onClick={() => triggerCycleMutation.mutate(cycle.id)}
                                                                disabled={triggerCycleMutation.isPending}
                                                            >
                                                                {triggerCycleMutation.isPending && triggerCycleMutation.variables === cycle.id ? (
                                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                                ) : (
                                                                    <Play className="w-4 h-4 mr-2 fill-current" />
                                                                )}
                                                                Trigger Run
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <Button 
                                                            size="sm" variant="outline" 
                                                            className="rounded-full px-6 h-9 font-bold text-xs border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/10"
                                                            onClick={() => togglePauseMutation.mutate({ cycleId: cycle.id, action: 'resume' })}
                                                            disabled={togglePauseMutation.isPending && togglePauseMutation.variables?.cycleId === cycle.id}
                                                        >
                                                            {togglePauseMutation.isPending && togglePauseMutation.variables?.cycleId === cycle.id && togglePauseMutation.variables?.action === 'resume' ? (
                                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                            ) : (
                                                                <Play className="w-4 h-4 mr-2" />
                                                            )}
                                                            Resume Program
                                                        </Button>
                                                    )}
                                                </div>
                                                <Button
                                                    variant="ghost" size="sm"
                                                    className="hover:bg-primary/10 hover:text-primary rounded-full px-4 h-9 text-xs font-bold transition-all"
                                                    onClick={() => window.location.href = `/operations/cycles/${cycle.id}`}
                                                >
                                                    {cycle.status === 'pending_approval' ? 'Review Blueprints' : 'View Intelligence'}
                                                    <ChevronRight className="w-4 h-4 ml-2" />
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>

                    {displayCycles.length === 0 && (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-foreground/5 rounded-3xl opacity-50">
                            <Workflow className="w-12 h-12 mb-4 text-muted-foreground" />
                            <h3 className="text-lg font-bold">{searchQuery || statusFilter !== "all" ? "No Matching Cycles" : "No Cycles Configured"}</h3>
                            <p className="text-sm text-muted-foreground">{searchQuery || statusFilter !== "all" ? "Try adjusting your search or filter." : "Stage a new program to begin autonomous operations."}</p>
                        </div>
                    )}
                </div>
            ) : viewMode === 'gantt' ? (
                <div className="space-y-8">
                    {displayCycles.map((cycle) => (
                        <div key={cycle.id} className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span>{cycle.icon ?? "🌀"}</span>
                                    <h3 className="text-base font-bold">{cycle.name}</h3>
                                    <Badge variant="outline" className="text-[9px] uppercase">{cycle.status}</Badge>
                                    {(cycle.metadata?.blueprints?.length ?? 0) > 0 && (
                                        <span className="text-[9px] text-muted-foreground">
                                            {cycle.metadata!.blueprints!.length} phase{cycle.metadata!.blueprints!.length !== 1 ? "s" : ""}
                                            {cycle.metadata!.blueprints!.some((b: any) => b.estimatedDays)
                                                ? ` · ${cycle.metadata!.blueprints!.reduce((s: number, b: any) => s + (b.estimatedDays ?? 0), 0)}d est.`
                                                : " · no durations set"}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    {cycle.status === 'active' ? (
                                        <>
                                            <Button 
                                                size="sm" variant="ghost" 
                                                className="h-7 px-3 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/20"
                                                onClick={() => togglePauseMutation.mutate({ cycleId: cycle.id, action: 'pause' })}
                                                disabled={togglePauseMutation.isPending && togglePauseMutation.variables?.cycleId === cycle.id}
                                            >
                                                {togglePauseMutation.isPending && togglePauseMutation.variables?.cycleId === cycle.id && togglePauseMutation.variables?.action === 'pause' ? (
                                                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                                ) : (
                                                    <Pause className="w-3 h-3 mr-1.5" />
                                                )}
                                                Pause
                                            </Button>
                                            <Button 
                                                size="sm" variant="ghost" 
                                                className="h-7 px-3 rounded-full text-[10px] font-black uppercase tracking-widest bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
                                                onClick={() => triggerCycleMutation.mutate(cycle.id)}
                                                disabled={triggerCycleMutation.isPending}
                                            >
                                                {triggerCycleMutation.isPending && triggerCycleMutation.variables === cycle.id ? (
                                                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                                ) : (
                                                    <Play className="w-3 h-3 mr-1.5 fill-current" />
                                                )}
                                                Trigger Run
                                            </Button>
                                        </>
                                    ) : (
                                        <Button 
                                            size="sm" variant="ghost" 
                                            className="h-7 px-3 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border border-emerald-500/20"
                                            onClick={() => togglePauseMutation.mutate({ cycleId: cycle.id, action: 'resume' })}
                                            disabled={togglePauseMutation.isPending && togglePauseMutation.variables?.cycleId === cycle.id}
                                        >
                                            {togglePauseMutation.isPending && togglePauseMutation.variables?.cycleId === cycle.id && togglePauseMutation.variables?.action === 'resume' ? (
                                                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                            ) : (
                                                <Play className="w-3 h-3 mr-1.5" />
                                            )}
                                            Resume
                                        </Button>
                                    )}
                                    <Button variant="ghost" size="sm" className="h-7 rounded-full text-xs hover:bg-foreground/5"
                                        onClick={() => window.location.href = `/operations/cycles/${cycle.id}`}>
                                        Open <ChevronRight className="w-3 h-3 ml-1" />
                                    </Button>
                                </div>
                            </div>

                            {(cycle.metadata?.blueprints?.length ?? 0) > 0 ? (
                                <div className="space-y-4">
                                    <CycleGanttChart
                                        blueprints={cycle.metadata!.blueprints!}
                                        startDate={cycle.startDate ? new Date(cycle.startDate) : undefined}
                                        timeUnit={(cycle.metadata as any)?.timeUnit}
                                        excludeWeekends={(cycle.metadata as any)?.excludeWeekends || (cycle.metadata as any)?.exclude_weekends}
                                        mini
                                    />
                                    
                                    {/* Cycle Info Below Gantt */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-2 pt-2 border-t border-foreground/5">
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Objective</p>
                                            <p className="text-[11px] font-medium line-clamp-1 text-foreground">{cycle.objective}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Alignment</p>
                                            <div className="flex items-center gap-2">
                                                <div className="h-1 w-16 bg-foreground/5 rounded-full overflow-hidden">
                                                    <style>{`
                                                        .progress-width-${cycle.id} { width: ${cycle.outcomeMetrics?.alignmentScore ?? 100}%; }
                                                    `}</style>
                                                    <div className={`bg-primary h-full progress-width-${cycle.id}`} />
                                                </div>
                                                <span className="text-[10px] font-bold text-foreground">{cycle.outcomeMetrics?.alignmentScore ?? 100}%</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Spend</p>
                                            <p className="text-[11px] font-bold text-emerald-400">
                                                ${parseFloat(String(cycle.outcomeMetrics?.totalSpend ?? 0)).toFixed(2)} 
                                                <span className="text-muted-foreground/50 text-[9px] ml-1">/ ${cycle.budgetLimitUsd}</span>
                                            </p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Strategic Pulse</p>
                                            <p className="text-[11px] font-bold flex items-center gap-1.5 text-foreground uppercase tracking-tight">
                                                <span className={`w-1.5 h-1.5 rounded-full ${cycle.status === 'active' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : cycle.status === 'paused' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-muted'}`} />
                                                {cycle.status}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-16 rounded-xl border border-dashed border-foreground/10 flex items-center justify-center text-xs text-muted-foreground/40 italic">
                                    No blueprints — open cycle to configure
                                </div>
                            )}
                        </div>
                    ))}

                    {displayCycles.length === 0 && (
                        <div className="py-20 flex flex-col items-center justify-center opacity-50">
                            <Workflow className="w-12 h-12 mb-4 text-muted-foreground" />
                            <h3 className="text-lg font-bold">No Active Roadmap</h3>
                        </div>
                    )}
                </div>
            ) : viewMode === 'prediction' ? (
                <div className="space-y-6 max-w-4xl mx-auto">
                    <HypothesisExplorer contextId="global-lab" />
                </div>
            ) : (
                <SettingsPanel />
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => setPage(p => p - 1)}
                        className="rounded-full"
                    >
                        ← Previous
                    </Button>
                    <span className="text-xs text-muted-foreground font-mono">
                        Page {page + 1} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage(p => p + 1)}
                        className="rounded-full"
                    >
                        Next →
                    </Button>
                </div>
            )}
            {/* Configuration Dialog */}
            <Dialog open={configuring} onOpenChange={setConfiguring}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-background/90 backdrop-blur-2xl border-foreground/10 p-0">
                    <DialogHeader className="p-8 pb-0">
                        <DialogTitle className="text-2xl font-black flex items-center gap-2">
                            <Target className="w-6 h-6 text-primary" />
                            Configure <span className="text-primary">Program Resources</span>
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground pt-2">
                            Review and update mission prerequisites for <strong>{selectedCycle?.name}</strong>.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-8 space-y-12">
                        {/* Core Strategic Metadata */}
                        <div className="space-y-6">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-primary/60">Tactical Intelligence (I/O)</h3>
                            <div className="space-y-4">
                                {selectedCycle?.metadata?.blueprints?.map((bp: any, idx: number) => (
                                    <div key={idx} className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center text-[10px] font-black text-primary">{idx + 1}</div>
                                            <span className="text-sm font-bold">{bp.name}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <Label className="text-[10px] text-muted-foreground uppercase">Expected Inputs</Label>
                                                <div className="flex flex-wrap gap-1">
                                                    {(bp.inputs || []).map((input: string) => (
                                                        <Badge key={input} variant="outline" className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/20">{input}</Badge>
                                                    ))}
                                                    {(!bp.inputs || bp.inputs.length === 0) && <span className="text-[10px] text-muted-foreground italic">No requirements</span>}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] text-muted-foreground uppercase">Produced Outputs</Label>
                                                <div className="flex flex-wrap gap-1">
                                                    {(bp.outputs || []).map((output: string) => (
                                                        <Badge key={output} variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">{output}</Badge>
                                                    ))}
                                                    {(!bp.outputs || bp.outputs.length === 0) && <span className="text-[10px] text-muted-foreground italic">No products</span>}
                                                </div>
                                            </div>
                                        </div>
                                        {(bp.dataFlows || []).length > 0 && (
                                            <div className="pt-2 border-t border-foreground/5">
                                                <Label className="text-[10px] text-muted-foreground uppercase">Internal Data Flows</Label>
                                                <div className="space-y-1 mt-1">
                                                    {bp.dataFlows.map((df: any, dfIdx: number) => (
                                                        <div key={dfIdx} className="flex items-center gap-2 text-[10px] text-foreground font-medium">
                                                            <ArrowRight className="w-3 h-3 text-primary" />
                                                            <span>{df.sourceBlueprint}</span>
                                                            <span className="opacity-50">→</span>
                                                            <span>{df.targetInputKey}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-6">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-primary/60">Mission Prerequisites</h3>
                            {selectedCycle?.metadata?.blueprints?.filter((b: any) => normalizeCycleInputRequirements(b).length > 0).map((bp: any, bpIdx: number) => (
                            <div key={bpIdx} className="space-y-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-black text-sm">
                                        {bpIdx + 1}
                                    </div>
                                    <h3 className="text-lg font-bold tracking-tight">{bp.name}</h3>
                                </div>

                                <Card className="border-foreground/10 bg-foreground/5 backdrop-blur-xl overflow-hidden">
                                    <CardContent className="p-0 divide-y divide-white/5">
                                        {normalizeCycleInputRequirements(bp).map((res: any) => (
                                            <div key={res.id} className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 group hover:bg-foreground/[0.02] transition-colors">
                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        {res.type === 'url_list' && <LinkIcon className="w-4 h-4 text-primary" />}
                                                        {res.type === 'dataset' && <Database className="w-4 h-4 text-primary" />}
                                                        {res.type === 'credential' && <Key className="w-4 h-4 text-primary" />}
                                                        {res.type === 'text' && <FileText className="w-4 h-4 text-primary" />}
                                                        {res.type === 'number' && <Hash className="w-4 h-4 text-primary" />}
                                                        <Label className="text-sm font-bold">{res.label}</Label>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground pr-4 leading-relaxed">{res.description}</p>
                                                </div>
                                                <div className="md:col-span-2">
                                                    {res.type === 'url_list' ? (
                                                        <Textarea 
                                                            className="bg-background/40 border-foreground/10 min-h-[100px] font-mono text-xs"
                                                            placeholder={res.placeholder || "Enter one URL per line..."}
                                                            value={resourceAnswers[bp.name]?.[res.id] || ""}
                                                            onChange={e => setResourceAnswers(prev => ({
                                                                ...prev,
                                                                [bp.name]: { ...(prev[bp.name] || {}), [res.id]: e.target.value }
                                                            }))}
                                                        />
                                                    ) : (
                                                        <Input 
                                                            className="bg-background/40 border-foreground/10 h-10 text-sm"
                                                            placeholder={res.placeholder}
                                                            value={resourceAnswers[bp.name]?.[res.id] || ""}
                                                            onChange={e => setResourceAnswers(prev => ({
                                                                ...prev,
                                                                [bp.name]: { ...(prev[bp.name] || {}), [res.id]: e.target.value }
                                                            }))}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            </div>
                        ))}
                    </div>

                        {(!selectedCycle?.metadata?.blueprints || selectedCycle.metadata.blueprints.every((b: any) => normalizeCycleInputRequirements(b).length === 0)) && (
                            <div className="py-20 text-center space-y-4 opacity-50">
                                <Workflow className="w-12 h-12 mx-auto text-muted-foreground" />
                                <p className="text-sm font-medium">No resource requirements identified for this cycle strategy.</p>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="p-8 border-t border-foreground/10 bg-foreground/[0.02]">
                        <Button variant="ghost" onClick={() => setConfiguring(false)} className="rounded-full">
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSaveConfig}
                            disabled={updateCycleMutation.isPending}
                            className="rounded-full bg-primary hover:bg-primary/90 px-8 shadow-lg shadow-primary/20"
                        >
                            {updateCycleMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                            Apply Configuration
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            </div>
        </div>
    );
}
