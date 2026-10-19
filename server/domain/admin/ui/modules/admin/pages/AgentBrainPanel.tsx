/**
 * AgentBrainPanel
 *
 * Admin view into the InterventionAgent's learned state:
 *   • Memory — recent intervention outcomes used as few-shot examples
 *   • Policies — agent-written firing rules, toggleable
 *   • Suggestions — pending threshold/rule changes awaiting human approval
 *   • Test Fire — fire a synthetic intervention to preview the UI
 */
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader } from "@domain-ui/core/ui/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import styles from "./AgentBrainPanel.module.css";
import {
    Brain, CheckCircle2, XCircle, Clock, Flame, Zap,
    Target, AlertTriangle, Activity, Lightbulb,
    BarChart3, RefreshCw, ThumbsUp, ThumbsDown, PlayCircle,
    Info, Loader2,
} from "lucide-react";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface MemoryRow {
    id: number;
    interventionId: string;
    thresholdId?: number;
    thresholdName?: string;
    vector: string;
    location?: string;
    agentDecision: string;
    agentConfidence?: number;
    outcome?: string;
    timeToActionMs?: number;
    createdAt: string;
}

interface PolicyRow {
    id: number;
    rule: string;
    vectors?: string[];
    weight: number;
    distillationRound: number;
    enabled: boolean;
    createdAt: string;
}

interface SuggestionRow {
    id: number;
    suggestionType: string;
    rationale: string;
    proposedChange: Record<string, any>;
    targetTable?: string;
    distillationRound: number;
    status: string;
    createdAt: string;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const VECTOR_COLORS: Record<string, string> = {
    S: "text-red-500",
    C: "text-amber-500",
    O: "text-blue-500",
    R: "text-purple-500",
    E: "text-emerald-500",
};

const OUTCOME_ICON: Record<string, React.ReactNode> = {
    accepted:  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
    dismissed: <XCircle      className="h-3.5 w-3.5 text-red-400"     />,
    expired:   <Clock        className="h-3.5 w-3.5 text-amber-400"   />,
    ignored:   <Activity     className="h-3.5 w-3.5 text-muted-foreground" />,
};

const TYPE_LABEL: Record<string, string> = {
    threshold_adjust: "Adjust threshold",
    rule_disable:     "Disable rule",
    cooldown_extend:  "Extend cooldown",
    new_policy:       "New policy",
};

function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000)      return `${Math.round(diff / 1_000)}s ago`;
    if (diff < 3_600_000)   return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000)  return `${Math.round(diff / 3_600_000)}h ago`;
    return `${Math.round(diff / 86_400_000)}d ago`;
}

// ────────────────────────────────────────────────────────────
// Stats bar
// ────────────────────────────────────────────────────────────

