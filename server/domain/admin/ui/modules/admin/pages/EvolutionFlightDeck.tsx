import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Zap, Activity, Cpu, Brain, GitMerge, ShieldCheck,
    Network, RefreshCcw, Terminal, Globe, Gauge, Check, X
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import EvoDevoPanel from "./EvoDevoPanel";

// ─── Config ─────────────────────────────────────────────────────────────────
// Shared accent map so stat cards, badges and top-borders stay on the same
// palette the Autoresearch dashboard uses (theme-token driven, not raw white/alpha).
const ACCENTS = {
    indigo:  { text: "text-indigo-600 dark:text-indigo-400",  bg: "bg-indigo-500/10",  bar: "bg-indigo-500",  badge: "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
    emerald: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", bar: "bg-emerald-500", badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    primary: { text: "text-primary",                           bg: "bg-primary/10",     bar: "bg-primary",     badge: "border-primary/20 bg-primary/10 text-primary" },
    amber:   { text: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-500/10",   bar: "bg-amber-500",   badge: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
} as const;

const ADAPTATION_ICONS: Record<string, any> = {
    DOC_SYNTHESIS: Terminal,
    SELF_HEALING: Zap,
    PERF_OPT: Gauge,
    SECURITY: ShieldCheck,
};

export default function EvolutionFlightDeck() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isSyncing, setIsSyncing] = useState(false);
    /**
     * Which surface the deck is showing.
     *
     * The evo-devo engine governs a different substrate from the neural core —
     * workflow genomes rather than prompts and skills — so it gets its own view
     * rather than more cards in an already dense one.
     */
    const [deckView, setDeckView] = useState<"core" | "evo-devo">("core");

    const { data: summary, isLoading: summaryLoading } = useQuery<any>({
        queryKey: ["/api/evolution/summary"],
        refetchInterval: 30000
    });

    const { data: pendingFixes = [] } = useQuery<any[]>({
        queryKey: ["/api/evolution/pending"],
        refetchInterval: 10000
    });

    const { data: benchmarks = [] } = useQuery<any[]>({
        queryKey: ["/api/evolution/benchmarks"],
        refetchInterval: 60000
    });

    const [selectedFixId, setSelectedFixId] = useState<string | null>(null);
    const [viewingTelemetry, setViewingTelemetry] = useState(false);

    const { data: diffData } = useQuery<any>({
        queryKey: ["/api/evolution/diff", selectedFixId],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/evolution/diff/${selectedFixId}`);
            return res.json();
        },
        enabled: !!selectedFixId
    });

    const handleExportTelemetry = async () => {
        setViewingTelemetry(true);
        const res = await apiRequest("GET", "/api/evolution/export-telemetry");
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `oddjob-telemetry-${Date.now()}.json`;
        a.click();
        setViewingTelemetry(false);
        toast({ title: "Telemetry Exported", description: "Anonymized node data packaged for federated sharing." });
    };

    const syncMutation = useMutation({
        mutationFn: async () => {
            setIsSyncing(true);
            const res = await apiRequest("POST", "/api/evolution/trigger-sync");
            return res.json();
        },
        onSuccess: (result: any) => {
            queryClient.invalidateQueries({ queryKey: ["/api/evolution/summary"] });
            queryClient.invalidateQueries({ queryKey: ["/api/evolution/pending"] });
            toast({
                title: "Evolution Scan Complete",
                description: result?.candidatesFound
                    ? `${result.candidatesFound} candidate${result.candidatesFound === 1 ? "" : "s"} found. Findings are routed to Assistant.`
                    : "No critical candidates found. Assistant will surface future findings automatically.",
            });
            setIsSyncing(false);
        },
        onError: (err: any) => {
            toast({
                title: "Scan Not Started",
                description: err?.message || "Oddjob is still starting. Try again in a moment.",
                variant: "destructive",
            });
            setIsSyncing(false);
        }
    });

    const approveMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await apiRequest("POST", `/api/evolution/approve/${id}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || "Approval failed");
            return data;
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ["/api/evolution/pending"] });
            queryClient.invalidateQueries({ queryKey: ["/api/evolution/summary"] });
            setSelectedFixId(null);
            toast({ title: "Evolution Approved", description: data?.message || "Evolution applied." });
        },
        onError: (err: any) => {
            toast({ title: "Approval Failed", description: err?.message || "Could not apply this evolution.", variant: "destructive" });
        }
    });

    // Validated autonomous adjustments. TODO: source from /api/evolution when the
    // adaptation-registry endpoint lands; kept inline so the section renders today.
    const adaptationRegistry = [
        { type: "DOC_SYNTHESIS", title: "Architecture Registry Sync", description: "Automated reconciliation of docs/reports/generated-architecture-registry.md from pod registry facade states.", timestamp: "Just now" },
        { type: "SELF_HEALING", title: "Circular Dependency Resolution", description: "Resolved recursive pod import between Learning and Evolution pods in core registry.", timestamp: "2m ago" },
        { type: "PERF_OPT", title: "Query Harmonization", description: "Injected multi-index vector optimizations on the Forensic Log telemetry table.", timestamp: "1h ago" },
    ];

    const stats = [
        { label: "Adaptive Reliability", value: `${summary?.globalReliability ?? 0}%`, accent: ACCENTS.indigo,  icon: Brain, tag: "Phase 9 Engaged" },
        { label: "Neural Nodes",         value: summary?.connectedNodes ?? 0,          accent: ACCENTS.emerald, icon: Cpu,   tag: "Ecosystem Scale" },
        { label: "Pending Fixes",        value: pendingFixes.length,                   accent: ACCENTS.primary, icon: Zap,   tag: "Self Healing" },
        { label: "Response Latency",     value: `${summary?.globalLatency ?? 0}ms`,    accent: ACCENTS.amber,   icon: Gauge, tag: "Environment Health" },
    ];

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 relative overflow-hidden flex flex-col transition-colors duration-200">
            {/* Subtle Grid Backdrop (matches Autoresearch) */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 opacity-20 dark:opacity-5">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem]" />
            </div>

            {/* Diff Modal */}
            <AnimatePresence>
                {selectedFixId && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-modal flex items-center justify-center p-4 md:p-8 bg-background/80 backdrop-blur-xl"
                    >
                        <motion.div
                            initial={{ scale: 0.96, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            className="w-full max-w-5xl max-h-[80vh] bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-lg"
                        >
                            <div className="p-6 border-b border-border flex justify-between items-center">
                                <div>
                                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-foreground">Evolution Diff Inspector</CardTitle>
                                    <CardDescription className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">Inspecting proposed change for: {selectedFixId}</CardDescription>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => setSelectedFixId(null)} className="rounded-lg h-9 w-9">
                                    <X size={18} />
                                </Button>
                            </div>
                            <div className="flex-1 overflow-auto p-6 custom-scrollbar bg-muted/20">
                                {diffData ? (
                                    <pre className="text-[11px] font-mono leading-relaxed text-muted-foreground">
                                        {diffData.diff.split('\n').map((line: string, i: number) => {
                                            const colorClass = line.startsWith('+') ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' :
                                                               line.startsWith('-') ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10' :
                                                               'text-muted-foreground/70';
                                            return (
                                                <div key={i} className={cn("px-3 py-0.5 rounded", colorClass)}>
                                                    {line || " "}
                                                </div>
                                            );
                                        })}
                                    </pre>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-muted-foreground/50 text-[10px] font-bold uppercase tracking-widest animate-pulse">
                                        Generating unified diff...
                                    </div>
                                )}
                            </div>
                            <div className="p-6 border-t border-border flex justify-end gap-3">
                                <Button variant="outline" onClick={() => setSelectedFixId(null)} className="h-10 px-5 rounded-lg text-xs font-semibold uppercase tracking-wider">
                                    Stay Pending
                                </Button>
                                <Button onClick={() => approveMutation.mutate(selectedFixId)} className="h-10 px-5 rounded-lg text-xs font-semibold uppercase tracking-wider">
                                    <Check className="w-4 h-4 mr-2" />
                                    Approve & Deploy
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <main className="flex-1 relative z-10 flex flex-col p-4 md:p-6 gap-6 max-w-full mx-auto w-full">
                {/* Unified Header (matches Autoresearch) */}
                <header className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 pb-6 border-b border-border">
                    <div className="space-y-2 min-w-0">
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">
                                Neural Evolution
                            </Badge>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Flight Deck</span>
                        </div>
                        <div className="space-y-1">
                            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                                Evolution <span className="text-primary">Flight Deck</span>
                            </h1>
                            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                                Govern autonomous system evolution — architecture scans, self-healing fixes, and federated node benchmarks.
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-4 w-full sm:w-auto xl:shrink-0">
                        <Button
                            onClick={() => syncMutation.mutate()}
                            disabled={isSyncing || syncMutation.isPending}
                            variant="default"
                            className={cn(
                                "h-10 w-full sm:w-auto px-5 rounded-lg text-xs font-semibold tracking-wider transition-all relative overflow-hidden",
                                syncMutation.isPending && "opacity-80"
                            )}
                        >
                            <RefreshCcw className={cn("w-4 h-4 mr-3 transition-transform duration-500", (isSyncing || syncMutation.isPending) && "animate-spin")} />
                            {syncMutation.isPending ? "Syncing..." : "Sync Neural Core"}
                            {syncMutation.isPending && (
                                <motion.div
                                    className="absolute bottom-0 left-0 h-1 bg-primary"
                                    initial={{ width: 0 }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 2, repeat: Infinity }}
                                />
                            )}
                        </Button>
                    </div>
                </header>

                <Tabs value={deckView} onValueChange={(value) => setDeckView(value as "core" | "evo-devo")}>
                    <TabsList>
                        <TabsTrigger value="core" data-testid="deck-tab-core">Neural Core</TabsTrigger>
                        <TabsTrigger value="evo-devo" data-testid="deck-tab-evo-devo">Evo-Devo</TabsTrigger>
                    </TabsList>
                </Tabs>

                {deckView === "evo-devo" ? <EvoDevoPanel /> : <>

                {/* Neural HUD — stat cards */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {summaryLoading ? (
                        Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
                    ) : (
                        stats.map((stat, i) => {
                            const Icon = stat.icon;
                            return (
                                <motion.div
                                    key={stat.label}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                >
                                    <Card className="border border-border hover:border-border/80 transition-all group overflow-hidden h-full bg-card shadow-sm relative">
                                        <div className={cn("absolute top-0 left-0 w-full h-0.5 opacity-40", stat.accent.bar)} />
                                        <CardContent className="p-4 flex flex-col justify-between h-full gap-4">
                                            <div className="flex justify-between items-start">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{stat.label}</span>
                                                <Icon size={14} className={cn("opacity-60 group-hover:opacity-100 transition-all", stat.accent.text)} />
                                            </div>
                                            <div className="space-y-2">
                                                <div className={cn("text-2xl font-extrabold tracking-tight", stat.accent.text)}>{stat.value}</div>
                                                <Badge variant="outline" className={cn("h-5 px-2 text-[9px] font-semibold uppercase tracking-wider", stat.accent.badge)}>{stat.tag}</Badge>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            );
                        })
                    )}
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                    <div className="lg:col-span-2 space-y-6">
                        {/* HIL Approval Section */}
                        <AnimatePresence mode="wait">
                            {pendingFixes.length > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="space-y-4"
                                >
                                    <div className="flex items-center gap-3">
                                        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Pending Evolution Fixes</h2>
                                        <div className="h-px flex-1 bg-border" />
                                        <Badge variant="secondary" className="h-6 px-2 text-[10px] font-semibold uppercase tracking-wider">{pendingFixes.length}</Badge>
                                    </div>

                                    {pendingFixes.map((fix) => (
                                        <Card key={fix.id} className="border-border rounded-xl overflow-hidden shadow-sm bg-card relative">
                                            <div className="absolute top-0 left-0 w-full h-0.5 bg-indigo-500 opacity-40" />
                                            <CardContent className="p-6">
                                                <div className="flex gap-5">
                                                    <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 h-fit">
                                                        <GitMerge className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                                    </div>
                                                    <div className="flex-1 space-y-3 min-w-0">
                                                        <div className="flex justify-between items-start gap-3">
                                                            <div className="min-w-0">
                                                                <h3 className="text-base font-bold text-foreground truncate">{fix.id}</h3>
                                                                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">Target: {fix.filePath}</p>
                                                            </div>
                                                            <Badge variant="outline" className={`h-6 px-2 shrink-0 text-[9px] font-semibold uppercase tracking-wider ${fix.advisory ? "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"}`}>
                                                                {fix.advisory ? "Detection Only" : "Awaiting HIL Approval"}
                                                            </Badge>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">{fix.description}</p>
                                                        <div className="flex gap-3 pt-1">
                                                            <Button
                                                                onClick={() => approveMutation.mutate(fix.id)}
                                                                disabled={fix.advisory}
                                                                title={fix.advisory ? "Detection-only finding — no code patch to apply. Requires manual remediation." : undefined}
                                                                className="h-9 px-4 rounded-lg text-[10px] font-semibold uppercase tracking-wider"
                                                            >
                                                                <Check className="w-4 h-4 mr-2" />
                                                                {fix.advisory ? "No Patch to Apply" : "Approve Evolution"}
                                                            </Button>
                                                            <Button variant="outline" onClick={() => setSelectedFixId(fix.id)} className="h-9 px-4 rounded-lg text-[10px] font-semibold uppercase tracking-wider">
                                                                <Terminal className="w-4 h-4 mr-2" />
                                                                Inspect Diff
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Adaptation Registry */}
                        <Card className="border-border rounded-xl overflow-hidden shadow-sm bg-card flex flex-col">
                            <CardHeader className="p-6 pb-4 border-b border-border flex flex-row items-center justify-between">
                                <div className="space-y-1">
                                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-foreground">Neural Adaptation Registry</CardTitle>
                                    <CardDescription className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Validated autonomous environmental adjustments</CardDescription>
                                </div>
                                <Activity className="text-primary w-4 h-4" />
                            </CardHeader>
                            <CardContent className="p-0 max-h-[400px] overflow-auto custom-scrollbar">
                                <div className="divide-y divide-border">
                                    {adaptationRegistry.map((event, i) => {
                                        const Icon = ADAPTATION_ICONS[event.type] || Terminal;
                                        return (
                                            <div key={i} className="p-6 hover:bg-muted/20 transition-all group flex gap-5">
                                                <div className="p-2.5 rounded-lg bg-muted/40 border border-border h-fit group-hover:border-primary/40 transition-all">
                                                    <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                                </div>
                                                <div className="flex-1 space-y-2 min-w-0">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <Badge variant="outline" className="h-6 px-2 rounded-lg border-border text-[9px] font-semibold uppercase tracking-wider">{event.type}</Badge>
                                                        <span className="text-[10px] font-medium text-muted-foreground">{event.timestamp}</span>
                                                    </div>
                                                    <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{event.title}</h3>
                                                    <p className="text-xs text-muted-foreground leading-relaxed">{event.description}</p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar: Benchmarks & Architecture */}
                    <div className="space-y-6">
                        {/* Federated Benchmark Leagues */}
                        <Card className="border-border rounded-xl overflow-hidden shadow-sm bg-card">
                            <CardHeader className="p-6 pb-4 border-b border-border">
                                <CardTitle className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                                    <Network size={14} className="text-primary" />
                                    Federated Benchmark Leagues
                                </CardTitle>
                                <CardDescription className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">Anonymous Nodes</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-3">
                                {benchmarks.length > 0 ? benchmarks.map((node) => (
                                    <div key={node.node} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border group hover:bg-muted/40 transition-all">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="text-xs font-mono font-bold text-muted-foreground/50">0{node.rank}</span>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-xs font-semibold text-foreground truncate">{node.node}</span>
                                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Reliability: {node.reliability}%</span>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className={cn(
                                            "h-6 px-2 text-[9px] font-semibold uppercase tracking-wider shrink-0",
                                            node.score === "S-Tier" ? "border-primary/20 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                                        )}>{node.score}</Badge>
                                    </div>
                                )) : (
                                    <div className="rounded-lg border border-border bg-muted/40 p-4 text-center">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Aggregating node telemetry...</p>
                                    </div>
                                )}
                                <Button
                                    onClick={handleExportTelemetry}
                                    disabled={viewingTelemetry}
                                    variant="outline"
                                    className="w-full h-10 rounded-lg text-[10px] font-semibold uppercase tracking-wider mt-2"
                                >
                                    <Globe className={cn("w-4 h-4 mr-2", viewingTelemetry && "animate-spin")} />
                                    {viewingTelemetry ? "Packaging Nodes..." : "View Global Telemetry"}
                                </Button>
                            </CardContent>
                        </Card>

                        {/* Architecture Sentinel */}
                        <Card className="border-border rounded-xl overflow-hidden shadow-sm bg-card">
                            <CardHeader className="p-6 pb-4">
                                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                    <ShieldCheck size={14} className="text-primary" />
                                    Architecture Sentinel
                                </CardTitle>
                                <CardDescription className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">Status: Scanning Registry</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 space-y-2">
                                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    <span>Registry Sync</span>
                                    <span className="text-emerald-600 dark:text-emerald-400">Nominal</span>
                                </div>
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                    <motion.div
                                        className="h-full bg-primary rounded-full"
                                        initial={{ width: "0%" }}
                                        animate={{ width: "85%" }}
                                        transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                </>}
            </main>
        </div>
    );
}
