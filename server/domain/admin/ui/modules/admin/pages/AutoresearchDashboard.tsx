import { useState } from "react";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { Link } from "wouter";
import {
    FlaskConical, ShieldAlert, Star, Lightbulb, GitMerge,
    CheckCircle2, ArrowUpDown, RefreshCcw, ExternalLink,
    Zap, Target, Cpu, Brain, Flame, BarChart3,
    ArrowUpRight, ChevronRight, Filter, Search, Bell, Clock, Check
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ARSummary {
    totalExperiments: number;
    evaluated: number;
    improved: number;
    promoted: number;
    avgEvalScore: number | null;
    totalCostUsd: string;
    pendingProposals: number;
    totalMissionsWithActivity: number;
}

interface AREntry {
    phase: string;
    type: "trigger" | "experiment" | "evaluation" | "proposal" | "synthesis" | "promotion";
    title: string;
    detail: string;
    score?: number;
    isImproved?: boolean;
    status: string;
    skillId?: string;
    shadowId?: number;
    proposalId?: number;
    modelId?: string;
    strategy?: string;
    failureCount?: number;
    cost?: string;
    isAutoSynthesis?: boolean;
    missionRun?: string | null;
    parentRunId?: number;
    parentMissionId?: number | null;
    timestamp: string;
}

interface ARReport {
    summary: ARSummary;
    timeline: AREntry[];
    candidates?: ARCandidate[];
    diagnostics?: ARDiagnostics;
}

interface ARCandidate {
    skillId: string;
    total: number;
    success: number;
    failure: number;
    reliabilityPct: number;
    latestEventAt: string | null;
    linkedRunCount: number;
    unlinkedEventCount: number;
    latestMissionRunId: number | null;
    latestMissionId?: number | null;
    status: "ready" | "blocked_missing_mission_run";
    reason: string;
}

interface ARDiagnostics {
    thresholdPct: number;
    eligibleCandidates: number;
    readyCandidates: number;
    blockedCandidates: number;
    telemetryEvents: number;
    unlinkedEvents: number;
}

interface ARSyncDetail {
    skillId: string;
    status: string;
    reason?: string;
    runId?: number;
    reliabilityPct?: number;
    total?: number;
    success?: number;
    failure?: number;
    linkedRunCount?: number;
    unlinkedEventCount?: number;
}

interface ARSyncResult {
    message: string;
    candidatesTriggered: number;
    candidatesFound?: number;
    blockedCandidates?: number;
    assistantFindings?: number;
    details?: ARSyncDetail[];
}

interface ARAutomationStatus {
    enabled: boolean;
    intervalMinutes: number;
    intervalLabel: string;
    assistantFindingsEnabled: boolean;
    syncInFlight: boolean;
    lastSyncAt: string | null;
    screenRole: string;
    screenNecessary: boolean;
    screenRationale: string;
    lastSyncSummary: {
        orgsScanned: number;
        candidatesFound: number;
        candidatesTriggered: number;
        blockedCandidates: number;
        assistantFindings: number;
        errors: number;
    } | null;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string; border: string; glow: string; label: string }> = {
    trigger:    { icon: ShieldAlert, color: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/20",    glow: "shadow-rose-500/20",    label: "TRIGGER_ALERT" },
    experiment: { icon: FlaskConical, color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20",    glow: "shadow-blue-500/20",    label: "EXPERIMENT" },
    evaluation: { icon: Star, color: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/20",  glow: "shadow-purple-500/20",  label: "EVALUATION" },
    proposal:   { icon: Lightbulb, color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20",   glow: "shadow-amber-500/20",   label: "PROPOSAL" },
    synthesis:  { icon: GitMerge, color: "text-indigo-400",  bg: "bg-indigo-500/10",  border: "border-indigo-500/20",  glow: "shadow-indigo-500/20",  label: "SYNTHESIS" },
    promotion:  { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", glow: "shadow-emerald-500/20", label: "PROMOTION" },
};

const FILTER_OPTIONS = [
    { value: "all",        label: "ALL_PHASES" },
    { value: "trigger",    label: "TRIGGERS" },
    { value: "experiment", label: "EXPERIMENTS" },
    { value: "evaluation", label: "EVALUATIONS" },
    { value: "proposal",   label: "PROPOSALS" },
    { value: "synthesis",  label: "SYNTHESIS" },
    { value: "promotion",  label: "PROMOTIONS" },
];

const formatMaybeDate = (value: string | null | undefined) => {
    if (!value) return "No events";
    return format(new Date(value), "MMM d, HH:mm");
};

export default function AutoresearchDashboard() {
    const { selectedOrgId } = useOrgContext();
    const queryClient = useQueryClient();
    const [filter, setFilter] = useState("all");
    const [sort, setSort] = useState<"asc" | "desc">("desc");
    const [missionFilter, setMissionFilter] = useState("all");
    const [lastSyncResult, setLastSyncResult] = useState<ARSyncResult | null>(null);

    const { data, isLoading, refetch, isFetching } = useQuery<ARReport>({
        queryKey: ["/api/admin/autoresearch/org-report", selectedOrgId, filter, sort],
        queryFn: async () => {
            const params = new URLSearchParams({
                ...(selectedOrgId ? { orgId: String(selectedOrgId) } : {}),
                filter,
                sort,
            });
            const res = await fetch(`/api/admin/autoresearch/org-report?${params}`);
            return res.json();
        },
        refetchInterval: 60_000,
    });

    const { data: automationStatus } = useQuery<ARAutomationStatus>({
        queryKey: ["/api/admin/autoresearch/automation-status"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/admin/autoresearch/automation-status");
            return res.json();
        },
        refetchInterval: 30_000,
    });

    const { toast } = useToast();
    const syncMutation = useMutation({
        mutationFn: async () => {
            const url = "/api/admin/autoresearch/sync";
            console.log(`[AutoresearchSync] Attempting POST to ${url}`, { orgId: selectedOrgId });
            try {
                const res = await apiRequest("POST", url, {
                    orgId: selectedOrgId
                });
                const data = await res.json();
                console.log(`[AutoresearchSync] Success:`, data);
                return data;
            } catch (err: any) {
                console.error(`[AutoresearchSync] Request Failed:`, {
                    message: err.message,
                    status: err.status,
                    raw: err.rawResponse
                });
                throw err;
            }
        },
        onSuccess: (data: ARSyncResult) => {
            setLastSyncResult(data);
            toast({
                title: "Autoresearch Run Complete",
                description: data.assistantFindings
                    ? `${data.message} ${data.assistantFindings} finding${data.assistantFindings === 1 ? "" : "s"} routed to Assistant.`
                    : data.message || "Autoresearch checked eligible skills. Assistant will surface future findings.",
            });
            refetch();
        },
        onError: (err: any) => {
            toast({
                title: "Autoresearch Not Started",
                description: err?.message || "Oddjob is still starting. Try again in a moment.",
                variant: "destructive"
            });
        }
    });

    const promoteShadowMutation = useMutation({
        mutationFn: async (shadowId: number) => {
            const res = await apiRequest("POST", `/api/mission-runs/shadow-runs/${shadowId}/promote`, {});
            return res.json();
        },
        onSuccess: (result: any) => {
            toast({
                title: "Shadow Promoted",
                description: result?.message || "Autoresearch shadow is now the primary configuration.",
            });
            refetch();
            queryClient.invalidateQueries({ queryKey: ["/api/admin/autoresearch/org-report"] });
        },
        onError: (err: any) => {
            toast({
                title: "Promotion Failed",
                description: err?.message || "The shadow run could not be promoted.",
                variant: "destructive",
            });
        }
    });

    const summary = data?.summary;
    const candidates = data?.candidates ?? [];
    const diagnostics = data?.diagnostics;
    const blockedCandidates = candidates.filter(candidate => candidate.status === "blocked_missing_mission_run");
    const readyCandidates = candidates.filter(candidate => candidate.status === "ready");
    const lastSyncDetails = lastSyncResult?.details ?? [];
    const allTimeline = data?.timeline ?? [];

    const missionNames = Array.from(new Set(allTimeline.map(e => e.missionRun).filter(Boolean))) as string[];
    const timeline = missionFilter === "all"
        ? allTimeline
        : allTimeline.filter(e => e.missionRun === missionFilter);
    const pendingApprovals = summary?.pendingProposals ?? 0;
    const assistantRoutedCount = Math.max(
        pendingApprovals,
        lastSyncResult?.assistantFindings ?? 0,
        automationStatus?.lastSyncSummary?.assistantFindings ?? 0
    );
    const lastRunMessage = lastSyncResult?.message
        ?? (automationStatus?.lastSyncAt
            ? `Last automatic run: ${format(new Date(automationStatus.lastSyncAt), "MMM d, HH:mm")}.`
            : "No manual run has run in this view yet.");

    const openAssistantForAutoresearch = () => {
        window.dispatchEvent(new CustomEvent("agent-assist-request", {
            detail: {
                prompt: "Review Autoresearch findings, pending approvals, blocked candidates, and recommend the safest next action.",
                context: {
                    source: "autoresearch-dashboard",
                    automationStatus,
                    summary,
                    diagnostics,
                    candidates: candidates.slice(0, 10),
                    pendingApprovals,
                    lastSyncResult
                }
            }
        }));
    };

    const missionRunHref = (missionId?: number | null, runId?: number | null) => {
        if (!runId) return null;
        return missionId ? `/missions/${missionId}/runs/${runId}` : `/mission-runs/${runId}`;
    };

    const promoteShadow = (entry: AREntry) => {
        if (!entry.shadowId) return;
        promoteShadowMutation.mutate(entry.shadowId);
    };

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 relative overflow-hidden flex flex-col transition-colors duration-200">
            {/* Subtle Grid Backdrop */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 opacity-20 dark:opacity-5">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem]" />
            </div>

            <main className="flex-1 relative z-10 flex flex-col p-4 md:p-6 gap-6 max-w-full mx-auto w-full">
                {/* Unified Header */}
                <header className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 pb-6 border-b border-border">
                    <div className="space-y-2 min-w-0">
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">
                                Neural Evolution
                            </Badge>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Autoresearch Monitor</span>
                        </div>
                        <div className="space-y-1">
                            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                                Autoresearch <span className="text-primary">Cockpit</span>
                            </h1>
                            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                                Automatic runs route findings and approvals to Assistant; this screen stays for evidence, lineage, filters, and manual governance.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto xl:shrink-0">
                        <Button
                            onClick={openAssistantForAutoresearch}
                            variant="outline"
                            className="h-10 w-full sm:w-auto px-5 rounded-lg text-xs font-semibold tracking-wider"
                        >
                            <Bell className="w-4 h-4 mr-2" />
                            Assistant Brief
                        </Button>
                        <Button
                            onClick={() => syncMutation.mutate()}
                            disabled={isFetching || syncMutation.isPending}
                            variant="default"
                            className={cn(
                                "h-10 w-full sm:w-auto px-5 rounded-lg text-xs font-semibold tracking-wider transition-all group relative overflow-hidden",
                                syncMutation.isPending && "opacity-80"
                            )}
                        >
                            <RefreshCcw className={cn("w-4 h-4 mr-3 transition-transform duration-500", (isFetching || syncMutation.isPending) && "animate-spin")} />
                            {syncMutation.isPending ? "Running..." : "Run Autoresearch Now"}
                            
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

                <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                    {isLoading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                            <Skeleton key={i} className="h-24 rounded-xl" />
                        ))
                    ) : summary && (
                        ([
                            { label: "Candidates",        value: diagnostics?.eligibleCandidates ?? candidates.length, color: candidates.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/50", icon: Target },
                            { label: "Blocked",           value: diagnostics?.blockedCandidates ?? blockedCandidates.length, color: blockedCandidates.length > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground/50", icon: ShieldAlert },
                            { label: "Experiments",       value: summary.totalExperiments,          color: "text-blue-600 dark:text-blue-400", icon: FlaskConical },
                            { label: "Evaluated",         value: summary.evaluated,                 color: "text-indigo-600 dark:text-indigo-400", icon: BarChart3 },
                            { label: "Improved",          value: summary.improved,                  color: "text-emerald-600 dark:text-emerald-400", icon: Flame },
                            { label: "Promoted",          value: summary.promoted,                  color: "text-amber-600 dark:text-amber-400", icon: GitMerge },
                            { label: "Run Cadence",       value: automationStatus?.intervalLabel ?? "1 hour", color: "text-amber-600 dark:text-amber-400", icon: Clock },
                            { label: "Assistant Routed",  value: assistantRoutedCount,              color: assistantRoutedCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground/50", icon: Bell },
                        ] as const).map((stat, i) => {
                            const Icon = stat.icon;
                            return (
                                <motion.div
                                    key={stat.label}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                >
                                    <Card className="border border-border hover:border-border/80 transition-all group overflow-hidden h-full bg-card shadow-sm relative">
                                        <div className={cn("absolute top-0 left-0 w-full h-0.5 opacity-40", stat.color.includes('amber') ? 'bg-amber-500' : stat.color.includes('rose') ? 'bg-rose-500' : stat.color.includes('blue') ? 'bg-blue-500' : stat.color.includes('indigo') ? 'bg-indigo-500' : stat.color.includes('emerald') ? 'bg-emerald-500' : stat.color.includes('purple') ? 'bg-purple-500' : 'bg-muted')} />
                                        <CardContent className="p-4 flex flex-col justify-between h-full gap-4">
                                            <div className="flex justify-between items-start">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{stat.label}</span>
                                                <Icon size={14} className={cn("opacity-60 group-hover:opacity-100 transition-all", stat.color)} />
                                            </div>
                                            <div className={cn("text-2xl font-extrabold tracking-tight", stat.color)}>
                                                {stat.value}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            );
                        })
                    )}
                </section>

                {!isLoading && summary && (
                    <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <Card className="border-border rounded-xl overflow-hidden shadow-sm xl:col-span-2 bg-card">
                            <CardHeader className="p-6 pb-4 border-b border-border flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-foreground">Candidate Intake</CardTitle>
                                    <CardDescription className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
                                        Org Scoped // Threshold {diagnostics?.thresholdPct ?? 80}%
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="h-7 px-3 rounded-lg border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wider">
                                        {readyCandidates.length} Ready
                                    </Badge>
                                    <Badge variant="outline" className="h-7 px-3 rounded-lg border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-semibold uppercase tracking-wider">
                                        {blockedCandidates.length} Blocked
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-6 space-y-3">
                                {candidates.length === 0 ? (
                                    <div className="rounded-lg border border-border bg-muted/40 p-4 flex items-center gap-3">
                                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                        <div>
                                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">No At-Risk Candidates</p>
                                            <p className="text-xs text-muted-foreground/80 mt-1">No low-reliability skills crossed the intake threshold for this organization.</p>
                                        </div>
                                    </div>
                                ) : (
                                    candidates.map((candidate) => {
                                        const isBlocked = candidate.status === "blocked_missing_mission_run";
                                        const reliabilityWidth = Math.max(2, Math.min(100, candidate.reliabilityPct));
                                        return (
                                            <div key={candidate.skillId} className={cn(
                                                "rounded-lg border p-4 transition-colors bg-muted/10 border-border hover:bg-muted/20",
                                                isBlocked ? "border-rose-500/20 dark:border-rose-500/10" : "border-emerald-500/20 dark:border-emerald-500/10"
                                            )}>
                                                <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
                                                    <div className="min-w-0 flex-1 space-y-3">
                                                        <div className="flex items-center gap-3 flex-wrap">
                                                            <Badge variant={isBlocked ? "destructive" : "secondary"} className="h-6 px-2 text-[10px] font-semibold uppercase tracking-wider">
                                                                {isBlocked ? "Missing Link" : "Ready"}
                                                            </Badge>
                                                            <span className="font-mono text-xs text-foreground truncate">{candidate.skillId}</span>
                                                        </div>

                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                                <span>{candidate.success}/{candidate.total} Success</span>
                                                                <span>{candidate.reliabilityPct.toFixed(1)}% Reliability</span>
                                                            </div>
                                                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                                                <div
                                                                    className={cn("h-full rounded-full", isBlocked ? "bg-rose-500" : "bg-emerald-500")}
                                                                    style={{ width: `${reliabilityWidth}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-3 gap-3 lg:min-w-[320px]">
                                                        <div className="rounded-lg bg-background border border-border p-3">
                                                            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Linked Runs</p>
                                                            <p className="text-sm font-mono font-bold text-foreground mt-1">{candidate.linkedRunCount}</p>
                                                        </div>
                                                        <div className="rounded-lg bg-background border border-border p-3">
                                                            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Unlinked</p>
                                                            <p className={cn("text-sm font-mono font-bold mt-1", candidate.unlinkedEventCount > 0 ? "text-rose-500" : "text-foreground")}>{candidate.unlinkedEventCount}</p>
                                                        </div>
                                                        <div className="rounded-lg bg-background border border-border p-3">
                                                            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Latest</p>
                                                            <p className="text-[10px] font-mono font-bold text-muted-foreground mt-1">{formatMaybeDate(candidate.latestEventAt)}</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="mt-4 pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                    <p className="text-xs text-muted-foreground max-w-3xl">{candidate.reason}</p>
                                                    {candidate.latestMissionRunId && (
                                                        <Link href={missionRunHref(candidate.latestMissionId, candidate.latestMissionRunId) ?? `/mission-runs/${candidate.latestMissionRunId}`}>
                                                            <Button variant="outline" size="sm" className="h-8 px-3 text-[10px] font-semibold tracking-wider text-primary hover:bg-primary/10 border-primary/20">
                                                                Inspect Run
                                                                <ExternalLink className="ml-2 h-3 w-3" />
                                                            </Button>
                                                        </Link>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </CardContent>
                        </Card>

                        <Card className="border-border rounded-xl overflow-hidden shadow-sm bg-card">
                            <CardHeader className="p-6 pb-4 border-b border-border">
                                <CardTitle className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                                    <Bell size={14} className="text-primary" />
                                    Assistant Findings
                                </CardTitle>
                                <CardDescription className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
                                    Automatic handoff and manual run result
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-5">
                                <div className="rounded-lg border border-primary/15 bg-primary/5 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Cadence</p>
                                            <p className="text-sm font-bold text-foreground mt-1">
                                                Every {automationStatus?.intervalLabel ?? "1 hour"}
                                            </p>
                                        </div>
                                        <Badge variant="outline" className="h-7 px-3 rounded-lg border-primary/20 bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
                                            Assistant Routed
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed mt-3">
                                        Findings, blocked candidates, and approval-worthy proposals are sent to Assistant. Use this view for evidence and lineage.
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-lg bg-primary/10 border border-primary/15 p-4">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-primary italic">Triggered</p>
                                        <p className="text-2xl font-extrabold font-mono text-primary mt-2">{lastSyncResult?.candidatesTriggered ?? 0}</p>
                                    </div>
                                    <div className="rounded-lg bg-rose-500/10 border border-rose-500/15 p-4">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 italic">Blocked</p>
                                        <p className="text-2xl font-extrabold font-mono text-rose-600 dark:text-rose-400 mt-2">{lastSyncResult?.blockedCandidates ?? blockedCandidates.length}</p>
                                    </div>
                                </div>

                                <div className="rounded-lg border border-border bg-muted/30 p-4">
                                    <div className="flex items-start gap-3">
                                        <Zap className="w-4 h-4 text-amber-500 mt-0.5" />
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            {lastRunMessage}
                                        </p>
                                    </div>
                                </div>

                                <Button
                                    onClick={openAssistantForAutoresearch}
                                    variant="outline"
                                    className="w-full h-10 rounded-lg text-xs font-semibold tracking-wider"
                                >
                                    <Bell className="w-4 h-4 mr-2" />
                                    Open Assistant Brief
                                </Button>

                                <div className="space-y-2 max-h-52 overflow-auto custom-scrollbar pr-1">
                                    {lastSyncDetails.length === 0 ? (
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 italic">Sync Details Pending</p>
                                    ) : lastSyncDetails.map((detail) => (
                                        <div key={`${detail.skillId}-${detail.status}`} className="rounded-lg border border-border bg-muted/20 p-3 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="font-mono text-xs text-foreground truncate">{detail.skillId}</p>
                                                <p className="text-[10px] text-muted-foreground mt-1">{detail.reliabilityPct != null ? `${detail.reliabilityPct.toFixed(1)}% reliability` : "No reliability score"}</p>
                                            </div>
                                            <Badge variant={detail.status === "triggered" ? "default" : "outline"} className="h-6 px-2 text-[8px] font-bold uppercase tracking-wider shrink-0">
                                                {detail.status}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </section>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
                    {/* Control Sidebar */}
                    <aside className="lg:col-span-1 space-y-6">
                        <Card className="border-border rounded-xl overflow-hidden shadow-sm bg-card">
                            <CardHeader className="p-6 pb-4">
                                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                    <Filter size={14} className="text-primary" />
                                    Filters
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 space-y-6">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-2">Phase Isolation</label>
                                    <div className="grid grid-cols-1 gap-1">
                                        {FILTER_OPTIONS.map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => setFilter(opt.value)}
                                                className={cn(
                                                    "flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all border border-transparent",
                                                    filter === opt.value
                                                        ? "bg-primary/10 text-primary border-primary/20 shadow-sm"
                                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                                )}
                                            >
                                                {opt.label}
                                                {filter === opt.value && <ChevronRight size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {missionNames.length > 0 && (
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-2">Mission Scope</label>
                                        <div className="relative group">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-colors" />
                                            <select
                                                className="w-full h-10 bg-muted/30 border border-border rounded-lg pl-9 pr-3 text-xs font-semibold tracking-wider uppercase focus:ring-1 focus:ring-primary outline-none appearance-none cursor-pointer"
                                                value={missionFilter}
                                                onChange={e => setMissionFilter(e.target.value)}
                                                title="Filter by Mission"
                                            >
                                                <option value="all">ALL MISSION RUNS</option>
                                                {missionNames.map(name => (
                                                    <option key={name} value={name}>{name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}

                                <div className="pt-4 border-t border-border flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Temporal Sort</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-xs font-bold uppercase tracking-wider text-primary hover:bg-primary/10"
                                        onClick={() => setSort(s => s === "asc" ? "desc" : "asc")}
                                    >
                                        <ArrowUpDown className="w-3 h-3 mr-2" />
                                        {sort === "desc" ? "NEWEST" : "OLDEST"}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="p-6 bg-primary/5 rounded-xl border border-primary/10 flex items-start gap-4 transition-all hover:bg-primary/10">
                            <div className="p-3 bg-primary/10 rounded-lg shrink-0">
                                <Cpu className="w-5 h-5 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-bold uppercase tracking-wider text-primary mb-1">Screen Role</p>
                                <p className="text-[10px] text-muted-foreground leading-relaxed font-semibold uppercase tracking-wider">
                                    Assistant handles attention. This cockpit remains for audit trail, evidence review, and manual controls.
                                </p>
                            </div>
                        </div>
                    </aside>

                    {/* Evolution Timeline */}
                    <div className="lg:col-span-3 min-h-0 flex flex-col">
                        <Card className="border-border rounded-xl overflow-hidden flex flex-col h-full shadow-sm bg-card">
                            <CardHeader className="p-6 pb-4 border-b border-border flex flex-row items-center justify-between">
                                <div className="space-y-1">
                                    <CardTitle className="text-base font-bold uppercase tracking-wider text-foreground">Evolution Stream</CardTitle>
                                    <CardDescription className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sequential Neural Adjustments</CardDescription>
                                </div>
                                <Badge variant="secondary" className="h-7 px-3 rounded-lg text-xs font-semibold uppercase tracking-wider">{timeline.length} Entries</Badge>
                            </CardHeader>
                            <CardContent className="p-6 flex-1 overflow-auto custom-scrollbar space-y-4">
                                {isLoading ? (
                                    Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
                                ) : timeline.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 text-center">
                                        <div className={cn(
                                            "w-16 h-16 mb-4 rounded-xl border flex items-center justify-center",
                                            candidates.length > 0 ? "border-rose-500/20 bg-rose-500/10" : "border-border bg-muted/40"
                                        )}>
                                            {candidates.length > 0 ? (
                                                <ShieldAlert className="w-8 h-8 text-rose-500" />
                                            ) : (
                                                <FlaskConical className="w-8 h-8 text-muted-foreground/50" />
                                            )}
                                        </div>
                                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            {candidates.length > 0 ? "Candidate Detected" : "Research Silent"}
                                        </p>
                                        <p className="mt-2 max-w-sm text-xs text-muted-foreground/75 leading-relaxed">
                                            {blockedCandidates.length > 0
                                                ? "Autoresearch is waiting for mission-run-linked telemetry before it can launch a shadow experiment."
                                                : candidates.length > 0
                                                    ? "Ready candidates are available for the next sync."
                                                    : "No shadow experiments or trigger events exist for this org yet."}
                                        </p>
                                    </div>
                                ) : (
                                    <AnimatePresence>
                                        {timeline.map((entry, i) => {
                                            const cfg = TYPE_CONFIG[entry.type] || TYPE_CONFIG.experiment;
                                            const Icon = cfg.icon;
                                            return (
                                                <motion.div
                                                    key={i}
                                                    initial={{ opacity: 0, x: -20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: i * 0.02 }}
                                                    className={cn(
                                                        "group relative p-6 rounded-xl border transition-all hover:bg-muted/10 overflow-hidden",
                                                        cfg.border.replace('border-', 'border-border/60 border-').replace('/20', '/10'),
                                                        cfg.bg.replace('/10', '/5')
                                                    )}
                                                >
                                                    <div className="relative z-10 flex flex-col md:flex-row gap-6">
                                                        <div className="flex flex-col gap-3 min-w-[120px]">
                                                            <div className="flex items-center gap-2">
                                                                <div className={cn("p-1.5 rounded-lg bg-background border border-border")}>
                                                                    <Icon size={14} className={cfg.color} />
                                                                </div>
                                                                <span className={cn("text-[10px] font-bold uppercase tracking-wider", cfg.color)}>{cfg.label}</span>
                                                            </div>
                                                            <div className="space-y-0.5">
                                                                <p className="text-xs font-bold text-foreground">{format(new Date(entry.timestamp), 'HH:mm:ss')}</p>
                                                                <p className="text-[10px] font-medium text-muted-foreground">{format(new Date(entry.timestamp), 'MMM d, yyyy')}</p>
                                                            </div>
                                                        </div>

                                                        <div className="flex-1 space-y-3">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <Badge variant="outline" className="h-6 px-2 rounded-lg border-border text-[9px] font-semibold uppercase">{entry.phase}</Badge>
                                                                {entry.score !== undefined && (
                                                                    <Badge variant="outline" className={cn(
                                                                        "h-6 px-2 rounded-lg border-none text-[9px] font-bold shadow-sm",
                                                                        entry.isImproved ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                                                                    )}>
                                                                        SCORE: {entry.score}/100 {entry.isImproved ? "▲" : "▼"}
                                                                    </Badge>
                                                                )}
                                                                <Badge variant="secondary" className="h-6 px-2 rounded-lg text-[9px] font-semibold uppercase tracking-wider">{entry.status}</Badge>
                                                                {entry.missionRun && (
                                                                    <Badge variant="outline" className="h-6 px-2 rounded-lg border-border text-[9px] font-medium truncate max-w-[200px]">{entry.missionRun}</Badge>
                                                                )}
                                                            </div>
                                                            
                                                            <div className="space-y-1">
                                                                <h3 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">{entry.title}</h3>
                                                                <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">{entry.detail}</p>
                                                            </div>

                                                            <div className="flex flex-wrap gap-4 items-center pt-2">
                                                                {entry.modelId && (
                                                                    <div className="flex flex-col">
                                                                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Model ID</span>
                                                                        <span className="text-xs font-mono text-muted-foreground">{entry.modelId}</span>
                                                                    </div>
                                                                )}
                                                                {entry.skillId && (
                                                                    <div className="flex flex-col">
                                                                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Skill ID</span>
                                                                        <span className="text-xs font-mono text-muted-foreground">{entry.skillId}</span>
                                                                    </div>
                                                                )}
                                                                {entry.cost && (
                                                                    <div className="flex flex-col">
                                                                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Unit Cost</span>
                                                                        <span className="text-xs font-mono text-rose-600 dark:text-rose-400">${parseFloat(entry.cost).toFixed(6)}</span>
                                                                    </div>
                                                                )}
                                                                {entry.shadowId && entry.status !== "promoted" && (
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        className="h-7 px-3 rounded-lg text-[10px] font-semibold tracking-wider border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            promoteShadow(entry);
                                                                        }}
                                                                        disabled={promoteShadowMutation.isPending}
                                                                    >
                                                                        {promoteShadowMutation.isPending ? (
                                                                            <RefreshCcw className="mr-1.5 w-3 h-3 animate-spin" />
                                                                        ) : (
                                                                            <Check className="mr-1.5 w-3 h-3" />
                                                                        )}
                                                                        {promoteShadowMutation.isPending ? "Promoting..." : "Promote"}
                                                                    </Button>
                                                                )}
                                                                {entry.parentRunId && (
                                                                    <Link href={missionRunHref(entry.parentMissionId, entry.parentRunId) ?? `/mission-runs/${entry.parentRunId}`}>
                                                                        <Button variant="outline" size="sm" className="h-7 px-3 rounded-lg text-[10px] font-semibold tracking-wider transition-all">
                                                                            Inspect Origin
                                                                            <ArrowUpRight className="ml-1.5 w-3 h-3" />
                                                                        </Button>
                                                                    </Link>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>
        </div>
    );
}