function StatsBar({ memory }: { memory: MemoryRow[] }) {
    const fired      = memory.filter(m => m.agentDecision === 'fire').length;
    const suppressed = memory.filter(m => m.agentDecision === 'suppress').length;
    const accepted   = memory.filter(m => m.outcome === 'accepted').length;
    const acceptRate = fired > 0 ? Math.round((accepted / fired) * 100) : 0;

    const stats = [
        { icon: Flame,        label: "Fired",       value: fired,          color: "text-primary",   glow: "shadow-primary/20",   bg: "bg-primary/5" },
        { icon: Zap,          label: "Suppressed",  value: suppressed,     color: "text-foreground/40",  glow: "shadow-foreground/5",      bg: "bg-foreground/5" },
        { icon: CheckCircle2, label: "Accepted",    value: accepted,       color: "text-emerald-400", glow: "shadow-emerald-500/20", bg: "bg-emerald-500/5" },
        { icon: Target,       label: "Accept Rate", value: `${acceptRate}%`, color: "text-blue-400",    glow: "shadow-blue-500/20",    bg: "bg-blue-500/5" },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {stats.map((s, idx) => (
                <motion.div
                    key={s.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                >
                    <Card className="glass-panel border-foreground/10 p-6 rounded-[2rem] relative overflow-hidden group shadow-xl transition-all hover:bg-foreground/[0.04]">
                        <div className={cn("absolute inset-0 opacity-10 blur-2xl -z-10", s.bg)} />
                        <div className="flex items-center gap-5">
                            <div className={cn("p-4 rounded-2xl border border-foreground/5 shadow-2xl", s.bg, s.glow)}>
                                <s.icon className={cn("h-6 w-6", s.color)} />
                            </div>
                            <div className="space-y-1">
                                <p className="text-[10px] uppercase font-black tracking-[0.3em] text-foreground/20 italic">{s.label}</p>
                                <p className={cn("text-3xl font-black italic tracking-tighter leading-none", s.color)}>{s.value}</p>
                            </div>
                        </div>
                    </Card>
                </motion.div>
            ))}
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// Memory panel
// ────────────────────────────────────────────────────────────

function MemoryPanel() {
    const { data: rows = [], isLoading } = useQuery<MemoryRow[]>({
        queryKey: ["/api/scoring/agent/memory"],
        refetchInterval: 15_000,
    });

    if (isLoading) return (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20">Accessing Neural Cache</p>
        </div>
    );

    if (!rows.length) return (
        <div className="py-24 flex flex-col items-center justify-center space-y-6 rounded-[2.5rem] border border-dashed border-foreground/10 bg-foreground/[0.02]">
            <Brain className="h-12 w-12 text-foreground/10" />
            <div className="text-center space-y-1">
                <p className="text-sm font-black italic uppercase tracking-tighter text-foreground/30">Neural Buffer Empty</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/10">Trigger threshold events to populate memory bank.</p>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30 italic">
                    Live Decision Stream // Last_{rows.length}_Outcomes
                </p>
            </div>
            <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] overflow-hidden shadow-2xl relative">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-foreground/[0.02]">
                            <tr className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40 italic">
                                <th className="py-6 px-6 text-left">Vector</th>
                                <th className="py-6 px-6 text-left">Cognitive Target</th>
                                <th className="py-6 px-4 text-left">Geospatial</th>
                                <th className="py-6 px-4 text-left">Decision</th>
                                <th className="py-6 px-4 text-left">Confidence</th>
                                <th className="py-6 px-4 text-left">Outcome</th>
                                <th className="py-6 px-4 text-left">Latency</th>
                                <th className="py-6 px-6 text-right">Timestamp</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 relative z-0">
                            <AnimatePresence mode="popLayout">
                                {rows.map((r, idx) => (
                                    <motion.tr 
                                        key={r.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 10 }}
                                        transition={{ delay: idx * 0.03 }}
                                        className="hover:bg-foreground/[0.02] transition-colors group"
                                    >
                                        <td className="py-5 px-6">
                                            <span className={cn(
                                                "font-black text-lg italic tracking-tighter drop-shadow-[0_0_10px_rgba(var(--primary),0.3)]",
                                                VECTOR_COLORS[r.vector] || "text-foreground"
                                            )}>
                                                {r.vector}
                                            </span>
                                        </td>
                                        <td className="py-5 px-6">
                                            <div className="flex flex-col">
                                                <span className="text-[11px] font-black uppercase tracking-tight text-foreground group-hover:text-primary transition-colors italic truncate max-w-[160px]">
                                                    {r.thresholdName ?? 'Neural_Fragment'}
                                                </span>
                                                <span className="text-[9px] text-foreground/20 font-mono tracking-tighter uppercase whitespace-nowrap">
                                                    ID_{r.interventionId.slice(0, 12)}...
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-5 px-4 text-foreground/40 text-[10px] font-black uppercase tracking-widest italic truncate max-w-[120px]">
                                            {r.location || "Undisclosed"}
                                        </td>
                                        <td className="py-5 px-4">
                                            <Badge
                                                variant={r.agentDecision === 'fire' ? 'default' : 'secondary'}
                                                className={cn(
                                                    "text-[8px] font-black uppercase tracking-[0.2em] px-2 h-5 rounded-md",
                                                    r.agentDecision === 'fire' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-foreground/10 text-foreground/60"
                                                )}
                                            >
                                                {r.agentDecision ?? "—"}
                                            </Badge>
                                        </td>
                                        <td className="py-5 px-4">
                                            <div className="flex flex-col">
                                                <span className="text-xs font-black text-foreground tabular-nums leading-none">
                                                    {r.agentConfidence != null ? `${Math.round(r.agentConfidence * 100)}%` : "—"}
                                                </span>
                                                <div className="h-0.5 w-12 bg-foreground/5 mt-1.5 rounded-full overflow-hidden">
                                                    <motion.div
                                                        className={cn("h-full bg-primary shadow-[0_0_5px_rgba(var(--primary),0.5)]", styles.confidenceBar)}
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${(r.agentConfidence ?? 0) * 100}%` }}
                                                        transition={{ duration: 0.8, ease: "easeOut" }}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-5 px-4">
                                            {r.outcome ? (
                                                <div className="flex items-center gap-2">
                                                    {OUTCOME_ICON[r.outcome] ?? null}
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-foreground/80 italic">{r.outcome}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 opacity-30">
                                                    <Clock className="h-3 w-3" />
                                                    <span className="text-[10px] font-black uppercase tracking-widest italic">Awaiting</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-5 px-4 text-[10px] font-black text-foreground/30 tabular-nums italic">
                                            {r.timeToActionMs != null ? `${(r.timeToActionMs / 1000).toFixed(2)}s` : "—"}
                                        </td>
                                        <td className="py-5 px-6 text-[10px] font-black uppercase tracking-widest text-foreground/20 whitespace-nowrap text-right italic">
                                            {timeAgo(r.createdAt)}
                                        </td>
                                    </motion.tr>
                                ))}
                            </AnimatePresence>
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// Policies panel
// ────────────────────────────────────────────────────────────

function PoliciesPanel() {
    const qc = useQueryClient();
    const { toast } = useToast();

    const { data: rows = [], isLoading } = useQuery<PolicyRow[]>({
        queryKey: ["/api/scoring/agent/policies"],
    });

    const toggleMutation = useMutation({
        mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
            apiRequest("PATCH", `/api/scoring/agent/policies/${id}/toggle`, { enabled }).then(r => r.json()),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/scoring/agent/policies"] }),
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });

    const distillMutation = useMutation({
        mutationFn: () => apiRequest("POST", "/api/scoring/agent/distill", {}).then(r => r.json()),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/scoring/agent/policies"] });
            qc.invalidateQueries({ queryKey: ["/api/scoring/agent/suggestions"] });
            toast({ title: "Distillation triggered", description: "New policies may appear shortly." });
        },
        onError: () => toast({ title: "Distillation failed", variant: "destructive" }),
    });

    if (isLoading) return (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20">Refining Core Logic</p>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between px-2">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30 italic">
                    Firing Protocols // {rows.length}_Active Enforcements
                </p>
                <Button
                    variant="outline"
                    className="h-10 px-6 rounded-2xl glass-panel border-foreground/10 bg-foreground/[0.02] text-[9px] font-black uppercase tracking-[0.2em] hover:bg-foreground/10 transition-all text-foreground group"
                    onClick={() => distillMutation.mutate()}
                    disabled={distillMutation.isPending}
                >
                    <RefreshCw className={cn("h-3.5 w-3.5 mr-3 text-primary", distillMutation.isPending && "animate-spin")} />
                    Distill New Policies
                </Button>
            </div>

            {!rows.length ? (
                <div className="py-24 flex flex-col items-center justify-center space-y-6 rounded-[2.5rem] border border-dashed border-foreground/10 bg-foreground/[0.02]">
                    <Lightbulb className="h-12 w-12 text-foreground/10" />
                    <div className="text-center space-y-1">
                        <p className="text-sm font-black italic uppercase tracking-tighter text-foreground/30">Zero Policies Synthesized</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/10">Run distillation after collecting primary outcomes.</p>
                    </div>
                </div>
            ) : (
                <div className="grid gap-4">
                    <AnimatePresence mode="popLayout">
                        {rows.map((p, idx) => (
                            <motion.div
                                key={p.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                className={cn(
                                    "flex items-start justify-between gap-6 rounded-[1.8rem] glass-panel border px-8 py-6 transition-all group relative overflow-hidden",
                                    p.enabled ? "border-foreground/10 bg-foreground/[0.02]" : "border-foreground/5 bg-background/40 opacity-40 hover:opacity-100"
                                )}
                            >
                                <div className="absolute top-0 left-0 w-1 h-full bg-primary/0 group-hover:bg-primary transition-colors" />
                                <div className="flex-1 space-y-3">
                                    <p className="text-sm font-black italic uppercase tracking-tight text-foreground leading-snug group-hover:text-primary transition-colors">{p.rule}</p>
                                    <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-[0.2em] text-foreground/20 italic">
                                        <div className="flex items-center gap-1.5 bg-foreground/5 px-2 py-0.5 rounded-md">
                                            <span className="text-primary truncate">RND_{p.distillationRound}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span>WEIGHT:</span>
                                            <span className="text-foreground/60 tabular-nums">{p.weight.toFixed(2)}</span>
                                        </div>
                                        {p.vectors?.length ? (
                                            <div className="flex gap-2">
                                                {p.vectors.map(v => (
                                                    <span key={v} className={cn("px-1.5 py-0.5 rounded-md border border-foreground/5", VECTOR_COLORS[v])}>{v}</span>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="pt-1">
                                    <Switch
                                        checked={p.enabled}
                                        className="data-[state=checked]:bg-primary"
                                        onCheckedChange={enabled => toggleMutation.mutate({ id: p.id, enabled })}
                                    />
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// Suggestion card
// ────────────────────────────────────────────────────────────

function SuggestionCard({
    s,
    isReviewed,
    onReview,
    isPending: reviewPending,
}: {
    s: SuggestionRow;
    isReviewed?: boolean;
    onReview: (id: number, status: string) => void;
    isPending: boolean;
}) {
    return (
        <Card className={cn(
            "rounded-[2rem] glass-panel border overflow-hidden relative transition-all group",
            isReviewed ? "border-foreground/5 bg-background/40 opacity-50" : "border-foreground/10 bg-foreground/[0.02]"
        )}>
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent opacity-20" />
            <CardHeader className="pb-4 pt-8 px-8">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-[9px] font-black uppercase tracking-[0.2em] h-6 px-3 border-amber-500/20 text-amber-500 rounded-lg">
                            {TYPE_LABEL[s.suggestionType] ?? s.suggestionType}
                        </Badge>
                        <Badge
                            variant="outline"
                            className={cn(
                                "text-[9px] font-black uppercase tracking-[0.2em] h-6 px-3 rounded-lg border-foreground/10",
                                s.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : s.status === 'rejected' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                : 'bg-foreground/5 text-foreground/40'
                            )}
                        >
                            {s.status}
                        </Badge>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Session Rnd_{s.distillationRound} // {timeAgo(s.createdAt)}</span>
                </div>
            </CardHeader>
            <CardContent className="px-8 pb-8 space-y-6">
                <p className="text-sm font-black italic uppercase tracking-tight text-foreground/80 leading-relaxed group-hover:text-foreground transition-colors">
                    {s.rationale}
                </p>

                {Object.keys(s.proposedChange).length > 0 && (
                    <div className="relative">
                        <div className="absolute top-2 right-4 text-[8px] font-black uppercase tracking-widest text-primary italic opacity-40">Proposed Delta</div>
                        <pre className="text-[11px] font-mono bg-background/60 border border-foreground/5 rounded-2xl p-6 overflow-x-auto leading-relaxed shadow-inner">
                            {JSON.stringify(s.proposedChange, null, 2)}
                        </pre>
                    </div>
                )}

                {!isReviewed && (
                    <div className="space-y-6 pt-2">
                        <div className="flex items-start gap-4 p-5 rounded-2xl bg-amber-500/5 border border-amber-500/20">
                            <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500/80 leading-relaxed italic">
                                Approving archives the rationale. Neural weights must be manually verified within the primary enforcer array.
                            </p>
                        </div>
                        <div className="flex gap-4">
                            <Button
                                className="flex-1 h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-foreground text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-emerald-500/10 transition-all active:scale-95"
                                onClick={() => onReview(s.id, 'approved')}
                                disabled={reviewPending}
                            >
                                <ThumbsUp className="h-4 w-4 mr-3" /> Approve Protocol
                            </Button>
                            <Button
                                variant="outline"
                                className="flex-1 h-12 rounded-2xl border-red-500/20 bg-red-500/5 text-red-500 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-red-500/10 transition-all active:scale-95"
                                onClick={() => onReview(s.id, 'rejected')}
                                disabled={reviewPending}
                            >
                                <ThumbsDown className="h-4 w-4 mr-3" /> Reject Proposal
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}


// ────────────────────────────────────────────────────────────
// Suggestions panel
// ────────────────────────────────────────────────────────────

function SuggestionsPanel() {
    const qc = useQueryClient();
    const { toast } = useToast();

    const { data: rows = [], isLoading } = useQuery<SuggestionRow[]>({
        queryKey: ["/api/scoring/agent/suggestions"],
    });

    const reviewMutation = useMutation({
        mutationFn: ({ id, status }: { id: number; status: string }) =>
            apiRequest("PATCH", `/api/scoring/agent/suggestions/${id}`, { status }).then(r => r.json()),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["/api/scoring/agent/suggestions"] });
            toast({ title: vars.status === 'approved' ? "Marked as approved" : "Marked as rejected" });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });

    if (isLoading) return (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/20">Synthesizing Feedback</p>
        </div>
    );

    const pending  = rows.filter(r => r.status === 'pending');
    const reviewed = rows.filter(r => r.status !== 'pending');

    return (
        <div className="space-y-10">
            <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
            >
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] mb-6 flex items-center gap-3 italic">
                    <span className="p-1 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)] animate-pulse" />
                    Pending Cognitive Review ({pending.length})
                </h4>
                {pending.length ? (
                    <div className="grid gap-6">
                        {pending.map((s, idx) => (
                            <motion.div
                                key={s.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.1 }}
                            >
                                <SuggestionCard
                                    s={s}
                                    onReview={(id, status) => reviewMutation.mutate({ id, status })}
                                    isPending={reviewMutation.isPending}
                                />
                            </motion.div>
                        ))}
                    </div>
                ) : (
                    <div className="py-24 flex flex-col items-center justify-center space-y-6 rounded-[2.5rem] border border-dashed border-foreground/10 bg-foreground/[0.02]">
                        <Activity className="h-12 w-12 text-foreground/10" />
                        <div className="text-center space-y-1">
                            <p className="text-sm font-black italic uppercase tracking-tighter text-foreground/30">Suggestions Queue Clear</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/10">The agent brain is currently optimized.</p>
                        </div>
                    </div>
                )}
            </motion.div>

            {reviewed.length > 0 && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                >
                    <h4 className="text-[10px] font-black uppercase tracking-[0.4em] mb-6 flex items-center gap-3 text-foreground/20 italic">
                        <span className="p-1 rounded-full bg-foreground/10" />
                        Historical Archive ({reviewed.length})
                    </h4>
                    <div className="grid gap-6">
                        {reviewed.map(s => (
                            <SuggestionCard
                                key={s.id}
                                s={s}
                                isReviewed
                                onReview={(id, status) => reviewMutation.mutate({ id, status })}
                                isPending={reviewMutation.isPending}
                            />
                        ))}
                    </div>
                </motion.div>
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// Test fire panel
// ────────────────────────────────────────────────────────────

const VECTORS_LIST = ['S', 'C', 'O', 'R', 'E'];
const PRIORITY_LIST = ['low', 'medium', 'high', 'critical'] as const;

function TestFirePanel() {
    const { toast } = useToast();
    const [vector, setVector]     = useState('C');
    const [priority, setPriority] = useState<string>('medium');

    const fireMutation = useMutation({
        mutationFn: () =>
            apiRequest("POST", "/api/scoring/agent/test-fire", { vector, priority }).then(r => r.json()),
        onSuccess: () => toast({
            title: "Synthetic Incident Emitted",
            description: "Check operational HUD — test intervention successfully injected.",
        }),
        onError: () => toast({ title: "Injection Error", variant: "destructive" }),
    });

    return (
        <Card className="glass-panel-deep border-foreground/10 rounded-[2.5rem] p-10 max-w-2xl relative overflow-hidden shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent pointer-events-none" />
            <div className="space-y-8 relative z-10">
                <div className="space-y-2">
                    <h4 className="text-2xl font-black italic uppercase tracking-tighter text-foreground">Manual Intervention Injector</h4>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-relaxed max-w-md">
                        Emulate a synthetic <code>intervention.triggered</code> event.
                        Bypasses neural enforcers for immediate UI/UX verification.
                    </p>
                </div>

                <div className="flex flex-wrap gap-8 items-end">
                    <div className="space-y-3">
                        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/40 italic pl-1">Vector Matrix</label>
                        <Select value={vector} onValueChange={setVector}>
                            <SelectTrigger className="w-32 h-14 rounded-2xl bg-foreground/[0.03] border-foreground/10 font-mono text-lg font-black italic group focus-visible:ring-primary shadow-inner">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="glass-panel border-foreground/10 bg-background/90 rounded-2xl">
                                {VECTORS_LIST.map(v => (
                                    <SelectItem key={v} value={v} className="text-sm font-black italic uppercase h-10 focus:bg-primary/20 transition-colors">{v}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-3">
                        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/40 italic pl-1">Criticality Lvl</label>
                        <Select value={priority} onValueChange={setPriority}>
                            <SelectTrigger className="w-44 h-14 rounded-2xl bg-foreground/[0.03] border-foreground/10 font-black italic uppercase tracking-tight group focus-visible:ring-primary shadow-inner">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="glass-panel border-foreground/10 bg-background/90 rounded-2xl">
                                {PRIORITY_LIST.map(p => (
                                    <SelectItem key={p} value={p} className="text-[10px] font-black uppercase italic tracking-tighter h-10 focus:bg-primary/20 transition-colors">{p}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <Button
                        className="h-14 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-[0.3em] shadow-xl shadow-primary/20 transition-all active:scale-95 gap-3"
                        onClick={() => fireMutation.mutate()}
                        disabled={fireMutation.isPending}
                    >
                        {fireMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-5 w-5" />}
                        {fireMutation.isPending ? "Injecting..." : "Execute_Fire"}
                    </Button>
                </div>

                <div className="flex items-start gap-4 p-5 rounded-[1.5rem] bg-foreground/[0.02] border border-foreground/5 text-[9px] font-bold uppercase tracking-widest text-foreground/20 italic">
                    <Info className="h-4 w-4 shrink-0 text-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                    <span>Protocols: SYNTHETIC EMISSION // BYPASS ENFORCER: TRUE // LOG MEMORY: FALSE</span>
                </div>
            </div>
        </Card>
    );
}

// ────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────

export function AgentBrainPanel() {
    const { data: memory = [] } = useQuery<MemoryRow[]>({
        queryKey: ["/api/scoring/agent/memory"],
        refetchInterval: 15_000,
    });

    return (
        <div className="min-h-screen bg-background text-foreground relative overflow-hidden font-sans selection:bg-primary/30">
            {/* Neural Background Sweep */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 cinematic-grid opacity-10" />
                <div className="absolute top-[20%] right-[10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full animate-pulse" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#020202]/50 to-[#020202]" />
            </div>

            <main className="container mx-auto py-12 px-6 space-y-12 max-w-7xl relative z-10">
                <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3"
                >
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 shadow-2xl shadow-primary/10 group overflow-hidden relative">
                            <div className="absolute inset-0 bg-primary/20 animate-pulse" />
                            <Brain className="h-7 w-7 text-primary shadow-[0_0_15px_rgba(var(--primary),0.5)] relative z-10" />
                        </div>
                        <div>
                            <h2 className="text-4xl font-black italic tracking-tighter uppercase text-foreground leading-none">
                                Agent Brain
                            </h2>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em] mt-2 flex items-center gap-2 italic">
                                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                Neural Architecture // Operational Cognition v4.0
                            </p>
                        </div>
                    </div>
                </motion.div>

                <StatsBar memory={memory} />

                <Tabs defaultValue="memory" className="space-y-8">
                    <TabsList className="bg-foreground/[0.03] border border-foreground/10 p-1.5 rounded-2xl h-14 w-fit glass-panel">
                        {[
                            { value: 'memory',   icon: BarChart3,     label: 'Cognitive Cache' },
                            { value: 'policies', icon: Lightbulb,    label: 'Protocols' },
                            { value: 'suggestions', icon: AlertTriangle, label: 'Optimization' },
                            { value: 'test',     icon: PlayCircle,   label: 'Synthetic Fire' },
                        ].map(tab => (
                            <TabsTrigger 
                                key={tab.value}
                                value={tab.value} 
                                className="h-11 rounded-xl px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-[10px] font-black uppercase tracking-widest gap-3 transition-all italic"
                            >
                                <tab.icon className="h-3.5 w-3.5" /> 
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <div className="relative">
                        <TabsContent value="memory"      className="mt-0 outline-none"><MemoryPanel      /></TabsContent>
                        <TabsContent value="policies"    className="mt-0 outline-none"><PoliciesPanel    /></TabsContent>
                        <TabsContent value="suggestions" className="mt-0 outline-none"><SuggestionsPanel /></TabsContent>
                        <TabsContent value="test"        className="mt-0 outline-none"><TestFirePanel    /></TabsContent>
                    </div>
                </Tabs>
            </main>
        </div>
    );
}
