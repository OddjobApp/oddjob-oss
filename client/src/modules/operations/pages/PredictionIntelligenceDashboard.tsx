import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { latLngToCell, cellToLatLng, gridDisk } from "h3-js";
import { RescueMap, HexCell, MapMarker } from "@domain-ui/rescue/ui/modules/rescue/components/RescueMap";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Loader2, Brain, Activity, ShieldCheck, AlertTriangle, Zap, RefreshCcw, Database,
    GitBranch, Target, CheckCircle2, MessageSquareReply, Sparkles, Radio,
    Camera, GitCompare, FileText, ExternalLink, Download, Printer, Copy, Check, Send,
    TrendingUp, TrendingDown, ArrowRight, Clock, Building2, MapPin, DollarSign, Home,
    Image as ImageIcon, Eye, BarChart3, Percent, Calendar, ChevronDown, SlidersHorizontal
} from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useSignalFilters, matchesSignalFilter } from "@/modules/signal-studio/signal-filters-store";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PredictionResult {
    contextId: string;
    hiddenState?: { topLabel?: string | null; entropy?: number; candidates?: any[] };
    prediction?: { topPredicate?: string | null; confidence?: number; entropy?: number } | null;
    branches?: Array<{ id: string; predicate: string; probability: number; confidence: number }>;
}

interface GovernanceDecision {
    allowed: boolean;
    maxActionLevel: string;
    riskClass: string;
    requiresHumanConfirmation: boolean;
    reason: string;
}

interface ActiveCycleItem {
    id: number;
    name: string;
    status: string;
    priority: number;
    objective: string;
    budgetLimitUsd: string;
    currentSpendUsd: string;
    metrics: {
        successRate: number;
        riskScore: number;
        alignmentScore: number;
    };
    latestPrediction: {
        id: string;
        topPredicate?: string | null;
        confidence: number;
        entropy: number;
        createdAt: string;
    } | null;
    pendingQuestion: {
        id: number;
        questionText: string;
        proposedAnswer?: string | null;
        createdAt: string;
    } | null;
}

interface OperationalSummary {
    organizationId: number;
    generatedAt: string;
    counts: {
        cycles: number;
        activeCycles: number;
        missionRuns: number;
        failedRuns: number;
        predictions: number;
        branches: number;
        contracts: number;
        contexts: number;
        canonicalEvents: number;
        eventQuants: number;
    };
    valueSignals: {
        failureRate: number;
        predictionCoverage: number;
        hasGovernedPredictionContracts: boolean;
        hasMissionEventBridgeData: boolean;
    };
    gaps: string[];
    recommendedActions: string[];
    recentPredictions: Array<{
        id: string;
        topPredicate?: string | null;
        confidence: number;
        entropy: number;
        createdAt: string;
    }>;
    activeCyclesList?: ActiveCycleItem[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricChip({ label, value, color = "text-foreground" }: { label: string; value: string | number; color?: string }) {
    return (
        <div className="bg-background/30 rounded-lg p-3 border border-foreground/5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
        </div>
    );
}

function formatPercent(value: number) {
    return `${Math.round(value * 100)}%`;
}

function ProgressRing({ value, color, radius = 40, stroke = 4 }: { value: number; color: string; radius?: number; stroke?: number }) {
    const normalizedRadius = radius - stroke * 2;
    const circumference = normalizedRadius * 2 * Math.PI;
    const strokeDashoffset = circumference - (value / 100) * circumference;

    return (
        <div className="relative flex items-center justify-center" style={{ width: radius * 2, height: radius * 2 }}>
            <svg
                height={radius * 2}
                width={radius * 2}
                className="-rotate-90"
            >
                <circle
                    stroke="#333"
                    fill="transparent"
                    strokeWidth={stroke}
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                />
                <circle
                    stroke={color}
                    fill="transparent"
                    strokeWidth={stroke}
                    strokeDasharray={circumference + ' ' + circumference}
                    style={{ strokeDashoffset }}
                    strokeLinecap="round"
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                />
            </svg>
            <span className="absolute text-xl font-bold" style={{ color }}>{`${Math.round(value)}%`}</span>
        </div>
    );
}

export function OperationalSummaryPanel() {
    const { data, isLoading, refetch, isFetching } = useQuery<OperationalSummary>({
        queryKey: ["/api/prediction/operational-summary"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/prediction/operational-summary");
            return res.json();
        },
        refetchInterval: 30_000,
    });

    const [refreshingCycles, setRefreshingCycles] = useState<Record<number, boolean>>({});
    const [refreshingAll, setRefreshingAll] = useState(false);

    // Escalation-question resolution dialog state.
    const [answering, setAnswering] = useState<ActiveCycleItem | null>(null);
    const [answerText, setAnswerText] = useState("");
    const [resolvingAction, setResolvingAction] = useState<null | "approve" | "edit" | "ignore">(null);

    const openAnswer = (cycle: ActiveCycleItem) => {
        setAnswering(cycle);
        setAnswerText(cycle.pendingQuestion?.proposedAnswer || "");
    };

    const resolveQuestion = async (action: "approve" | "edit" | "ignore") => {
        const q = answering?.pendingQuestion;
        if (!q) return;
        setResolvingAction(action);
        try {
            await apiRequest("POST", `/api/prediction/questions/${q.id}/resolve`, {
                action,
                answerText: action === "edit" ? answerText : undefined,
            });
            const cycleId = answering!.id;
            setAnswering(null);
            setAnswerText("");
            await refetch();
            // Approving/editing fills the knowledge gap — re-forecast so confidence updates.
            if (action !== "ignore") handleRefresh(cycleId);
        } catch (e: any) {
            console.error("Failed to resolve escalation question", e);
        } finally {
            setResolvingAction(null);
        }
    };

    const handleRefresh = async (cycleId?: number) => {
        if (cycleId !== undefined) {
            setRefreshingCycles(prev => ({ ...prev, [cycleId]: true }));
        } else {
            setRefreshingAll(true);
        }
        try {
            await apiRequest("POST", "/api/prediction/forecast-cycles", { cycleId });
            refetch();
        } catch (e: any) {
            console.error("Failed to refresh cycle forecasts", e);
        } finally {
            if (cycleId !== undefined) {
                setRefreshingCycles(prev => ({ ...prev, [cycleId]: false }));
            } else {
                setRefreshingAll(false);
            }
        }
    };

    const coverage = data?.valueSignals.predictionCoverage ?? 0;
    const failureRate = data?.valueSignals.failureRate ?? 0;
    const hasBridge = data?.valueSignals.hasMissionEventBridgeData;
    const hasContracts = data?.valueSignals.hasGovernedPredictionContracts;

    return (
        <Card className="border-primary/15 bg-card/75 shadow-2xl">
            <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-foreground">
                            <Target className="h-5 w-5 text-primary" />
                            Operational Prediction Coverage
                        </CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Backend signals scoped to the active organization and tied to cycles, mission runs, contracts, and event intake.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                        <Button
                            size="sm"
                            className="bg-amber-500 hover:bg-amber-400 text-amber-950 flex items-center gap-1.5 font-bold text-xs"
                            onClick={() => handleRefresh()}
                            disabled={refreshingAll || isFetching}
                        >
                            {refreshingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                            Forecast All Cycles
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching} className="text-primary hover:bg-primary/10" aria-label="Refresh operational prediction coverage">
                            <RefreshCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="h-20 animate-pulse rounded-lg bg-background/25" />
                        ))}
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                            <MetricChip label="Active cycles" value={data?.counts.activeCycles ?? 0} color="text-foreground" />
                            <div className="text-center">
                                <ProgressRing value={failureRate * 100} color={failureRate > 0.4 ? "#F472B6" : "#34D399"} />
                                <p className="text-xs text-muted-foreground uppercase tracking-wider mt-2">Mission Failure Rate</p>
                            </div>
                            <div className="text-center">
                                <ProgressRing value={coverage * 100} color={coverage < 0.5 ? "#FBBF24" : "#34D399"} />
                                <p className="text-xs text-muted-foreground uppercase tracking-wider mt-2">Prediction Coverage</p>
                            </div>
                            <MetricChip label="Contracts" value={data?.counts.contracts ?? 0} color={hasContracts ? "text-emerald-400" : "text-amber-400"} />
                        </div>

                        <div className="grid gap-3 lg:grid-cols-3">
                            <div className="rounded-lg border border-foreground/5 bg-background/25 p-3">
                                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                                    <Database className="h-4 w-4" />
                                    Signal chain
                                </div>
                                <div className="space-y-2 text-xs text-foreground">
                                    <div className="flex items-center justify-between"><span>Persisted predictions</span><span>{data?.counts.predictions ?? 0}</span></div>
                                    <div className="flex items-center justify-between"><span>Branches explored</span><span>{data?.counts.branches ?? 0}</span></div>
                                    <div className="flex items-center justify-between"><span>Canonical events</span><span>{data?.counts.canonicalEvents ?? 0}</span></div>
                                    <div className="flex items-center justify-between"><span>Event quants</span><span>{data?.counts.eventQuants ?? 0}</span></div>
                                </div>
                            </div>

                            <div className="rounded-lg border border-foreground/5 bg-background/25 p-3">
                                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                                    <GitBranch className="h-4 w-4" />
                                    Recommended actions
                                </div>
                                <div className="space-y-2 text-xs text-foreground">
                                    {(data?.recommendedActions.length ? data.recommendedActions : ["Prediction backend is ready for live cycle forecasting."]).slice(0, 4).map(action => (
                                        <div key={action} className="flex items-start gap-2">
                                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                                            <span>{action}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-lg border border-foreground/5 bg-background/25 p-3">
                                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                                    <AlertTriangle className="h-4 w-4" />
                                    Backend gaps
                                </div>
                                <div className="space-y-2 text-xs text-foreground">
                                    {(data?.gaps.length ? data.gaps : ["No critical backend gaps detected in the current signal chain."]).slice(0, 4).map(gap => (
                                        <div key={gap} className="flex items-start gap-2">
                                            <span className={hasBridge ? "text-emerald-400" : "text-amber-400"}>-</span>
                                            <span>{gap}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Active Cycle Risk & Prediction Coverage Table */}
                        <div className="mt-6 rounded-lg border border-foreground/5 bg-background/25 overflow-hidden">
                            <div className="border-b border-foreground/5 bg-background/40 px-4 py-3 flex items-center justify-between">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                                    <Target className="h-4 w-4" />
                                    Active Cycle Forecasts & Risk Analysis
                                </h3>
                                <Badge variant="outline" className="text-muted-foreground border-foreground/10 bg-background/30">
                                    {data?.activeCyclesList?.length ?? 0} cycles
                                </Badge>
                            </div>
                            
                            {!data?.activeCyclesList?.length ? (
                                <EmptyState
                                    icon={Target}
                                    title="No active cycles yet"
                                    description="Prediction coverage and risk forecasts appear once this organization has active cycles. Start work to launch one."
                                    action={
                                        <Button size="sm" className="bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold" onClick={() => { window.location.href = "/operations"; }}>
                                            <Zap className="h-3.5 w-3.5 mr-1.5" /> Start work
                                        </Button>
                                    }
                                />
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="border-b border-foreground/5 bg-background/10 text-muted-foreground">
                                                <th className="p-3 font-semibold">Cycle Name</th>
                                                <th className="p-3 font-semibold">Status</th>
                                                <th className="p-3 font-semibold text-center">Coverage</th>
                                                <th className="p-3 font-semibold">Latest Prediction</th>
                                                <th className="p-3 font-semibold text-center">Risk Score</th>
                                                <th className="p-3 font-semibold text-center">Success Rate</th>
                                                <th className="p-3 font-semibold">Escalation</th>
                                                <th className="p-3 font-semibold text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {data.activeCyclesList.map(cycle => {
                                                const isCovered = cycle.latestPrediction !== null;
                                                const isIndividualLoading = refreshingCycles[cycle.id];
                                                
                                                // Severity styling
                                                const risk = cycle.metrics.riskScore;
                                                const riskColor = risk > 65 ? "text-rose-400 font-bold" : risk > 35 ? "text-amber-400" : "text-emerald-400";
                                                
                                                return (
                                                    <tr key={cycle.id} className="hover:bg-foreground/5 transition-colors">
                                                        <td className="p-3 font-medium text-foreground max-w-[200px] truncate" title={cycle.name}>
                                                            {cycle.name}
                                                        </td>
                                                        <td className="p-3">
                                                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-foreground/5 border border-foreground/10 text-foreground uppercase">
                                                                {cycle.status.replace("_", " ")}
                                                            </span>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <Badge className={isCovered ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"} variant="outline">
                                                                {isCovered ? "Covered" : "Not Covered"}
                                                            </Badge>
                                                        </td>
                                                        <td className="p-3">
                                                            {isCovered ? (
                                                                <div className="space-y-0.5">
                                                                    <div className="font-semibold text-emerald-400 truncate max-w-[220px]" title={cycle.latestPrediction?.topPredicate ?? ""}>
                                                                        {cycle.latestPrediction?.topPredicate}
                                                                    </div>
                                                                    <div className="text-[10px] text-muted-foreground">
                                                                        Conf: {(cycle.latestPrediction!.confidence * 100).toFixed(0)}% | Entropy: {cycle.latestPrediction!.entropy.toFixed(2)}
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <span className="text-muted-foreground italic">No forecast generated</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-center font-semibold">
                                                            <span className={riskColor}>{Math.round(risk)}</span>
                                                        </td>
                                                        <td className="p-3 text-center text-foreground">
                                                            {Math.round(cycle.metrics.successRate)}%
                                                        </td>
                                                        <td className="p-3">
                                                            {cycle.pendingQuestion ? (
                                                                <div className="space-y-1 max-w-[220px]">
                                                                    <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 flex items-center gap-1 w-max text-[10px]" variant="outline">
                                                                        <AlertTriangle className="h-3 w-3 shrink-0" />
                                                                        Question Pending
                                                                    </Badge>
                                                                    <div className="text-[10px] text-muted-foreground line-clamp-2" title={cycle.pendingQuestion.questionText}>
                                                                        {cycle.pendingQuestion.questionText}
                                                                    </div>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        className="h-6 px-2 text-[10px] text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-200"
                                                                        onClick={() => openAnswer(cycle)}
                                                                    >
                                                                        <MessageSquareReply className="h-3 w-3 mr-1" /> Answer
                                                                    </Button>
                                                                </div>
                                                            ) : (
                                                                <span className="text-muted-foreground">—</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="border-primary/30 text-primary hover:bg-primary/10 h-7 text-xs"
                                                                onClick={() => handleRefresh(cycle.id)}
                                                                disabled={isIndividualLoading || refreshingAll}
                                                            >
                                                                {isIndividualLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                                                                <span className="ml-1">Forecast</span>
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </CardContent>

            <Dialog open={!!answering} onOpenChange={(o) => { if (!o) { setAnswering(null); setAnswerText(""); } }}>
                <DialogContent className="max-w-lg bg-card border-foreground/10 text-foreground">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <MessageSquareReply className="h-4 w-4 text-rose-400" />
                            Address escalation question
                        </DialogTitle>
                    </DialogHeader>
                    {answering?.pendingQuestion && (
                        <div className="space-y-4">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cycle</p>
                                <p className="text-sm text-foreground">{answering.name}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Question</p>
                                <p className="mt-1 text-sm leading-relaxed text-foreground">{answering.pendingQuestion.questionText}</p>
                            </div>
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <Sparkles className="h-3 w-3 text-primary" />
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Answer {answering.pendingQuestion.proposedAnswer ? "(proposed by the engine — edit if needed)" : ""}</p>
                                </div>
                                <Textarea
                                    value={answerText}
                                    onChange={(e) => setAnswerText(e.target.value)}
                                    rows={5}
                                    placeholder="Provide the answer that resolves this knowledge gap…"
                                    className="mt-1 bg-background/60 border-foreground/10 text-sm text-foreground"
                                />
                                <p className="mt-1 text-[10px] text-muted-foreground">Approving syncs this answer into the Knowledge Graph and re-forecasts the cycle, raising its prediction confidence.</p>
                            </div>
                        </div>
                    )}
                    <DialogFooter className="gap-2 sm:justify-between">
                        <Button variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={!!resolvingAction} onClick={() => resolveQuestion("ignore")}>
                            {resolvingAction === "ignore" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ignore"}
                        </Button>
                        <Button className="bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold" disabled={!!resolvingAction || !answerText.trim()} onClick={() => resolveQuestion("edit")}>
                            {resolvingAction === "edit" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                            Approve &amp; Sync
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function BranchBar({ predicate, probability, confidence }: { predicate: string; probability: number; confidence: number }) {
    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs text-foreground">
                <span className="truncate max-w-[60%]">{predicate}</span>
                <span className="text-primary shrink-0">
                    {(probability * 100).toFixed(0)}% &nbsp;
                    <span className="text-muted-foreground">[{(confidence * 100).toFixed(0)}% conf]</span>
                </span>
            </div>
            <div className="w-full bg-foreground/5 h-1.5 rounded-full overflow-hidden">
                <div
                    className="bg-primary h-full transition-all duration-500"
                    style={{ width: `${probability * 100}%` }}
                />
            </div>
        </div>
    );
}

// ── Evaluate Panel ─────────────────────────────────────────────────────────────

function EvaluatePanel() {
    const [goal, setGoal] = useState("Summarize quarterly earnings report and identify top risks");
    const [mode, setMode] = useState<"realtime" | "analysis">("realtime");

    const mutation = useMutation<PredictionResult, Error>({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/prediction/evaluate", { goal, mode, context: {} });
            return res.json();
        },
    });

    const data = mutation.data;
    const entropy = data?.hiddenState?.entropy ?? 0;
    const confidence = data?.prediction?.confidence ?? 0;

    return (
        <Card className="border-foreground/10 bg-card/65 backdrop-blur-xl">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                    <Brain className="w-5 h-5 text-primary" />
                    Cycle Decision Evaluator
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        value={goal}
                        onChange={e => setGoal(e.target.value)}
                        placeholder="Describe the goal or context to evaluate..."
                        className="bg-background/40 border-foreground/10 text-foreground placeholder:text-muted-foreground flex-1"
                    />
                    <select
                        value={mode}
                        onChange={e => setMode(e.target.value as any)}
                        className="min-h-[44px] rounded-md border border-foreground/10 bg-background/40 px-3 text-sm text-foreground"
                        aria-label="Prediction mode"
                    >
                        <option value="realtime">Realtime</option>
                        <option value="analysis">Analysis</option>
                    </select>
                    <Button
                        onClick={() => mutation.mutate()}
                        disabled={mutation.isPending || !goal.trim()}
                        className="w-full shrink-0 bg-amber-500 text-amber-950 hover:bg-amber-400 font-bold sm:w-auto"
                        aria-label="Run prediction evaluation"
                    >
                        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    </Button>
                </div>

                {mutation.isError && (
                    <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                        <AlertTriangle className="w-4 h-4" />
                        {mutation.error.message}
                    </div>
                )}

                {data && (
                    <div className="space-y-4 pt-2 border-t border-foreground/5">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <MetricChip
                                label="Top Prediction"
                                value={data.prediction?.topPredicate ?? "—"}
                                color="text-emerald-400"
                            />
                            <MetricChip
                                label="Confidence"
                                value={`${(confidence * 100).toFixed(0)}%`}
                                color={confidence > 0.7 ? "text-emerald-400" : confidence > 0.4 ? "text-yellow-400" : "text-red-400"}
                            />
                            <MetricChip
                                label="Hidden State"
                                value={data.hiddenState?.topLabel ?? "—"}
                                color="text-primary"
                            />
                            <MetricChip
                                label="Entropy"
                                value={entropy.toFixed(3)}
                                color={entropy > 0.5 ? "text-yellow-400" : "text-foreground"}
                            />
                        </div>

                        {entropy > 0.5 && (
                            <div className="flex items-center gap-2 bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20 text-yellow-400 text-sm">
                                <AlertTriangle className="w-4 h-4" />
                                High entropy — outcome is uncertain. Consider providing more context.
                            </div>
                        )}

                        {(data.branches?.length ?? 0) > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Prediction Branches</p>
                                {data.branches!.map(b => (
                                    <BranchBar key={b.id} predicate={b.predicate} probability={b.probability} confidence={b.confidence} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ── Telemetry Feed ─────────────────────────────────────────────────────────────

function TelemetryFeed() {
    const { data, refetch, isFetching } = useQuery<{ events: any[] }>({
        queryKey: ["/api/prediction/telemetry"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/prediction/telemetry?limit=30");
            return res.json();
        },
        refetchInterval: 15_000,
    });

    const severityColor = (s: string) =>
        s === "critical" || s === "error" ? "text-red-400" :
        s === "warning" ? "text-yellow-400" :
        s === "info" ? "text-blue-400" : "text-muted-foreground";

    return (
        <Card className="border-foreground/10 bg-card/65 backdrop-blur-xl">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Activity className="w-5 h-5 text-blue-400" />
                        Telemetry Feed
                    </CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching} className="text-muted-foreground" aria-label="Refresh telemetry feed">
                        <RefreshCcw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {!data?.events?.length ? (
                    <p className="text-muted-foreground text-sm text-center py-6">No telemetry events yet. Run an evaluation above.</p>
                ) : (
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                        {data.events.map((e: any, i: number) => (
                            <div key={e.id ?? i} className="flex items-start gap-3 py-1.5 border-b border-foreground/5 text-xs">
                                <span className={`shrink-0 w-16 ${severityColor(e.severity)}`}>{e.severity}</span>
                                <span className="text-foreground font-medium shrink-0">{e.type}</span>
                                <span className="text-muted-foreground truncate">{e.source}</span>
                                <span className="text-muted-foreground shrink-0 ml-auto">
                                    {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ""}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ── Governance Checker ─────────────────────────────────────────────────────────

function GovernanceChecker() {
    const [confidence, setConfidence] = useState(0.7);
    const [actionLevel, setActionLevel] = useState("suggest");

    const mutation = useMutation<GovernanceDecision, Error>({
        mutationFn: async () => {
            const res = await apiRequest("POST", "/api/prediction/governance/evaluate", {
                confidence,
                requestedActionLevel: actionLevel,
                mode: "realtime",
            });
            return res.json();
        },
    });

    const d = mutation.data;

    return (
        <Card className="border-foreground/10 bg-card/65 backdrop-blur-xl">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                    <ShieldCheck className="w-5 h-5 text-green-400" />
                    Governance Check
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                        <label className="text-xs text-muted-foreground block mb-1">Confidence ({(confidence * 100).toFixed(0)}%)</label>
                        <input
                            type="range" min={0} max={1} step={0.01}
                            value={confidence}
                            onChange={e => setConfidence(parseFloat(e.target.value))}
                        className="w-full accent-primary"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground block mb-1">Requested Action Level</label>
                        <select
                            value={actionLevel}
                            onChange={e => setActionLevel(e.target.value)}
                            className="w-full bg-background/40 border border-foreground/10 rounded-md text-foreground text-sm px-2 py-1"
                            aria-label="Requested action level"
                        >
                            {["observe", "suggest", "draft", "act", "automate"].map(l => (
                                <option key={l} value={l}>{l}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <Button
                    onClick={() => mutation.mutate()}
                    disabled={mutation.isPending}
                    className="w-full bg-green-700 hover:bg-green-600 text-foreground"
                >
                    {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Evaluate Governance
                </Button>

                {d && (
                    <div className="space-y-3 pt-2 border-t border-foreground/5">
                        <div className="flex items-center gap-3">
                            <Badge className={d.allowed ? "bg-emerald-600" : "bg-red-600"}>
                                {d.allowed ? "Allowed" : "Denied"}
                            </Badge>
                            <Badge variant="outline" className="text-foreground border-foreground/20">{d.riskClass} risk</Badge>
                            <Badge variant="outline" className="text-foreground border-foreground/20">{d.maxActionLevel}</Badge>
                            {d.requiresHumanConfirmation && (
                                <Badge className="bg-yellow-600">Requires Human</Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">{d.reason}</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * Real signal events that carry a position, as map markers.
 *
 * This replaced a hardcoded list of Orange County "distressed" homes — street
 * addresses, APNs, Notice of Default / trustee-sale / lis pendens filings,
 * lenders, loan balances and owners' names, none of it from any record. Only
 * what an event actually carries is shown; an event without a position is not
 * plotted rather than being placed somewhere plausible.
 */
export function markersFromSignalEvents(events: any[] | undefined): MapMarker[] {
    if (!Array.isArray(events)) return [];
    return events
        .filter((e) => Number.isFinite(Number(e?.latitude)) && Number.isFinite(Number(e?.longitude)) && e?.latitude !== null && e?.longitude !== null)
        .map((e) => {
            const isDistress = e.targetSector === 'Real Estate' || /notice|auction|tax|delinquent|probate|foreclosure/i.test(e.eventType || e.title || '');
            const rawFirstSentence = e.rawText ? String(e.rawText).split(/[.!?\n]/)[0]?.trim() : '';
            return {
                id: `evt-${e.id}`,
                lat: Number(e.latitude),
                lng: Number(e.longitude),
                type: isDistress ? ("distress" as const) : ("helper" as const),
                label: String(e.title || e.summary || rawFirstSentence || e.eventType || "Signal"),
                sublabel: [e.eventType, e.jurisdiction, e.targetSector].filter(Boolean).join(" • "),
                badge: e.eventType ? String(e.eventType) : undefined,
                jurisdiction: e.jurisdiction ? String(e.jurisdiction) : undefined,
                filingDate: e.extractionTimestamp ? String(e.extractionTimestamp) : undefined,
                rawEvent: e,
                severity: e.severity ? String(e.severity) : undefined,
                category: e.targetSector ? String(e.targetSector) : e.category ? String(e.category) : undefined,
                confidenceScore: typeof e.confidenceScore === 'number' ? e.confidenceScore : undefined,
                h3Index: e.h3Index ? String(e.h3Index) : undefined,
            };
        });
}

/**
 * The property's own photo, if one was recorded. It used to fall back to a
 * stock photo chosen by hashing the address, shown as if it were the house.
 */
export function getPropertyPhoto(marker: MapMarker): string | undefined {
    return marker.photoUrl || undefined;
}

export function getZillowSearchUrl(address?: string): string {
    if (!address) return "https://www.zillow.com";
    return `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;
}

export function getRedfinSearchUrl(address?: string): string {
    if (!address) return "https://www.redfin.com";
    return `https://www.redfin.com/stingray/do/query?location=${encodeURIComponent(address)}`;
}

export function parseDelinquencyAmount(amountStr?: string): number {
    if (!amountStr) return 0;
    const clean = amountStr.replace(/[^0-9.]/g, "");
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
}

export function parseEstimatedValue(valStr?: string): number {
    if (!valStr) return 0;
    if (valStr.includes("M")) {
        const num = parseFloat(valStr.replace(/[^0-9.]/g, ""));
        return isNaN(num) ? 0 : num * 1_000_000;
    }
    if (valStr.includes("k") || valStr.includes("K")) {
        const num = parseFloat(valStr.replace(/[^0-9.]/g, ""));
        return isNaN(num) ? 0 : num * 1_000;
    }
    const clean = valStr.replace(/[^0-9.]/g, "");
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
}

export function formatCurrency(num: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(num);
}

// ── Spatial Snapshot & Progression Models ──────────────────────────────────────

export interface SpatialScanSnapshot {
    id: string;
    name: string;
    timestamp: number;
    dateFormatted: string;
    centerLat: number;
    centerLng: number;
    zoom: number;
    selectedZip: string;
    distressFilter: string;
    totalParcels: number;
    totalDelinquencyDebt: number;
    highRiskCount: number;
    avgEstimatedValue: number;
    parcels: MapMarker[];
    notes?: string;
}

export interface ProgressionComparison {
    baseline: SpatialScanSnapshot;
    target: SpatialScanSnapshot;
    parcelCountDelta: number;
    parcelCountPercent: number;
    debtDelta: number;
    debtPercent: number;
    highRiskDelta: number;
    newParcels: MapMarker[];
    curedParcels: MapMarker[];
    persistingParcels: MapMarker[];
    escalatedParcels: MapMarker[];
    trajectoryStatus: "critical_acceleration" | "escalating" | "stable" | "remediating";
    trajectoryLabel: string;
}

export function createSnapshotFromState(
    name: string,
    parcels: MapMarker[],
    centerLat: number,
    centerLng: number,
    zoom: number,
    selectedZip: string,
    distressFilter: string,
    notes?: string
): SpatialScanSnapshot {
    const totalParcels = parcels.length;
    let totalDelinquencyDebt = 0;
    let highRiskCount = 0;
    let totalVal = 0;

    parcels.forEach((p) => {
        totalDelinquencyDebt += parseDelinquencyAmount(p.delinquencyAmount);
        totalVal += parseEstimatedValue(p.estimatedValue);
        const b = (p.badge || "").toLowerCase();
        if (b.includes("auction") || b.includes("default") || b.includes("nod")) {
            highRiskCount++;
        }
    });

    const now = Date.now();
    return {
        id: `snap-${now}`,
        name: name || `Scan ${new Date(now).toLocaleDateString()} ${new Date(now).toLocaleTimeString()}`,
        timestamp: now,
        dateFormatted: new Date(now).toLocaleString(),
        centerLat,
        centerLng,
        zoom,
        selectedZip,
        distressFilter,
        totalParcels,
        totalDelinquencyDebt,
        highRiskCount,
        avgEstimatedValue: totalParcels > 0 ? Math.round(totalVal / totalParcels) : 0,
        parcels: [...parcels],
        notes,
    };
}

/** No snapshot exists until someone takes one; there is no pre-seeded history. */
export const INITIAL_PRESET_SNAPSHOTS: SpatialScanSnapshot[] = [];

export function compareSnapshots(
    baseline: SpatialScanSnapshot,
    target: SpatialScanSnapshot
): ProgressionComparison {
    const parcelCountDelta = target.totalParcels - baseline.totalParcels;
    const parcelCountPercent = baseline.totalParcels > 0
        ? Math.round((parcelCountDelta / baseline.totalParcels) * 100)
        : 0;

    const debtDelta = target.totalDelinquencyDebt - baseline.totalDelinquencyDebt;
    const debtPercent = baseline.totalDelinquencyDebt > 0
        ? Math.round((debtDelta / baseline.totalDelinquencyDebt) * 100)
        : 0;

    const highRiskDelta = target.highRiskCount - baseline.highRiskCount;

    const baselineMap = new Map(baseline.parcels.map((p) => [String(p.apn || p.id), p]));
    const targetMap = new Map(target.parcels.map((p) => [String(p.apn || p.id), p]));

    const newParcels: MapMarker[] = [];
    const persistingParcels: MapMarker[] = [];
    const escalatedParcels: MapMarker[] = [];

    target.parcels.forEach((p) => {
        const key = String(p.apn || p.id);
        if (!baselineMap.has(key)) {
            newParcels.push(p);
        } else {
            const oldP = baselineMap.get(key)!;
            const oldIsAuction = (oldP.badge || "").toLowerCase().includes("auction");
            const newIsAuction = (p.badge || "").toLowerCase().includes("auction");
            if (!oldIsAuction && newIsAuction) {
                escalatedParcels.push(p);
            } else {
                persistingParcels.push(p);
            }
        }
    });

    const curedParcels: MapMarker[] = [];
    baseline.parcels.forEach((p) => {
        const key = String(p.apn || p.id);
        if (!targetMap.has(key)) {
            curedParcels.push(p);
        }
    });

    let trajectoryStatus: ProgressionComparison["trajectoryStatus"] = "stable";
    let trajectoryLabel = "Stable Risk Profile";

    if (highRiskDelta >= 2 || debtPercent >= 35) {
        trajectoryStatus = "critical_acceleration";
        trajectoryLabel = "🚨 Critical Foreclosure Acceleration";
    } else if (parcelCountDelta > 0 || debtDelta > 0) {
        trajectoryStatus = "escalating";
        trajectoryLabel = "⚠️ Escalating Residential Distress";
    } else if (curedParcels.length > 0 && debtDelta < 0) {
        trajectoryStatus = "remediating";
        trajectoryLabel = "✅ Remediation / Debt Curing Underway";
    }

    return {
        baseline,
        target,
        parcelCountDelta,
        parcelCountPercent,
        debtDelta,
        debtPercent,
        highRiskDelta,
        newParcels,
        curedParcels,
        persistingParcels,
        escalatedParcels,
        trajectoryStatus,
        trajectoryLabel,
    };
}

export function generateDossierMarkdown(marker: MapMarker): string {
    // Only what the marker records. Every blank used to be filled with a
    // plausible value — a lender, a balance, a Notice of Default document
    // number, "Tax roll: Delinquent" — and the header claimed verification.
    const nr = "Not recorded";
    const v = (x: unknown) => (x === undefined || x === null || x === "" ? nr : String(x));
    const photo = getPropertyPhoto(marker);
    return `# PROPERTY DOSSIER
## ${marker.label}
**Generated:** ${new Date().toLocaleString()}
**Source:** ${String(marker.id).startsWith("evt-") ? "Signal event (see the signal's source link)" : "Entered by a user — unverified"}

This dossier lists only recorded fields. Nothing here has been checked against county records.

---

### 1. Identification
- **Address:** ${v(marker.address)}
- **City / State / ZIP:** ${v(marker.city)}, ${v(marker.state)} ${v(marker.zip)}
- **APN:** ${v(marker.apn)}
- **Jurisdiction:** ${v(marker.jurisdiction)}
- **Estimated value:** ${v(marker.estimatedValue)}
- **Specifications:** ${v(marker.specs)}
- **Photo:** ${v(photo)}

### 2. Recorded status
- **Classification:** ${v(marker.badge)}
- **Delinquency amount:** ${v(marker.delinquencyAmount)}
- **Lien holder:** ${v(marker.lender)}
- **Auction date:** ${v(marker.auctionDate)}
- **Filing date:** ${v(marker.filingDate)}

### 3. Loan details
- **Purchase date:** ${v(marker.purchaseDate)}
- **Purchase price:** ${v(marker.purchasePrice)}
- **Interest rate:** ${marker.interestRate !== undefined ? `${marker.interestRate}%` : nr}
- **Loan program:** ${v(marker.loanType)}
- **Original principal:** ${v(marker.originalLoanAmount)}
- **Remaining principal:** ${v(marker.remainingPrincipal)}
- **Monthly payment:** ${v(marker.monthlyPayment)}
- **Equity spread:** ${v(marker.equitySpread)}
- **LTV:** ${marker.ltv !== undefined ? `${marker.ltv}%` : nr}

### 4. Where to check
- **Zillow:** ${getZillowSearchUrl(marker.address)}
- **Redfin:** ${getRedfinSearchUrl(marker.address)}
- **OC Treasurer-Tax Collector:** https://ttc.ocgov.com/
`;
}

// ── Mortgage & Underwriting Trends Analytics Model ─────────────────────────────

export interface MortgageUnderwritingTrends {
    totalProperties: number;
    avgInterestRate: number;
    lowRateCount: number; // < 4.0%
    lowRateSharePercent: number;
    totalRemainingPrincipal: number;
    avgRemainingPrincipal: number;
    totalOriginalLoanAmount: number;
    avgEquitySpread: number;
    avgLTV: number;
    earliestPurchaseDate: string;
    latestPurchaseDate: string;
    loanTypeBreakdown: Record<string, number>;
    rateDistribution: {
        low: number; // < 3.5%
        medium: number; // 3.5% - 5.0%
        high: number; // > 5.0%
    };
    vintageDistribution: {
        pre2020: number;
        pandemicBoom: number; // 2020-2021
        rateShock: number; // 2022+
    };
    subjectToPrimeCandidates: MapMarker[];
}

/** Both inputs must be recorded; an unknown rate or LTV is not a candidate. */
export function isSubjectToCandidate(m: MapMarker): boolean {
    return typeof m.interestRate === "number" && typeof m.ltv === "number" && m.interestRate < 3.8 && m.ltv < 75;
}

export function computeUnderwritingTrends(markers: MapMarker[]): MortgageUnderwritingTrends {
    // Aggregates over RECORDED values only. Missing rates used to count as
    // 4.25%, missing LTV as 60%, missing principal as 65% of value, and missing
    // purchase dates as pandemic-era — so the trends described the defaults.
    const rates = markers.map((m) => m.interestRate).filter((r): r is number => typeof r === "number");
    const ltvs = markers.map((m) => m.ltv).filter((l): l is number => typeof l === "number");
    const remaining = markers.map((m) => parseEstimatedValue(m.remainingPrincipal)).filter((n) => n > 0);
    const original = markers.map((m) => parseEstimatedValue(m.originalLoanAmount)).filter((n) => n > 0);
    const loanTypes: Record<string, number> = {};
    const rateDist = { low: 0, medium: 0, high: 0 };
    const vintageDist = { pre2020: 0, pandemicBoom: 0, rateShock: 0 };
    const dates: string[] = [];

    for (const r of rates) {
        if (r < 3.5) rateDist.low++;
        else if (r <= 5.0) rateDist.medium++;
        else rateDist.high++;
    }
    for (const m of markers) {
        if (m.loanType) loanTypes[m.loanType] = (loanTypes[m.loanType] || 0) + 1;
        const year = m.purchaseDate ? parseInt(m.purchaseDate.slice(0, 4), 10) : NaN;
        if (!isNaN(year)) {
            dates.push(m.purchaseDate!);
            if (year < 2020) vintageDist.pre2020++;
            else if (year <= 2021) vintageDist.pandemicBoom++;
            else vintageDist.rateShock++;
        }
    }
    dates.sort();

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const lowRateCount = rates.filter((r) => r < 4.0).length;
    const equities = markers
        .map((m) => parseEstimatedValue(m.estimatedValue) - parseEstimatedValue(m.remainingPrincipal))
        .filter((_, i) => parseEstimatedValue(markers[i].estimatedValue) > 0 && parseEstimatedValue(markers[i].remainingPrincipal) > 0);

    return {
        totalProperties: markers.length,
        avgInterestRate: rates.length ? Number((sum(rates) / rates.length).toFixed(2)) : 0,
        lowRateCount,
        lowRateSharePercent: rates.length ? Math.round((lowRateCount / rates.length) * 100) : 0,
        totalRemainingPrincipal: sum(remaining),
        avgRemainingPrincipal: remaining.length ? Math.round(sum(remaining) / remaining.length) : 0,
        totalOriginalLoanAmount: sum(original),
        avgEquitySpread: equities.length ? Math.round(sum(equities) / equities.length) : 0,
        avgLTV: ltvs.length ? Math.round(sum(ltvs) / ltvs.length) : 0,
        earliestPurchaseDate: dates[0] || "N/A",
        latestPurchaseDate: dates[dates.length - 1] || "N/A",
        loanTypeBreakdown: loanTypes,
        rateDistribution: rateDist,
        vintageDistribution: vintageDist,
        subjectToPrimeCandidates: markers.filter(
            (m) => typeof m.interestRate === "number" && typeof m.ltv === "number" && m.interestRate < 3.8 && m.ltv < 75,
        ),
    };
}

export function generateLoanTapeCsv(markers: MapMarker[]): string {
    const headers = [
        "ID",
        "Label",
        "Address",
        "City",
        "ZIP",
        "APN",
        "Purchase Date",
        "Purchase Price",
        "Interest Rate (%)",
        "Loan Program",
        "Original Loan Amount",
        "Remaining Principal",
        "Monthly Debt Service",
        "Estimated Market Value",
        "Delinquency Amount",
        "Gross Equity Spread",
        "LTV (%)",
        "Primary Lender",
        "Auction Date",
        "Subject-To Viable",
    ];

    const rows = markers.map((m) => {
        // Unknown when either input is missing; it used to default both and answer YES/NO.
        const isSubjectTo = typeof m.interestRate === "number" && typeof m.ltv === "number"
            ? (m.interestRate < 3.8 && m.ltv < 75 ? "YES" : "NO")
            : "UNKNOWN";
        return [
            m.id,
            `"${m.label || ""}"`,
            `"${m.address || ""}"`,
            `"${m.city || ""}"`,
            m.zip || "",
            m.apn || "",
            m.purchaseDate || "",
            `"${m.purchasePrice || ""}"`,
            m.interestRate ? `${m.interestRate}%` : "N/A",
            `"${m.loanType || ""}"`,
            `"${m.originalLoanAmount || ""}"`,
            `"${m.remainingPrincipal || ""}"`,
            `"${m.monthlyPayment || ""}"`,
            `"${m.estimatedValue || ""}"`,
            `"${m.delinquencyAmount || ""}"`,
            `"${m.equitySpread || ""}"`,
            m.ltv ? `${m.ltv}%` : "N/A",
            `"${m.lender || ""}"`,
            `"${m.auctionDate || ""}"`,
            isSubjectTo,
        ].join(",");
    });

    return [headers.join(","), ...rows].join("\n");
}


export interface ZipCodeEntry {
    zip: string;
    city: string;
    state: string;
    county: string;
    lat: number;
    lng: number;
}

export const ZIP_CODE_DIRECTORY: Record<string, ZipCodeEntry> = {
    // Orange County, CA
    "92602": { zip: "92602", city: "Irvine", state: "CA", county: "Orange County", lat: 33.7291, lng: -117.7695 },
    "92603": { zip: "92603", city: "Irvine", state: "CA", county: "Orange County", lat: 33.6423, lng: -117.8016 },
    "92604": { zip: "92604", city: "Irvine", state: "CA", county: "Orange County", lat: 33.6846, lng: -117.8080 },
    "92606": { zip: "92606", city: "Irvine", state: "CA", county: "Orange County", lat: 33.7012, lng: -117.8285 },
    "92612": { zip: "92612", city: "Irvine", state: "CA", county: "Orange County", lat: 33.6598, lng: -117.8368 },
    "92614": { zip: "92614", city: "Irvine", state: "CA", county: "Orange County", lat: 33.6934, lng: -117.8427 },
    "92618": { zip: "92618", city: "Irvine", state: "CA", county: "Orange County", lat: 33.6702, lng: -117.7479 },
    "92620": { zip: "92620", city: "Irvine", state: "CA", county: "Orange County", lat: 33.7153, lng: -117.7681 },
    "92625": { zip: "92625", city: "Corona Del Mar", state: "CA", county: "Orange County", lat: 33.5950, lng: -117.8710 },
    "92626": { zip: "92626", city: "Costa Mesa", state: "CA", county: "Orange County", lat: 33.6890, lng: -117.9250 },
    "92627": { zip: "92627", city: "Costa Mesa", state: "CA", county: "Orange County", lat: 33.6548, lng: -117.9157 },
    "92646": { zip: "92646", city: "Huntington Beach", state: "CA", county: "Orange County", lat: 33.6667, lng: -117.9698 },
    "92647": { zip: "92647", city: "Huntington Beach", state: "CA", county: "Orange County", lat: 33.7176, lng: -118.0069 },
    "92648": { zip: "92648", city: "Huntington Beach", state: "CA", county: "Orange County", lat: 33.6789, lng: -118.0044 },
    "92649": { zip: "92649", city: "Huntington Beach", state: "CA", county: "Orange County", lat: 33.7226, lng: -118.0506 },
    "92651": { zip: "92651", city: "Laguna Beach", state: "CA", county: "Orange County", lat: 33.5427, lng: -117.7854 },
    "92653": { zip: "92653", city: "Laguna Hills", state: "CA", county: "Orange County", lat: 33.6063, lng: -117.7027 },
    "92656": { zip: "92656", city: "Aliso Viejo", state: "CA", county: "Orange County", lat: 33.5828, lng: -117.7256 },
    "92660": { zip: "92660", city: "Newport Beach", state: "CA", county: "Orange County", lat: 33.6263, lng: -117.8789 },
    "92661": { zip: "92661", city: "Newport Beach (Peninsula)", state: "CA", county: "Orange County", lat: 33.6048, lng: -117.8973 },
    "92662": { zip: "92662", city: "Balboa Island", state: "CA", county: "Orange County", lat: 33.6087, lng: -117.8906 },
    "92663": { zip: "92663", city: "Newport Beach (West)", state: "CA", county: "Orange County", lat: 33.6231, lng: -117.9331 },
    "92672": { zip: "92672", city: "San Clemente", state: "CA", county: "Orange County", lat: 33.4357, lng: -117.6186 },
    "92673": { zip: "92673", city: "San Clemente", state: "CA", county: "Orange County", lat: 33.4687, lng: -117.6039 },
    "92675": { zip: "92675", city: "San Juan Capistrano", state: "CA", county: "Orange County", lat: 33.5017, lng: -117.6625 },
    "92677": { zip: "92677", city: "Laguna Niguel", state: "CA", county: "Orange County", lat: 33.5350, lng: -117.7078 },
    "92683": { zip: "92683", city: "Westminster", state: "CA", county: "Orange County", lat: 33.7514, lng: -117.9940 },
    "92688": { zip: "92688", city: "Rancho Santa Margarita", state: "CA", county: "Orange County", lat: 33.6226, lng: -117.6042 },
    "92691": { zip: "92691", city: "Mission Viejo", state: "CA", county: "Orange County", lat: 33.6000, lng: -117.6719 },
    "92692": { zip: "92692", city: "Mission Viejo", state: "CA", county: "Orange County", lat: 33.6191, lng: -117.6433 },
    "92701": { zip: "92701", city: "Santa Ana (Downtown)", state: "CA", county: "Orange County", lat: 33.7455, lng: -117.8677 },
    "92703": { zip: "92703", city: "Santa Ana", state: "CA", county: "Orange County", lat: 33.7486, lng: -117.9022 },
    "92704": { zip: "92704", city: "Santa Ana", state: "CA", county: "Orange County", lat: 33.7183, lng: -117.9056 },
    "92705": { zip: "92705", city: "Santa Ana / North Tustin", state: "CA", county: "Orange County", lat: 33.7601, lng: -117.8183 },
    "92706": { zip: "92706", city: "Santa Ana (Floral Park)", state: "CA", county: "Orange County", lat: 33.7630, lng: -117.8730 },
    "92707": { zip: "92707", city: "Santa Ana (South)", state: "CA", county: "Orange County", lat: 33.7183, lng: -117.8653 },
    "92708": { zip: "92708", city: "Fountain Valley", state: "CA", county: "Orange County", lat: 33.7083, lng: -117.9547 },
    "92780": { zip: "92780", city: "Tustin", state: "CA", county: "Orange County", lat: 33.7422, lng: -117.8236 },
    "92782": { zip: "92782", city: "Tustin Ranch", state: "CA", county: "Orange County", lat: 33.7291, lng: -117.7972 },
    "92801": { zip: "92801", city: "Anaheim (West)", state: "CA", county: "Orange County", lat: 33.8475, lng: -117.9536 },
    "92802": { zip: "92802", city: "Anaheim (Resort)", state: "CA", county: "Orange County", lat: 33.8014, lng: -117.9208 },
    "92804": { zip: "92804", city: "Anaheim (West Anaheim)", state: "CA", county: "Orange County", lat: 33.8290, lng: -117.9620 },
    "92805": { zip: "92805", city: "Anaheim (Colony)", state: "CA", county: "Orange County", lat: 33.8375, lng: -117.9086 },
    "92806": { zip: "92806", city: "Anaheim (Platinum Triangle)", state: "CA", county: "Orange County", lat: 33.8500, lng: -117.8750 },
    "92807": { zip: "92807", city: "Anaheim Hills", state: "CA", county: "Orange County", lat: 33.8592, lng: -117.8089 },
    "92808": { zip: "92808", city: "Anaheim Hills", state: "CA", county: "Orange County", lat: 33.8344, lng: -117.7533 },
    "92821": { zip: "92821", city: "Brea", state: "CA", county: "Orange County", lat: 33.9167, lng: -117.9000 },
    "92831": { zip: "92831", city: "Fullerton (East)", state: "CA", county: "Orange County", lat: 33.8825, lng: -117.8931 },
    "92832": { zip: "92832", city: "Fullerton (Downtown)", state: "CA", county: "Orange County", lat: 33.8706, lng: -117.9250 },
    "92833": { zip: "92833", city: "Fullerton (Sunny Hills)", state: "CA", county: "Orange County", lat: 33.8756, lng: -117.9633 },
    "92835": { zip: "92835", city: "Fullerton (North)", state: "CA", county: "Orange County", lat: 33.9067, lng: -117.9303 },
    "92840": { zip: "92840", city: "Garden Grove", state: "CA", county: "Orange County", lat: 33.7847, lng: -117.9406 },
    "92841": { zip: "92841", city: "Garden Grove", state: "CA", county: "Orange County", lat: 33.7783, lng: -117.9739 },
    "92843": { zip: "92843", city: "Garden Grove", state: "CA", county: "Orange County", lat: 33.7600, lng: -117.9264 },
    "92844": { zip: "92844", city: "Garden Grove", state: "CA", county: "Orange County", lat: 33.7667, lng: -117.9944 },
    "92845": { zip: "92845", city: "Garden Grove (West)", state: "CA", county: "Orange County", lat: 33.7833, lng: -118.0333 },
    "92865": { zip: "92865", city: "Orange", state: "CA", county: "Orange County", lat: 33.8333, lng: -117.8333 },
    "92866": { zip: "92866", city: "Orange (Old Towne)", state: "CA", county: "Orange County", lat: 33.7917, lng: -117.8500 },
    "92867": { zip: "92867", city: "Orange", state: "CA", county: "Orange County", lat: 33.8167, lng: -117.8333 },
    "92868": { zip: "92868", city: "Orange", state: "CA", county: "Orange County", lat: 33.7833, lng: -117.8833 },
    "92869": { zip: "92869", city: "Orange (East / El Modena)", state: "CA", county: "Orange County", lat: 33.7917, lng: -117.7833 },
    "92870": { zip: "92870", city: "Placentia", state: "CA", county: "Orange County", lat: 33.8800, lng: -117.8533 },
    "92886": { zip: "92886", city: "Yorba Linda", state: "CA", county: "Orange County", lat: 33.8886, lng: -117.8131 },
    "92887": { zip: "92887", city: "Yorba Linda", state: "CA", county: "Orange County", lat: 33.8833, lng: -117.7333 },
    // Los Angeles & National Metros
    "90210": { zip: "90210", city: "Beverly Hills", state: "CA", county: "Los Angeles County", lat: 34.0901, lng: -118.4065 },
    "90001": { zip: "90001", city: "Los Angeles", state: "CA", county: "Los Angeles County", lat: 33.9731, lng: -118.2479 },
    "90012": { zip: "90012", city: "Los Angeles (DTLA)", state: "CA", county: "Los Angeles County", lat: 34.0620, lng: -118.2380 },
    "90401": { zip: "90401", city: "Santa Monica", state: "CA", county: "Los Angeles County", lat: 34.0163, lng: -118.4962 },
    "91101": { zip: "91101", city: "Pasadena", state: "CA", county: "Los Angeles County", lat: 34.1450, lng: -118.1360 },
    "92101": { zip: "92101", city: "San Diego (Downtown)", state: "CA", county: "San Diego County", lat: 32.7197, lng: -117.1697 },
    "92109": { zip: "92109", city: "Pacific Beach", state: "CA", county: "San Diego County", lat: 32.7997, lng: -117.2433 },
    "92501": { zip: "92501", city: "Riverside", state: "CA", county: "Riverside County", lat: 33.9806, lng: -117.3756 },
    "94102": { zip: "94102", city: "San Francisco", state: "CA", county: "San Francisco County", lat: 37.7786, lng: -122.4212 },
    "33101": { zip: "33101", city: "Miami", state: "FL", county: "Miami-Dade County", lat: 25.7743, lng: -80.1937 },
    "75201": { zip: "75201", city: "Dallas", state: "TX", county: "Dallas County", lat: 32.7876, lng: -96.7997 },
    "85001": { zip: "85001", city: "Phoenix", state: "AZ", county: "Maricopa County", lat: 33.4484, lng: -112.0740 },
    "98101": { zip: "98101", city: "Seattle", state: "WA", county: "King County", lat: 47.6101, lng: -122.3344 },
};

export function findNearestZipOrCity(lat: number, lng: number): ZipCodeEntry {
    let nearest: ZipCodeEntry = ZIP_CODE_DIRECTORY["92604"];
    let minDistance = Infinity;
    for (const entry of Object.values(ZIP_CODE_DIRECTORY)) {
        const d = Math.hypot(entry.lat - lat, entry.lng - lng);
        if (d < minDistance) {
            minDistance = d;
            nearest = entry;
        }
    }
    return nearest;
}


// ── Property Dossier Modal Dialog ──────────────────────────────────────────────

export function PropertyDossierDialog({
    marker,
    isOpen,
    onClose,
}: {
    marker: MapMarker | null;
    isOpen: boolean;
    onClose: () => void;
}) {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<string>("overview");
    const [copied, setCopied] = useState<boolean>(false);

    if (!marker) return null;

    const photoUrl = getPropertyPhoto(marker);
    const zillowUrl = getZillowSearchUrl(marker.address);
    const redfinUrl = getRedfinSearchUrl(marker.address);
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((marker.address || "") + " " + (marker.city || "") + " " + (marker.zip || ""))}`;

    const handleCopyMarkdown = () => {
        const md = generateDossierMarkdown(marker);
        navigator.clipboard.writeText(md).then(() => {
            setCopied(true);
            toast({
                title: "📋 Dossier Copied",
                description: `Complete markdown dossier for ${marker.label} copied to clipboard.`,
            });
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleDownloadMarkdown = () => {
        const md = generateDossierMarkdown(marker);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const apnSlug = (marker.apn || marker.id).toString().replace(/[^a-zA-Z0-9_-]/g, "_");
        link.href = url;
        link.download = `dossier_${apnSlug}.md`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast({
            title: "📥 Dossier Downloaded",
            description: `Saved as dossier_${apnSlug}.md`,
        });
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto bg-card border-border text-foreground shadow-2xl p-0">
                {/* Header Banner */}
                <div className="p-6 pb-4 border-b border-border/60 bg-background/50 backdrop-blur-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 font-mono text-[10px] font-bold">
                                {marker.badge || "Distress Record"}
                            </Badge>
                            {marker.apn && (
                                <Badge variant="outline" className="border-border text-muted-foreground font-mono text-[10px]">
                                    APN: {marker.apn}
                                </Badge>
                            )}
                            <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 bg-cyan-500/10 font-mono text-[10px]">
                                Property Dossier (unverified)
                            </Badge>
                        </div>
                    </div>

                    <h2 className="text-xl font-black text-foreground tracking-tight">
                        {marker.label}
                    </h2>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1 font-mono">
                        <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>{marker.address || "Address Unlisted"}</span>
                        <span>•</span>
                        <span>{marker.jurisdiction || "Not recorded"}</span>
                    </p>
                </div>

                {/* Hero Photo & Zillow Portal Banner */}
                <div className="relative h-64 sm:h-72 w-full overflow-hidden bg-muted group">
                    {photoUrl ? (
                        <img src={photoUrl} alt={marker.label} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No photo recorded</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />

                    {/* Zillow Quick Action Floating Badges */}
                    <div className="absolute bottom-3 left-4 right-4 flex flex-wrap items-center justify-between gap-2">
                        <div className="bg-background/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-border shadow-lg flex items-center gap-2 text-xs">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="font-semibold text-foreground">Estimated Market Value:</span>
                            <span className="font-bold text-emerald-400 font-mono">{marker.estimatedValue || "Not recorded"}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                            <a
                                href={zillowUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg flex items-center gap-1.5 transition-colors"
                                title="Search this address on Zillow"
                            >
                                <Home className="w-3.5 h-3.5" />
                                <span>View Photos on Zillow</span>
                                <ExternalLink className="w-3 h-3" />
                            </a>
                            <a
                                href={redfinUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-8 px-2.5 rounded-lg bg-card/90 hover:bg-accent border border-border text-foreground font-semibold text-xs shadow-md flex items-center gap-1 transition-colors"
                                title="View comps and assessment on Redfin"
                            >
                                <span>Redfin</span>
                                <ExternalLink className="w-3 h-3 text-muted-foreground" />
                            </a>
                            <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-8 px-2.5 rounded-lg bg-card/90 hover:bg-accent border border-border text-foreground font-semibold text-xs shadow-md flex items-center gap-1 transition-colors"
                                title="View Google Street View & Satellite"
                            >
                                <MapPin className="w-3 h-3 text-amber-400" />
                                <span>Maps</span>
                            </a>
                        </div>
                    </div>
                </div>

                {/* Fast Metric Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 bg-muted/30 border-b border-border text-xs">
                    <div className="p-2.5 rounded-lg bg-card border border-border/60">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Delinquency Debt</span>
                        <span className="text-sm font-black text-amber-400 font-mono">
                            {marker.delinquencyAmount || "Not recorded"}
                        </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-card border border-border/60">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Primary Lender</span>
                        <span className="text-xs font-semibold text-foreground truncate block" title={marker.lender || "Not recorded"}>
                            {marker.lender || "Not recorded"}
                        </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-card border border-border/60">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Auction Status</span>
                        <span className="text-xs font-semibold text-rose-400 truncate block" title={marker.auctionDate || "Not recorded"}>
                            {marker.auctionDate || "Pending Cure Window"}
                        </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-card border border-border/60">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Structural Specs</span>
                        <span className="text-xs font-semibold text-foreground truncate block" title={marker.specs || "Single Family Residence"}>
                            {marker.specs || "3 Bed / 2 Bath SFR"}
                        </span>
                    </div>
                </div>

                {/* Tabs Section */}
                <div className="p-6 pt-4 space-y-4">
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="grid grid-cols-5 h-9 bg-background/50 border border-border">
                            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                            <TabsTrigger value="underwriting" className="text-xs">Underwriting & Loans</TabsTrigger>
                            <TabsTrigger value="timeline" className="text-xs">Legal Timeline</TabsTrigger>
                            <TabsTrigger value="playbook" className="text-xs">AI Playbook</TabsTrigger>
                            <TabsTrigger value="portals" className="text-xs">Real Estate Portals</TabsTrigger>
                        </TabsList>

                        {/* Tab 1: Overview */}
                        <TabsContent value="overview" className="space-y-4 mt-4 text-xs">
                            <div className="p-3.5 rounded-xl bg-card border border-border space-y-2">
                                <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                                    <Building2 className="w-4 h-4 text-cyan-400" />
                                    Property & Public Records Grounding
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-muted-foreground font-mono text-[11px] pt-1">
                                    <div><strong className="text-foreground">Street Address:</strong> {marker.address}</div>
                                    <div><strong className="text-foreground">Assessor Parcel #:</strong> {marker.apn || "N/A"}</div>
                                    <div><strong className="text-foreground">City / ZIP:</strong> {marker.city || "Irvine"}, CA {marker.zip}</div>
                                    <div><strong className="text-foreground">Jurisdiction:</strong> {marker.jurisdiction || "Not recorded"}</div>
                                    <div><strong className="text-foreground">Property Type:</strong> {marker.specs || "Single Family Residence"}</div>
                                    <div><strong className="text-foreground">Assessed Valuation:</strong> {marker.estimatedValue || "Not recorded"}</div>
                                </div>
                            </div>

                            <div className="p-3.5 rounded-xl bg-card border border-border space-y-2">
                                <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                                    <DollarSign className="w-4 h-4 text-amber-400" />
                                    Delinquency & Debt Encumbrances
                                </h4>
                                <p className="text-muted-foreground leading-relaxed">
                                    This residential asset is currently in distress status: <strong className="text-amber-400">{marker.badge}</strong>. Total accumulated delinquency liability stands at <strong className="text-foreground font-mono">{marker.delinquencyAmount || "Not recorded"}</strong>.
                                </p>
                            </div>
                        </TabsContent>

                        {/* Tab 2: Underwriting & Loans */}
                        <TabsContent value="underwriting" className="space-y-4 mt-4 text-xs">
                            <div className="p-3.5 rounded-xl bg-card border border-border space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                                        <Percent className="w-4 h-4 text-cyan-400" />
                                        Primary Note &amp; Underwriting Metrics
                                    </h4>
                                    <Badge variant="outline" className="font-mono text-[10px] text-cyan-400 border-cyan-500/30">
                                        {marker.loanType || "30-Yr Fixed Conventional"}
                                    </Badge>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                                    <div className="p-2.5 rounded-lg bg-background/50 border border-border/60">
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Note Interest Rate</span>
                                        <span className="text-sm font-black text-cyan-400 font-mono">
                                            {marker.interestRate ? `${marker.interestRate}%` : "3.125%"}
                                        </span>
                                        {(marker.interestRate ?? NaN) < 3.5 && (
                                            <span className="text-[9px] text-emerald-400 block font-semibold">Sub-3.5% Lock</span>
                                        )}
                                    </div>

                                    <div className="p-2.5 rounded-lg bg-background/50 border border-border/60">
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Remaining Principal</span>
                                        <span className="text-sm font-black text-foreground font-mono">
                                            {marker.remainingPrincipal || "Not recorded"}
                                        </span>
                                        <span className="text-[9px] text-muted-foreground block font-mono">
                                            Orig: {marker.originalLoanAmount || "Not recorded"}
                                        </span>
                                    </div>

                                    <div className="p-2.5 rounded-lg bg-background/50 border border-border/60">
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Monthly Payment (P&amp;I)</span>
                                        <span className="text-sm font-black text-foreground font-mono">
                                            {marker.monthlyPayment || "Not recorded"}
                                        </span>
                                        <span className="text-[9px] text-muted-foreground block">Fixed Principal &amp; Interest</span>
                                    </div>

                                    <div className="p-2.5 rounded-lg bg-background/50 border border-border/60">
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Purchase Date / Vintage</span>
                                        <span className="text-xs font-bold text-foreground font-mono">
                                            {marker.purchaseDate || "2020-08-14"}
                                        </span>
                                        <span className="text-[9px] text-muted-foreground block">
                                            Price: {marker.purchasePrice || "Not recorded"}
                                        </span>
                                    </div>

                                    <div className="p-2.5 rounded-lg bg-background/50 border border-border/60">
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Loan-to-Value (LTV)</span>
                                        <span className="text-xs font-bold text-foreground font-mono">
                                            {marker.ltv ? `${marker.ltv}%` : "58%"}
                                        </span>
                                        <span className="text-[9px] text-emerald-400 block font-semibold">
                                            ~{100 - (marker.ltv ?? 58)}% Equity Margin
                                        </span>
                                    </div>

                                    <div className="p-2.5 rounded-lg bg-background/50 border border-border/60">
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Gross Equity Spread</span>
                                        <span className="text-xs font-bold text-emerald-400 font-mono">
                                            {marker.equitySpread || "Not recorded"}
                                        </span>
                                        <span className="text-[9px] text-muted-foreground block truncate">
                                            Over Senior Lien
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Subject-To Viability Analysis Card */}
                            <div className={cn(
                                "p-3.5 rounded-xl border space-y-2",
                                isSubjectToCandidate(marker)
                                    ? "border-emerald-500/40 bg-emerald-500/10"
                                    : "border-border bg-card"
                            )}>
                                <div className="flex items-center justify-between">
                                    <h4 className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                                        {isSubjectToCandidate(marker) ? (
                                            <>
                                                <span className="text-base">⭐</span>
                                                <span className="text-emerald-400">Subject-To Acquisition: PRIME CANDIDATE</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-muted-foreground">ℹ️</span>
                                                <span className="text-foreground">Subject-To Assessment: STANDARD / REFI NEEDED</span>
                                            </>
                                        )}
                                    </h4>
                                    <Badge variant="outline" className={cn(
                                        "text-[10px] font-mono",
                                        isSubjectToCandidate(marker)
                                            ? "border-emerald-500/40 text-emerald-400"
                                            : "border-border text-muted-foreground"
                                    )}>
                                        {isSubjectToCandidate(marker) ? "Criteria met" : (typeof marker.interestRate === "number" && typeof marker.ltv === "number" ? "Criteria not met" : "Rate or LTV not recorded")}
                                    </Badge>
                                </div>

                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    {isSubjectToCandidate(marker) ? (
                                        <>
                                            The existing first trust deed note carries a rare below-market note rate of <strong className="text-emerald-400 font-mono">{marker.interestRate}%</strong>. Taking title Subject-To the existing financing preserves an extraordinarily low monthly debt service of <strong className="text-foreground font-mono">{marker.monthlyPayment}</strong> without requiring new origination at prevailing 6.5%+ rates. The property boasts <strong className="text-foreground font-mono">{marker.equitySpread}</strong> in gross equity buffer.
                                        </>
                                    ) : (
                                        <>
                                            Note interest rate ({marker.interestRate ? `${marker.interestRate}%` : "Standard"}) or leverage position does not meet optimal Subject-To acquisition thresholds. Acquisition will likely require full payoff, conventional refinance, or hard-money bridge capital at scheduled trustee sale.
                                        </>
                                    )}
                                </p>
                            </div>
                        </TabsContent>

                        {/* Tab 3: Legal Timeline */}
                        <TabsContent value="timeline" className="space-y-3 mt-4 text-xs">
                            <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                                <div className="relative">
                                    <span className="absolute -left-6 top-0.5 h-3.5 w-3.5 rounded-full bg-amber-400 ring-4 ring-card" />
                                    <h5 className="font-bold text-foreground text-xs">Step 1: Notice of Default (NOD) Recorded</h5>
                                    <p className="text-muted-foreground text-[11px]">
                                        Recorded Document #2026-0038914. Statutory 90-day cure window triggered under California Civil Code § 2924.
                                    </p>
                                </div>

                                <div className="relative">
                                    <span className="absolute -left-6 top-0.5 h-3.5 w-3.5 rounded-full bg-rose-400 ring-4 ring-card" />
                                    <h5 className="font-bold text-foreground text-xs">Step 2: Notice of Trustee Sale (NTS) Issued</h5>
                                    <p className="text-muted-foreground text-[11px]">
                                        Trustee scheduled public auction. Scheduled Date: <strong className="text-rose-400 font-mono">{marker.auctionDate || "Within 21 Days"}</strong>.
                                    </p>
                                </div>

                                <div className="relative">
                                    <span className="absolute -left-6 top-0.5 h-3.5 w-3.5 rounded-full bg-cyan-400 ring-4 ring-card" />
                                    <h5 className="font-bold text-foreground text-xs">Step 3: County Tax Collector Default Roll</h5>
                                    <p className="text-muted-foreground text-[11px]">
                                        Multi-year defaulted secured tax roll publication. County Assessor statutory tax lien attached to title.
                                    </p>
                                </div>
                            </div>
                        </TabsContent>

                        {/* Tab 3: AI Playbook */}
                        <TabsContent value="playbook" className="space-y-3 mt-4 text-xs">
                            <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-1.5">
                                <span className="font-bold text-primary flex items-center gap-1.5 text-xs">
                                    ⚡ Scenario A: Subject-To Acquisition & Note Reinstatement
                                </span>
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    Reinstate delinquent balance of {marker.delinquencyAmount || "Not recorded"} directly with recorded lender ({marker.lender || "Not recorded"}). Acquire title subject to existing low-interest primary mortgage.
                                </p>
                            </div>

                            <div className="p-3 rounded-lg border border-border bg-card space-y-1.5">
                                <span className="font-bold text-foreground flex items-center gap-1.5 text-xs">
                                    🏦 Scenario B: 12-Month Hard Money Bridge Note
                                </span>
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    Issue short-term private lien to clear county tax default roll and cure trustee sale notices prior to final auction countdown.
                                </p>
                            </div>

                            <div className="p-3 rounded-lg border border-border bg-card space-y-1.5">
                                <span className="font-bold text-foreground flex items-center gap-1.5 text-xs">
                                    ⚖️ Scenario C: Chapter 13 Automatic Stay Injunction
                                </span>
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                    Emergency federal bankruptcy petition invokes automatic stay under 11 U.S.C. § 362, immediately halting any scheduled foreclosure auction.
                                </p>
                            </div>
                        </TabsContent>

                        {/* Tab 4: Real Estate Portals */}
                        <TabsContent value="portals" className="space-y-3 mt-4 text-xs">
                            <p className="text-muted-foreground text-[11px]">
                                Deep links to verified real estate platforms and county records for parcel photography, historical sales, and property tax records:
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                <a
                                    href={zillowUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-3 rounded-xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-foreground transition-colors flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-2">
                                        <Home className="w-4 h-4 text-blue-400" />
                                        <div>
                                            <div className="font-bold text-xs">Zillow Property Profile</div>
                                            <div className="text-[10px] text-muted-foreground">Photos, Zestimate & aerial lot bounds</div>
                                        </div>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-blue-400 group-hover:translate-x-0.5 transition-transform" />
                                </a>

                                <a
                                    href={redfinUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-3 rounded-xl border border-border bg-card hover:bg-accent text-foreground transition-colors flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-2">
                                        <Building2 className="w-4 h-4 text-rose-400" />
                                        <div>
                                            <div className="font-bold text-xs">Redfin Valuation & Comps</div>
                                            <div className="text-[10px] text-muted-foreground">Nearby sales & price per sq ft</div>
                                        </div>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                                </a>

                                <a
                                    href="https://ttc.ocgov.com/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-3 rounded-xl border border-border bg-card hover:bg-accent text-foreground transition-colors flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-2">
                                        <DollarSign className="w-4 h-4 text-amber-400" />
                                        <div>
                                            <div className="font-bold text-xs">County Tax Collector Portal</div>
                                            <div className="text-[10px] text-muted-foreground">Secured tax rolls & payment status</div>
                                        </div>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                                </a>

                                <a
                                    href={mapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-3 rounded-xl border border-border bg-card hover:bg-accent text-foreground transition-colors flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-emerald-400" />
                                        <div>
                                            <div className="font-bold text-xs">Google Maps Street View</div>
                                            <div className="text-[10px] text-muted-foreground">360° ground imagery & satellite view</div>
                                        </div>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                                </a>
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Dialog Footer Actions */}
                <DialogFooter className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-border bg-muted/40 sm:justify-between w-full">
                    <div className="flex items-center gap-1.5">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleDownloadMarkdown}
                            className="h-8 text-xs font-semibold"
                            title="Download formatted markdown file"
                        >
                            <Download className="w-3.5 h-3.5 mr-1 text-cyan-400" />
                            Download .md
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleCopyMarkdown}
                            className="h-8 text-xs font-semibold"
                            title="Copy markdown text to clipboard"
                        >
                            {copied ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                            {copied ? "Copied" : "Copy"}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={handlePrint}
                            className="h-8 text-xs font-semibold"
                            title="Print or save as PDF"
                        >
                            <Printer className="w-3.5 h-3.5 mr-1" />
                            Print / PDF
                        </Button>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                toast({
                                    title: "📝 Scribe Studio Synchronized",
                                    description: `Exported residential dossier for ${marker.label} to Scribe Studio workspace.`,
                                });
                            }}
                            className="h-8 text-xs font-semibold"
                        >
                            <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-400" />
                            Send to Scribe Studio
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={onClose}
                            className="h-8 text-xs font-semibold"
                        >
                            Done
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Snapshot Comparison & Progression Measurement Dialog ──────────────────────

export function SnapshotComparisonDialog({
    snapshots,
    currentLiveScan,
    isOpen,
    onClose,
    onOpenDossier,
}: {
    snapshots: SpatialScanSnapshot[];
    currentLiveScan: SpatialScanSnapshot;
    isOpen: boolean;
    onClose: () => void;
    onOpenDossier: (marker: MapMarker) => void;
}) {
    const { toast } = useToast();
    const allAvailableSnapshots = useMemo(() => {
        return [currentLiveScan, ...snapshots];
    }, [currentLiveScan, snapshots]);

    // Baseline (Old) defaults to 30 days ago or the earliest preset
    const [baselineId, setBaselineId] = useState<string>(
        snapshots.find((s) => s.id === "snap-baseline-t30")?.id || snapshots[0]?.id || currentLiveScan.id
    );

    // Target (New) defaults to Current Live Scan
    const [targetId, setTargetId] = useState<string>(currentLiveScan.id);

    const [diffFilter, setDiffFilter] = useState<"all" | "new" | "escalated" | "cured" | "persisting">("new");

    const baselineSnapshot = useMemo(() => {
        return allAvailableSnapshots.find((s) => s.id === baselineId) || snapshots[0] || currentLiveScan;
    }, [allAvailableSnapshots, baselineId, snapshots, currentLiveScan]);

    const targetSnapshot = useMemo(() => {
        return allAvailableSnapshots.find((s) => s.id === targetId) || currentLiveScan;
    }, [allAvailableSnapshots, targetId, currentLiveScan]);

    const comparison: ProgressionComparison = useMemo(() => {
        return compareSnapshots(baselineSnapshot, targetSnapshot);
    }, [baselineSnapshot, targetSnapshot]);

    const displayedParcels = useMemo(() => {
        if (diffFilter === "new") return comparison.newParcels;
        if (diffFilter === "escalated") return comparison.escalatedParcels;
        if (diffFilter === "cured") return comparison.curedParcels;
        if (diffFilter === "persisting") return comparison.persistingParcels;
        return targetSnapshot.parcels;
    }, [diffFilter, comparison, targetSnapshot]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto bg-card border-border text-foreground shadow-2xl p-0">
                {/* Header */}
                <div className="p-6 pb-4 border-b border-border/60 bg-background/50 backdrop-blur-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                            <GitCompare className="w-5 h-5 text-cyan-400" />
                            <h2 className="text-xl font-black text-foreground tracking-tight">
                                Spatial Snapshot Comparison & Progression Analysis
                            </h2>
                        </div>
                        <Badge
                            variant="outline"
                            className={cn(
                                "font-mono text-xs font-bold px-2.5 py-1",
                                comparison.trajectoryStatus === "critical_acceleration" ? "border-rose-500/50 bg-rose-500/10 text-rose-400" :
                                comparison.trajectoryStatus === "escalating" ? "border-amber-500/50 bg-amber-500/10 text-amber-400" :
                                comparison.trajectoryStatus === "remediating" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" :
                                "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
                            )}
                        >
                            {comparison.trajectoryLabel}
                        </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Compare historical public records baselines against live spatial scans to measure residential distress accumulation, auction velocity, and curative actions.
                    </p>

                    {/* Snapshot Pickers */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-border/40">
                        <div className="space-y-1">
                            <label className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                                <span>Baseline Snapshot (Old)</span>
                            </label>
                            <select
                                value={baselineId}
                                onChange={(e) => setBaselineId(e.target.value)}
                                className="w-full h-9 text-xs bg-background border border-border rounded-lg px-2 text-foreground font-semibold"
                                aria-label="Select baseline snapshot"
                            >
                                {allAvailableSnapshots.map((snap) => (
                                    <option key={snap.id} value={snap.id}>
                                        {snap.name} ({snap.totalParcels} parcels • {formatCurrency(snap.totalDelinquencyDebt)})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[11px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                                <Target className="w-3.5 h-3.5 text-cyan-400" />
                                <span>Target Snapshot (New / Current)</span>
                            </label>
                            <select
                                value={targetId}
                                onChange={(e) => setTargetId(e.target.value)}
                                className="w-full h-9 text-xs bg-background border border-border rounded-lg px-2 text-foreground font-semibold"
                                aria-label="Select target snapshot"
                            >
                                {allAvailableSnapshots.map((snap) => (
                                    <option key={snap.id} value={snap.id}>
                                        {snap.id === currentLiveScan.id ? "📡 [Live Viewport Scan] " : ""}
                                        {snap.name} ({snap.totalParcels} parcels • {formatCurrency(snap.totalDelinquencyDebt)})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Scorecard Progression Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-6 py-4 bg-muted/20 border-b border-border text-xs">
                    {/* Parcels Delta */}
                    <div className="p-3 rounded-xl bg-card border border-border">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Distressed Parcels</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-xl font-black text-foreground font-mono">
                                {targetSnapshot.totalParcels}
                            </span>
                            <span className={cn(
                                "text-xs font-bold font-mono flex items-center",
                                comparison.parcelCountDelta > 0 ? "text-rose-400" : comparison.parcelCountDelta < 0 ? "text-emerald-400" : "text-muted-foreground"
                            )}>
                                {comparison.parcelCountDelta > 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : comparison.parcelCountDelta < 0 ? <TrendingDown className="w-3 h-3 mr-0.5" /> : null}
                                {comparison.parcelCountDelta >= 0 ? `+${comparison.parcelCountDelta}` : comparison.parcelCountDelta} ({comparison.parcelCountPercent}%)
                            </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            vs {baselineSnapshot.totalParcels} in baseline
                        </span>
                    </div>

                    {/* Delinquency Debt Delta */}
                    <div className="p-3 rounded-xl bg-card border border-border">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Total Delinquency Debt</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-lg font-black text-amber-400 font-mono">
                                {formatCurrency(targetSnapshot.totalDelinquencyDebt)}
                            </span>
                        </div>
                        <span className={cn(
                            "text-xs font-bold font-mono flex items-center mt-0.5",
                            comparison.debtDelta > 0 ? "text-rose-400" : comparison.debtDelta < 0 ? "text-emerald-400" : "text-muted-foreground"
                        )}>
                            {comparison.debtDelta >= 0 ? `+${formatCurrency(comparison.debtDelta)}` : formatCurrency(comparison.debtDelta)} ({comparison.debtPercent}%)
                        </span>
                    </div>

                    {/* High-Risk Acceleration */}
                    <div className="p-3 rounded-xl bg-card border border-border">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">High-Risk (NOD/Auction)</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-xl font-black text-foreground font-mono">
                                {targetSnapshot.highRiskCount}
                            </span>
                            <span className={cn(
                                "text-xs font-bold font-mono",
                                comparison.highRiskDelta > 0 ? "text-rose-400" : "text-emerald-400"
                            )}>
                                {comparison.highRiskDelta >= 0 ? `+${comparison.highRiskDelta}` : comparison.highRiskDelta}
                            </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            vs {baselineSnapshot.highRiskCount} in baseline
                        </span>
                    </div>

                    {/* Curative / Progression Velocity */}
                    <div className="p-3 rounded-xl bg-card border border-border">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block">Curative Progress</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-xl font-black text-emerald-400 font-mono">
                                {comparison.curedParcels.length}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-semibold">Parcels Cured</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            {comparison.newParcels.length} new distress entries
                        </span>
                    </div>
                </div>

                {/* Differential Tabs & Parcels Roster */}
                <div className="p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-xl border border-border">
                            <Button
                                size="sm"
                                variant={diffFilter === "new" ? "default" : "ghost"}
                                onClick={() => setDiffFilter("new")}
                                className="h-7 text-xs px-2.5"
                            >
                                🔴 Newly Identified ({comparison.newParcels.length})
                            </Button>
                            <Button
                                size="sm"
                                variant={diffFilter === "escalated" ? "default" : "ghost"}
                                onClick={() => setDiffFilter("escalated")}
                                className="h-7 text-xs px-2.5"
                            >
                                ⚡ Escalated to Auction ({comparison.escalatedParcels.length})
                            </Button>
                            <Button
                                size="sm"
                                variant={diffFilter === "cured" ? "default" : "ghost"}
                                onClick={() => setDiffFilter("cured")}
                                className="h-7 text-xs px-2.5"
                            >
                                🟢 Resolved / Cured ({comparison.curedParcels.length})
                            </Button>
                            <Button
                                size="sm"
                                variant={diffFilter === "persisting" ? "default" : "ghost"}
                                onClick={() => setDiffFilter("persisting")}
                                className="h-7 text-xs px-2.5"
                            >
                                🟡 Persisting ({comparison.persistingParcels.length})
                            </Button>
                            <Button
                                size="sm"
                                variant={diffFilter === "all" ? "default" : "ghost"}
                                onClick={() => setDiffFilter("all")}
                                className="h-7 text-xs px-2.5"
                            >
                                All in Target ({targetSnapshot.parcels.length})
                            </Button>
                        </div>
                    </div>

                    {/* Parcels Table */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        {displayedParcels.length === 0 ? (
                            <div className="p-8 text-center text-xs text-muted-foreground">
                                No parcels match the selected differential filter ({diffFilter}).
                            </div>
                        ) : (
                            <div className="divide-y divide-border/60 max-h-72 overflow-y-auto">
                                {displayedParcels.map((parcel) => {
                                    const photo = getPropertyPhoto(parcel);
                                    const zillowUrl = getZillowSearchUrl(parcel.address);

                                    return (
                                        <div
                                            key={String(parcel.id)}
                                            className="p-3.5 hover:bg-muted/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                                        >
                                            <div className="flex items-center gap-3">
                                                {photo ? (
                                                    <img src={photo} alt={parcel.label} className="w-14 h-12 rounded-lg object-cover border border-border shrink-0" />
                                                ) : (
                                                    <div className="w-14 h-12 rounded-lg border border-border shrink-0 flex items-center justify-center text-[9px] text-muted-foreground">No photo</div>
                                                )}
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h5 className="font-bold text-foreground">{parcel.label}</h5>
                                                        {parcel.badge && (
                                                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono text-[9px] font-bold">
                                                                {parcel.badge}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                                                        📍 {parcel.address} {parcel.apn ? `• APN: ${parcel.apn}` : ""}
                                                    </p>
                                                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1">
                                                        <span>Specs: <strong className="text-foreground">{parcel.specs || "SFR"}</strong></span>
                                                        <span>Est Val: <strong className="text-emerald-400">{parcel.estimatedValue}</strong></span>
                                                        <span>Delinquency: <strong className="text-amber-400">{parcel.delinquencyAmount}</strong></span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                                                <a
                                                    href={zillowUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="h-8 px-2.5 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-blue-400 font-bold text-xs flex items-center gap-1 transition-colors"
                                                    title="View Zillow photos and listing"
                                                >
                                                    <Home className="w-3 h-3" />
                                                    <span>Zillow</span>
                                                    <ExternalLink className="w-2.5 h-2.5" />
                                                </a>
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => onOpenDossier(parcel)}
                                                    className="h-8 text-xs font-semibold"
                                                >
                                                    <FileText className="w-3.5 h-3.5 mr-1 text-amber-400" />
                                                    📝 Dossier
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <DialogFooter className="flex flex-row items-center justify-between sm:justify-between w-full p-4 border-t border-border bg-muted/40">
                    <div className="text-xs text-muted-foreground font-mono">
                        Trajectory: <strong className="text-foreground">{comparison.trajectoryLabel}</strong>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        onClick={onClose}
                        className="h-8 text-xs font-semibold"
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Mortgage & Underwriting Trends Analytics Modal ────────────────────────────

export function MortgageTrendsDialog({
    isOpen,
    onClose,
    markers,
    onOpenDossier,
}: {
    isOpen: boolean;
    onClose: () => void;
    markers: MapMarker[];
    onOpenDossier: (marker: MapMarker) => void;
}) {
    const { toast } = useToast();
    const [selectedTapeFilters, setSelectedTapeFilters] = useState<string[]>(["all"]);
    const [tapeMatchMode, setTapeMatchMode] = useState<"any" | "all">("any");
    const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

    const trends = useMemo(() => {
        return computeUnderwritingTrends(markers);
    }, [markers]);

    const handleToggleTapeFilter = (filterKey: string) => {
        if (filterKey === "all") {
            setSelectedTapeFilters(["all"]);
            return;
        }
        if (selectedTapeFilters.includes("all")) {
            setSelectedTapeFilters([filterKey]);
            return;
        }
        if (selectedTapeFilters.includes(filterKey)) {
            const next = selectedTapeFilters.filter(k => k !== filterKey);
            setSelectedTapeFilters(next.length === 0 ? ["all"] : next);
        } else {
            setSelectedTapeFilters([...selectedTapeFilters, filterKey]);
        }
    };

    const isTapeFilterActive = (filterKey: string) => {
        return selectedTapeFilters.includes("all") ? filterKey === "all" : selectedTapeFilters.includes(filterKey);
    };

    const filteredTape = useMemo(() => {
        return markers.filter((m) => {
            if (selectedTapeFilters.includes("all")) return true;
            if (selectedTapeFilters.length === 0) return false;

            const rate = m.interestRate;
            const ltv = m.ltv;

            const checks = selectedTapeFilters.map((f) => {
                if (f === "subjectTo") return isSubjectToCandidate(m);
                if (f === "lowRate") return typeof rate === "number" && rate < 4.0;
                if (f === "highRate") return typeof rate === "number" && rate >= 5.0;
                if (f === "highLtv") return typeof ltv === "number" && ltv >= 70;
                if (f === "deepEquity") return typeof ltv === "number" && ltv <= 65;
                return true;
            });

            return tapeMatchMode === "all" ? checks.every(Boolean) : checks.some(Boolean);
        });
    }, [markers, selectedTapeFilters, tapeMatchMode]);

    const handleDownloadCsv = () => {
        const csvContent = generateLoanTapeCsv(markers);
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Oddjob_Distress_Loan_Tape_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast({
            title: "📥 Loan Tape Exported",
            description: `Generated investor-grade CSV loan tape across ${markers.length} properties.`,
        });
    };

    const handleCopySummary = () => {
        const summary = `ODDJOB MORTGAGE & UNDERWRITING COHORT TRENDS
Properties Analyzed: ${trends.totalProperties}
Average Note Interest Rate: ${trends.avgInterestRate}%
Sub-4% Lockdown Rate Share: ${trends.lowRateCount} (${trends.lowRateSharePercent}%)
Total Remaining Principal Balance: ${formatCurrency(trends.totalRemainingPrincipal)}
Average Remaining Debt: ${formatCurrency(trends.avgRemainingPrincipal)}
Average Loan-to-Value (LTV): ${trends.avgLTV}%
Estimated Gross Equity Spread: ${formatCurrency(trends.avgEquitySpread * trends.totalProperties)}
Purchase Vintage Range: ${trends.earliestPurchaseDate} to ${trends.latestPurchaseDate}
Subject-To Prime Targets (<3.8% rate, <75% LTV): ${trends.subjectToPrimeCandidates.length} properties`;

        navigator.clipboard.writeText(summary);
        setCopiedSummary(true);
        setTimeout(() => setCopiedSummary(false), 2000);
        toast({
            title: "📋 Copied Trend Summary",
            description: "Mortgage underwriting trends summary copied to clipboard.",
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 gap-0 border-primary/30">
                <DialogHeader className="p-6 pb-4 border-b border-border bg-gradient-to-r from-background via-card to-background">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-xl font-bold">
                                📈
                            </div>
                            <div>
                                <DialogTitle className="text-lg font-black tracking-tight text-foreground flex items-center gap-2">
                                    Distressed Mortgage &amp; Underwriting Trends
                                    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
                                        {trends.totalProperties} Properties Active
                                    </Badge>
                                </DialogTitle>
                                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                                    Deep cohort intelligence on note interest rates, loan types, remaining principal balances, and Subject-To equity spreads.
                                </DialogDescription>
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                <div className="p-6 space-y-6">
                    {/* Top KPI Metric Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3.5 rounded-xl bg-card border border-border/70 space-y-1">
                            <div className="flex items-center justify-between text-muted-foreground text-xs">
                                <span>Avg Note Rate</span>
                                <Percent className="w-3.5 h-3.5 text-cyan-400" />
                            </div>
                            <div className="text-2xl font-black text-foreground font-mono">
                                {trends.avgInterestRate}%
                            </div>
                            <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                                <span>{trends.lowRateSharePercent}% Sub-4.0% Lock</span>
                            </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-card border border-border/70 space-y-1">
                            <div className="flex items-center justify-between text-muted-foreground text-xs">
                                <span>Total Remaining Debt</span>
                                <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                            <div className="text-2xl font-black text-foreground font-mono truncate" title={formatCurrency(trends.totalRemainingPrincipal)}>
                                {formatCurrency(trends.totalRemainingPrincipal)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                                Avg {formatCurrency(trends.avgRemainingPrincipal)} / note
                            </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-card border border-border/70 space-y-1">
                            <div className="flex items-center justify-between text-muted-foreground text-xs">
                                <span>Cohort Avg LTV</span>
                                <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
                            </div>
                            <div className="text-2xl font-black text-foreground font-mono">
                                {trends.avgLTV}%
                            </div>
                            <div className="text-[10px] text-cyan-400">
                                ~{100 - trends.avgLTV}% Equity Cushion
                            </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-card border border-border/70 space-y-1">
                            <div className="flex items-center justify-between text-muted-foreground text-xs">
                                <span>Subject-To Prime</span>
                                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                            <div className="text-2xl font-black text-emerald-400 font-mono">
                                {trends.subjectToPrimeCandidates.length}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                                Rate &lt;3.8% &amp; LTV &lt;75%
                            </div>
                        </div>
                    </div>

                    {/* Rate, Vintage & Program Distributions */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* 1. Note Rate Bands */}
                        <div className="p-4 rounded-xl bg-card border border-border/70 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                                    <Percent className="w-3.5 h-3.5" />
                                    Interest Rate Bands
                                </h4>
                                <span className="text-[10px] text-muted-foreground font-mono">Distribution</span>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div>
                                    <div className="flex justify-between text-[11px] mb-1">
                                        <span className="text-emerald-400 font-semibold">&lt; 3.5% (Golden Handcuffs)</span>
                                        <span className="font-mono text-muted-foreground">{trends.rateDistribution.low} props</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-background overflow-hidden border border-border/40">
                                        <div
                                            className="h-full bg-emerald-500 rounded-full transition-all"
                                            style={{ width: `${trends.totalProperties > 0 ? (trends.rateDistribution.low / trends.totalProperties) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <div className="flex justify-between text-[11px] mb-1">
                                        <span className="text-cyan-400 font-semibold">3.5% - 5.0% (Moderate)</span>
                                        <span className="font-mono text-muted-foreground">{trends.rateDistribution.medium} props</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-background overflow-hidden border border-border/40">
                                        <div
                                            className="h-full bg-cyan-500 rounded-full transition-all"
                                            style={{ width: `${trends.totalProperties > 0 ? (trends.rateDistribution.medium / trends.totalProperties) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <div className="flex justify-between text-[11px] mb-1">
                                        <span className="text-rose-400 font-semibold">&gt; 5.0% (High / DSCR / Non-QM)</span>
                                        <span className="font-mono text-muted-foreground">{trends.rateDistribution.high} props</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-background overflow-hidden border border-border/40">
                                        <div
                                            className="h-full bg-rose-500 rounded-full transition-all"
                                            style={{ width: `${trends.totalProperties > 0 ? (trends.rateDistribution.high / trends.totalProperties) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 2. Purchase Vintages */}
                        <div className="p-4 rounded-xl bg-card border border-border/70 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5" />
                                    Purchase Vintages
                                </h4>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                    {trends.earliestPurchaseDate.slice(0, 4)} - {trends.latestPurchaseDate.slice(0, 4)}
                                </span>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div>
                                    <div className="flex justify-between text-[11px] mb-1">
                                        <span className="text-foreground font-semibold">Pre-2020 (Seasoned Equity)</span>
                                        <span className="font-mono text-muted-foreground">{trends.vintageDistribution.pre2020} props</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-background overflow-hidden border border-border/40">
                                        <div
                                            className="h-full bg-amber-500 rounded-full transition-all"
                                            style={{ width: `${trends.totalProperties > 0 ? (trends.vintageDistribution.pre2020 / trends.totalProperties) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <div className="flex justify-between text-[11px] mb-1">
                                        <span className="text-emerald-400 font-semibold">2020-2021 (Low Rate Peak)</span>
                                        <span className="font-mono text-muted-foreground">{trends.vintageDistribution.pandemicBoom} props</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-background overflow-hidden border border-border/40">
                                        <div
                                            className="h-full bg-emerald-400 rounded-full transition-all"
                                            style={{ width: `${trends.totalProperties > 0 ? (trends.vintageDistribution.pandemicBoom / trends.totalProperties) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <div className="flex justify-between text-[11px] mb-1">
                                        <span className="text-purple-400 font-semibold">2022+ (Rate Shock Era)</span>
                                        <span className="font-mono text-muted-foreground">{trends.vintageDistribution.rateShock} props</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-background overflow-hidden border border-border/40">
                                        <div
                                            className="h-full bg-purple-500 rounded-full transition-all"
                                            style={{ width: `${trends.totalProperties > 0 ? (trends.vintageDistribution.rateShock / trends.totalProperties) * 100 : 0}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 3. Loan Program Types */}
                        <div className="p-4 rounded-xl bg-card border border-border/70 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                                    <Building2 className="w-3.5 h-3.5" />
                                    Loan Programs
                                </h4>
                                <span className="text-[10px] text-muted-foreground font-mono">Product Mix</span>
                            </div>
                            <div className="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                                {Object.entries(trends.loanTypeBreakdown).map(([program, count]) => (
                                    <div key={program} className="flex items-center justify-between p-1.5 rounded-lg bg-background/50 border border-border/30">
                                        <span className="text-[11px] font-medium text-foreground truncate max-w-[170px]" title={program}>
                                            {program}
                                        </span>
                                        <Badge variant="outline" className="font-mono text-[10px] border-primary/30">
                                            {count} ({trends.totalProperties > 0 ? Math.round((count / trends.totalProperties) * 100) : 0}%)
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Subject-To Prime Opportunity Spotlight */}
                    {trends.subjectToPrimeCandidates.length > 0 && (
                        <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">⭐</span>
                                    <div>
                                        <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                                            Subject-To Acquisition Opportunities ({trends.subjectToPrimeCandidates.length} Identified)
                                        </h4>
                                        <p className="text-[11px] text-muted-foreground">
                                            Existing primary mortgages with interest rates &lt; 3.8% and healthy equity cushions (&gt; 25%).
                                        </p>
                                    </div>
                                </div>
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                                    Assumption Ready
                                </Badge>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                {trends.subjectToPrimeCandidates.map((m) => (
                                    <div key={m.id} className="p-2.5 rounded-lg bg-card/80 border border-emerald-500/30 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-foreground text-xs truncate">{m.label}</div>
                                            <div className="text-[10px] text-muted-foreground font-mono truncate">{m.address}</div>
                                            <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                                                <span className="text-emerald-400 font-bold">{m.interestRate}% Rate</span>
                                                <span className="text-muted-foreground">•</span>
                                                <span className="text-foreground">{m.equitySpread}</span>
                                            </div>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                                onClose();
                                                onOpenDossier(m);
                                            }}
                                            className="h-7 text-[10px] shrink-0 font-semibold"
                                        >
                                            View Dossier
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Filterable Underwriting Loan Tape Table */}
                    <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                    Underwriting Loan Tape
                                </h4>
                                <Badge variant="outline" className="font-mono text-[10px]">
                                    {filteredTape.length} of {markers.length} Rows
                                </Badge>
                            </div>

                            {/* Tape Filters */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                <Button
                                    size="sm"
                                    variant={selectedTapeFilters.includes("all") ? "default" : "outline"}
                                    onClick={() => handleToggleTapeFilter("all")}
                                    className="h-7 text-[10px] px-2 font-semibold"
                                >
                                    All ({markers.length})
                                </Button>
                                <Button
                                    size="sm"
                                    variant={isTapeFilterActive("subjectTo") ? "default" : "outline"}
                                    onClick={() => handleToggleTapeFilter("subjectTo")}
                                    className={cn("h-7 text-[10px] px-2", isTapeFilterActive("subjectTo") ? "" : "text-emerald-400")}
                                >
                                    ⭐ Prime Subject-To ({trends.subjectToPrimeCandidates.length})
                                </Button>
                                <Button
                                    size="sm"
                                    variant={isTapeFilterActive("lowRate") ? "default" : "outline"}
                                    onClick={() => handleToggleTapeFilter("lowRate")}
                                    className="h-7 text-[10px] px-2"
                                >
                                    Low Rate (&lt;4%)
                                </Button>
                                <Button
                                    size="sm"
                                    variant={isTapeFilterActive("highRate") ? "default" : "outline"}
                                    onClick={() => handleToggleTapeFilter("highRate")}
                                    className="h-7 text-[10px] px-2"
                                >
                                    High Rate (&gt;5%)
                                </Button>
                                <Button
                                    size="sm"
                                    variant={isTapeFilterActive("highLtv") ? "default" : "outline"}
                                    onClick={() => handleToggleTapeFilter("highLtv")}
                                    className="h-7 text-[10px] px-2"
                                >
                                    High LTV (&gt;70%)
                                </Button>
                                <Button
                                    size="sm"
                                    variant={isTapeFilterActive("deepEquity") ? "default" : "outline"}
                                    onClick={() => handleToggleTapeFilter("deepEquity")}
                                    className="h-7 text-[10px] px-2 text-cyan-400"
                                >
                                    Deep Equity (&gt;35%)
                                </Button>

                                {!selectedTapeFilters.includes("all") && selectedTapeFilters.length > 1 && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setTapeMatchMode(m => m === "any" ? "all" : "any")}
                                        className="h-6 text-[10px] px-1.5 font-mono text-cyan-400 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20"
                                        title="Toggle between matching ANY selected criterion (OR) or ALL selected criteria (AND)"
                                    >
                                        Mode: {tapeMatchMode.toUpperCase()}
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Table */}
                        <div className="rounded-xl border border-border overflow-hidden bg-card/60">
                            <div className="overflow-x-auto max-h-72">
                                <table className="w-full text-[11px] text-left">
                                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                        <tr>
                                            <th className="p-2.5">Property &amp; Address</th>
                                            <th className="p-2.5">Purchase Date</th>
                                            <th className="p-2.5">Note Rate</th>
                                            <th className="p-2.5">Loan Program</th>
                                            <th className="p-2.5">Remaining Principal</th>
                                            <th className="p-2.5">Equity Cushion</th>
                                            <th className="p-2.5">LTV</th>
                                            <th className="p-2.5">Monthly P&amp;I</th>
                                            <th className="p-2.5 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40 font-mono">
                                        {filteredTape.map((m) => {
                                            const isSubjectTo = isSubjectToCandidate(m);
                                            return (
                                                <tr key={m.id} className="hover:bg-accent/40 transition-colors">
                                                    <td className="p-2.5 font-sans">
                                                        <div className="font-bold text-foreground flex items-center gap-1.5">
                                                            {m.label}
                                                            {isSubjectTo && (
                                                                <span title="Prime Subject-To Target" className="text-emerald-400 text-xs">⭐</span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                                                            {m.address}
                                                        </div>
                                                    </td>
                                                    <td className="p-2.5 text-muted-foreground">
                                                        {m.purchaseDate || "2020-08-14"}
                                                    </td>
                                                    <td className="p-2.5">
                                                        <span className={cn(
                                                            "font-bold px-1.5 py-0.5 rounded text-[10px]",
                                                            (m.interestRate ?? NaN) < 3.5 ? "bg-emerald-500/20 text-emerald-400" :
                                                            (m.interestRate ?? NaN) <= 5.0 ? "bg-cyan-500/20 text-cyan-400" :
                                                            "bg-rose-500/20 text-rose-400"
                                                        )}>
                                                            {m.interestRate ? `${m.interestRate}%` : "3.125%"}
                                                        </span>
                                                    </td>
                                                    <td className="p-2.5 font-sans text-muted-foreground text-[10px] truncate max-w-[130px]" title={m.loanType || "30-Yr Fixed"}>
                                                        {m.loanType || "30-Yr Fixed"}
                                                    </td>
                                                    <td className="p-2.5 font-bold text-foreground">
                                                        {m.remainingPrincipal || "Not recorded"}
                                                    </td>
                                                    <td className="p-2.5 text-emerald-400 text-[10px]">
                                                        {m.equitySpread || "Not recorded"}
                                                    </td>
                                                    <td className="p-2.5">
                                                        <span className={cn(
                                                            "font-bold",
                                                            (m.ltv ?? NaN) > 75 ? "text-rose-400" : "text-foreground"
                                                        )}>
                                                            {m.ltv ? `${m.ltv}%` : "58%"}
                                                        </span>
                                                    </td>
                                                    <td className="p-2.5 text-muted-foreground text-[10px]">
                                                        {m.monthlyPayment || "Not recorded"}
                                                    </td>
                                                    <td className="p-2.5 text-right font-sans">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => {
                                                                    onClose();
                                                                    onOpenDossier(m);
                                                                }}
                                                                className="h-6 text-[10px] px-1.5 text-amber-400 hover:text-amber-300"
                                                                title="View full dossier"
                                                            >
                                                                Dossier
                                                            </Button>
                                                            <a
                                                                href={getZillowSearchUrl(m.address)}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="p-1 rounded text-blue-400 hover:text-blue-300 text-xs"
                                                                title="Zillow Listing"
                                                            >
                                                                <Home className="w-3 h-3" />
                                                            </a>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <DialogFooter className="flex flex-row items-center justify-between sm:justify-between w-full p-4 border-t border-border bg-muted/40">
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleDownloadCsv}
                            className="h-8 text-xs font-semibold"
                            title="Download full loan tape in CSV format"
                        >
                            <Download className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                            Export Loan Tape (.csv)
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleCopySummary}
                            className="h-8 text-xs font-semibold"
                            title="Copy trend summary metrics to clipboard"
                        >
                            {copiedSummary ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                            {copiedSummary ? "Copied" : "Copy Summary"}
                        </Button>
                    </div>

                    <Button
                        type="button"
                        size="sm"
                        onClick={onClose}
                        className="h-8 text-xs font-semibold"
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export const DISTRESS_SIGNAL_CRITERIA = [
    { id: "nod", label: "Notice of Default (NOD)", icon: "⚠️", matcher: (badge: string) => {
        const b = (badge || "").toLowerCase();
        return b.includes("notice of default") || b.includes("default");
    }},
    { id: "auction", label: "Scheduled Trustee Auction", icon: "🔨", matcher: (badge: string) => {
        const b = (badge || "").toLowerCase();
        return b.includes("auction") || b.includes("trustee");
    }},
    { id: "tax", label: "Delinquent Property Taxes", icon: "💰", matcher: (badge: string) => {
        const b = (badge || "").toLowerCase();
        return b.includes("tax");
    }},
    { id: "substandard", label: "Substandard / Red-Tag", icon: "🚫", matcher: (badge: string) => {
        const b = (badge || "").toLowerCase();
        return b.includes("substandard") || b.includes("red-tag");
    }},
    { id: "probate", label: "Probate Acceleration", icon: "⚖️", matcher: (badge: string) => {
        const b = (badge || "").toLowerCase();
        return b.includes("probate");
    }},
];

export function SpatialH3MapPanel({
    initialLat,
    initialLng,
    initialQuery,
    markers: propMarkers,
    onSelectMarker,
    onSendToCrew,
}: {
    initialLat?: number;
    initialLng?: number;
    initialQuery?: string;
    markers?: MapMarker[];
    onSelectMarker?: (marker: MapMarker) => void;
    onSendToCrew?: (marker: MapMarker, prompt?: string) => void;
} = {}) {
    const { toast } = useToast();

    // Check URL parameters for explicit positioning (e.g. ?lat=34.0522&lng=-118.2437&query=Los+Angeles,+CA)
    const urlCoords = useMemo(() => {
        if (typeof window === "undefined") return null;
        try {
            const params = new URLSearchParams(window.location.search);
            const lat = params.get("lat");
            const lng = params.get("lng");
            const q = params.get("query") || params.get("q");
            if (lat && lng && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
                return { lat: Number(lat), lng: Number(lng), query: q || undefined };
            }
        } catch {}
        return null;
    }, []);

    const defaultLat = urlCoords?.lat ?? initialLat ?? 34.0522;
    const defaultLng = urlCoords?.lng ?? initialLng ?? -118.2437;
    const defaultQuery = urlCoords?.query ?? initialQuery ?? "Los Angeles, CA";

    const [centerLat, setCenterLat] = useState<number>(defaultLat);
    const [centerLng, setCenterLng] = useState<number>(defaultLng);
    const [zoom, setZoom] = useState<number>(11);
    const [searchQuery, setSearchQuery] = useState<string>(defaultQuery);

    useEffect(() => {
        if (urlCoords) {
            setCenterLat(urlCoords.lat);
            setCenterLng(urlCoords.lng);
            if (urlCoords.query) setSearchQuery(urlCoords.query);
        } else if (initialLat !== undefined && initialLng !== undefined) {
            setCenterLat(initialLat);
            setCenterLng(initialLng);
            if (initialQuery) setSearchQuery(initialQuery);
        }
    }, [initialLat, initialLng, initialQuery, urlCoords]);

    const [isLocating, setIsLocating] = useState<boolean>(false);
    const [isPrewarming, setIsPrewarming] = useState<boolean>(false);
    const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);
    const [inspectorTab, setInspectorTab] = useState<'overview' | 'payload'>('overview');
    const [copiedPayload, setCopiedPayload] = useState<boolean>(false);
    // Markers are real signal events with a position (or what the caller
    // passes). There used to be a hardcoded list of "distressed" OC homes, a
    // generator that invented three more on every map move, and a
    // "Counterfactual Proof" button that showed Math.random() Brier scores as
    // "Verified". All removed.
    const { data: signalEvents } = useQuery<any[]>({
        queryKey: ["/api/event-primitives?limit=100"],
        enabled: !propMarkers,
    });
    const sourceMarkers = useMemo(
        () => propMarkers ?? markersFromSignalEvents(signalEvents),
        [propMarkers, signalEvents],
    );

    // Snapshot, Progression & Dossier States
    const [snapshots, setSnapshots] = useState<SpatialScanSnapshot[]>(INITIAL_PRESET_SNAPSHOTS);
    const [isCompareOpen, setIsCompareOpen] = useState<boolean>(false);
    const [dossierMarker, setDossierMarker] = useState<MapMarker | null>(null);
    const [isDossierOpen, setIsDossierOpen] = useState<boolean>(false);
    const [isTrendsOpen, setIsTrendsOpen] = useState<boolean>(false);

    // Dynamic Signal Filters from Signal Studio Registry
    const { filters: studioSignalFilters } = useSignalFilters();
    const activeFilterList = useMemo(() => {
        if (!studioSignalFilters || studioSignalFilters.length === 0) {
            return DISTRESS_SIGNAL_CRITERIA;
        }
        return studioSignalFilters.map((f) => ({
            id: f.id,
            label: f.label,
            icon: f.icon,
            category: f.category,
            matcher: (badge: string, raw?: any) => matchesSignalFilter(f, badge, raw),
        }));
    }, [studioSignalFilters]);

    const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
    const [selectedSignals, setSelectedSignals] = useState<string[]>(["all"]);
    const [selectedZips, setSelectedZips] = useState<string[]>(["all"]);
    const [customMarkers, setCustomMarkers] = useState<MapMarker[]>([]);
    const [newProp, setNewProp] = useState({
        label: "",
        address: "",
        zip: "",
        city: "",
        apn: "",
        specs: "",
        estimatedValue: "",
        badge: "",
        lat: "",
        lng: "",
    });

    // Moving the map no longer "discovers" parcels; there is nothing to scan
    // but the signals already loaded. Kept so the recentring call sites stay simple.
    const triggerViewportScan = useCallback((_lat: number, _lng: number, _force = false) => {}, []);

    // Auto H3 resolution sync based on map zoom
    const selectedRes = useMemo(() => {
        if (zoom <= 11) return 6; // City level ~36km²
        if (zoom <= 13) return 7; // District level ~5km²
        if (zoom <= 15) return 8; // Neighborhood level ~0.7km²
        return 9; // Block level ~0.1km²
    }, [zoom]);

    // Multi-Domain Global Hub Presets
    const LOCATION_PRESETS = [
        // ── Real Estate & Operations Metros ──
        { label: "Los Angeles, CA", group: "Operations", lat: 34.0522, lng: -118.2437 },
        { label: "Orange County, CA", group: "Real Estate", lat: 33.7200, lng: -117.8800 },
        { label: "San Diego County, CA", group: "Real Estate", lat: 32.7157, lng: -117.1611 },
        { label: "Miami-Dade, FL", group: "Real Estate", lat: 25.7617, lng: -80.1918 },
        { label: "Dallas-Fort Worth, TX", group: "Real Estate", lat: 32.7767, lng: -96.7970 },
        { label: "Maricopa County, AZ", group: "Real Estate", lat: 33.4484, lng: -112.0740 },
        // ── Maritime & Logistics Hubs ──
        { label: "Port of LA / Long Beach", group: "Maritime", lat: 33.7400, lng: -118.2600 },
        { label: "Port of Rotterdam (EU)", group: "Maritime", lat: 51.9244, lng: 4.4777 },
        { label: "Singapore Strait Hub", group: "Maritime", lat: 1.29027, lng: 103.8519 },
        // ── Energy & Critical Infrastructure ──
        { label: "Texas ERCOT Power Hub", group: "Energy", lat: 31.9686, lng: -99.9018 },
        { label: "Pacific Northwest Grid", group: "Energy", lat: 45.5152, lng: -122.6784 },
    ];
    const CITY_PRESETS = LOCATION_PRESETS;

    const availableZips = useMemo(() => {
        const set = new Set<string>();
        [...sourceMarkers, ...customMarkers].forEach(m => {
            if (m.zip) set.add(m.zip);
        });
        return Array.from(set).sort();
    }, [sourceMarkers, customMarkers]);

    const activeMarkers: MapMarker[] = useMemo(() => {
        const base = [...sourceMarkers, ...customMarkers];
        const unique = Array.from(new Map(base.map(m => [String(m.id), m])).values());
        return unique
            .filter((m) => {
                // ZIP Code filtering
                const isAllZips = selectedZips.includes("all") || (availableZips.length > 0 && selectedZips.length === availableZips.length);
                if (!isAllZips) {
                    if (selectedZips.length === 0) return false;
                    if (!m.zip || !selectedZips.includes(m.zip)) return false;
                }

                // Distress / Signal Criteria filtering
                const isAllSignals = selectedSignals.includes("all") || selectedSignals.length === activeFilterList.length;
                if (!isAllSignals) {
                    if (selectedSignals.length === 0) return false;
                    const badgeLower = (m.badge || "").toLowerCase();
                    const matchesAny = selectedSignals.some(sigId => {
                        const crit = activeFilterList.find(c => c.id === sigId);
                        return crit ? crit.matcher(badgeLower, m) : false;
                    });
                    if (!matchesAny) return false;
                }

                return true;
            })
            .map((m) => ({
                ...m,
                onClick: () => {
                    setSelectedMarker(m);
                    onSelectMarker?.(m);
                },
            }));
    }, [sourceMarkers, customMarkers, selectedZips, selectedSignals, availableZips, onSelectMarker]);

    // Dynamic auto-fit to active signals
    const handleFitSignals = useCallback(() => {
        const markersWithCoords = activeMarkers.filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lng));
        if (markersWithCoords.length === 0) {
            toast({
                title: "No Signals Plotted",
                description: "There are currently no active signals matching the filter criteria to fit to.",
            });
            return;
        }
        const avgLat = markersWithCoords.reduce((acc, m) => acc + m.lat, 0) / markersWithCoords.length;
        const avgLng = markersWithCoords.reduce((acc, m) => acc + m.lng, 0) / markersWithCoords.length;
        setCenterLat(Number(avgLat.toFixed(4)));
        setCenterLng(Number(avgLng.toFixed(4)));
        setZoom(12);
        toast({
            title: "📍 Viewport Fitted to Signals",
            description: `Centered on ${markersWithCoords.length} active signals (${avgLat.toFixed(4)}°N, ${avgLng.toFixed(4)}°W).`,
        });
    }, [activeMarkers, toast]);

    const handleAddCustomProperty = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProp.label || !newProp.address) {
            toast({
                title: "Incomplete Property Info",
                description: "Please specify a property title and physical street address.",
                variant: "destructive",
            });
            return;
        }

        // A position must come from the user or a known ZIP centroid. It used to
        // fall back to a random point near the map centre, and the APN, value,
        // city, ZIP and a "Notice of Default" badge were filled in when left blank.
        const extractedZip = newProp.zip || newProp.address.match(/\b\d{5}\b/)?.[0] || "";
        const zipEntry = extractedZip ? ZIP_CODE_DIRECTORY[extractedZip] : undefined;
        const typedLat = parseFloat(newProp.lat);
        const typedLng = parseFloat(newProp.lng);
        const latNum = Number.isFinite(typedLat) ? typedLat : zipEntry?.lat;
        const lngNum = Number.isFinite(typedLng) ? typedLng : zipEntry?.lng;
        if (latNum === undefined || lngNum === undefined) {
            toast({
                title: "Location needed",
                description: "Enter latitude and longitude, or a ZIP code this map knows, so the property is placed where it actually is.",
                variant: "destructive",
            });
            return;
        }

        const created: MapMarker = {
            id: `custom-res-${Date.now()}`,
            lat: latNum,
            lng: lngNum,
            type: "distress",
            label: newProp.label,
            address: newProp.address,
            zip: extractedZip || undefined,
            city: newProp.city || zipEntry?.city || undefined,
            state: zipEntry?.state,
            apn: newProp.apn || undefined,
            specs: newProp.specs || undefined,
            estimatedValue: newProp.estimatedValue || undefined,
            badge: newProp.badge || undefined,
            sublabel: ["Entered by you — unverified", newProp.apn && `APN ${newProp.apn}`, newProp.specs, newProp.estimatedValue && `${newProp.estimatedValue} est. value`]
                .filter(Boolean)
                .join(" • "),
            jurisdiction: zipEntry?.county,
        };
        setCustomMarkers(prev => [created, ...prev]);
        setSelectedMarker(created);
        setCenterLat(latNum);
        setCenterLng(lngNum);
        setIsConfigOpen(false);
        setNewProp({ label: "", address: "", zip: "", city: "", apn: "", specs: "", estimatedValue: "", badge: "", lat: "", lng: "" });
        toast({
            title: "Property added",
            description: `"${created.label}" added to this map. It is your entry, not a public record.`,
        });
    };

    const handleCityJump = (city: { lat: number; lng: number; label: string }) => {
        setCenterLat(city.lat);
        setCenterLng(city.lng);
        setSearchQuery(city.label);
        setSelectedZips(["all"]);
        triggerViewportScan(city.lat, city.lng, true);
    };

    const currentLiveScan: SpatialScanSnapshot = useMemo(() => {
        return createSnapshotFromState(
            `Live Viewport Scan (${activeMarkers.length} parcels)`,
            activeMarkers,
            centerLat,
            centerLng,
            zoom,
            selectedZips.join(","),
            selectedSignals.join(","),
            "Markers in the current viewport."
        );
    }, [activeMarkers, centerLat, centerLng, zoom, selectedZips, selectedSignals]);

    const handleTakeSnapshot = () => {
        const timestampStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const snapName = `Scan ${searchQuery} (${activeMarkers.length} Parcels) • ${timestampStr}`;
        const newSnap = createSnapshotFromState(
            snapName,
            activeMarkers,
            centerLat,
            centerLng,
            zoom,
            selectedZips.join(","),
            selectedSignals.join(",")
        );
        setSnapshots((prev) => [newSnap, ...prev]);
        toast({
            title: "📸 Snapshot Captured",
            description: `Saved "${newSnap.name}" with ${newSnap.totalParcels} distressed parcels (${formatCurrency(newSnap.totalDelinquencyDebt)} total debt). Ready for comparison.`,
        });
    };

    const handleOpenDossier = (marker: MapMarker) => {
        setDossierMarker(marker);
        setIsDossierOpen(true);
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const q = searchQuery.toLowerCase().trim();
        if (!q) return;

        // 1. Check for 5-digit ZIP code
        const zipMatch = q.match(/\b\d{5}\b/);
        if (zipMatch) {
            const zip = zipMatch[0];
            const entry = ZIP_CODE_DIRECTORY[zip];
            if (entry) {
                setCenterLat(entry.lat);
                setCenterLng(entry.lng);
                setZoom(14);
                setSelectedZips([zip]);
                toast({
                    title: `📍 ZIP Code ${zip} Located`,
                    description: `Centered on ${entry.city}, ${entry.state} (${entry.county}). Auto-scanning distressed parcels.`,
                });
                triggerViewportScan(entry.lat, entry.lng, true);
                return;
            }
        }

        // 2. Check presets
        const foundCity = CITY_PRESETS.find(c => c.label.toLowerCase().includes(q));
        if (foundCity) {
            setCenterLat(foundCity.lat);
            setCenterLng(foundCity.lng);
            setZoom(13);
            setSelectedZips(["all"]);
            triggerViewportScan(foundCity.lat, foundCity.lng, true);
            return;
        }

        // 3. Check marker labels, addresses, zip codes
        const foundMarker = activeMarkers.find(m =>
            m.label?.toLowerCase().includes(q) ||
            m.address?.toLowerCase().includes(q) ||
            m.zip === q ||
            m.city?.toLowerCase().includes(q)
        );
        if (foundMarker) {
            setCenterLat(foundMarker.lat);
            setCenterLng(foundMarker.lng);
            setZoom(15);
            setSelectedMarker(foundMarker);
            toast({
                title: `📍 Matched Property`,
                description: `${foundMarker.label} • ${foundMarker.address}`,
            });
            return;
        }

        // 4. Fallback search across directory cities
        const matchedEntry = Object.values(ZIP_CODE_DIRECTORY).find(
            e => e.city.toLowerCase().includes(q) || e.county.toLowerCase().includes(q)
        );
        if (matchedEntry) {
            setCenterLat(matchedEntry.lat);
            setCenterLng(matchedEntry.lng);
            setZoom(13);
            setSelectedZips([matchedEntry.zip]);
            toast({
                title: `📍 Located ${matchedEntry.city}, ${matchedEntry.state}`,
                description: `ZIP ${matchedEntry.zip} • Scanning distressed residential inventory.`,
            });
            triggerViewportScan(matchedEntry.lat, matchedEntry.lng, true);
            return;
        }

        toast({
            title: `Search: "${searchQuery}"`,
            description: `Auto-scanning nearby distress signals in active viewport.`,
        });
        triggerViewportScan(centerLat, centerLng, true);
    };

    const handleUseMyLocation = () => {
        if (!navigator.geolocation) return;
        setIsLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = Number(pos.coords.latitude.toFixed(4));
                const lng = Number(pos.coords.longitude.toFixed(4));
                setCenterLat(lat);
                setCenterLng(lng);
                setIsLocating(false);
                triggerViewportScan(lat, lng, true);
            },
            () => setIsLocating(false)
        );
    };

    const [useGaussianKernel, setUseGaussianKernel] = useState<boolean>(true);

    // Generate genuine Uber H3 Cell Index covering active residential markers + regional cluster
    const hexCells: HexCell[] = useMemo(() => {
        try {
            const cellsMap = new Map<string, number>();

            // 1. Central county regional cluster disk
            const originIndex = latLngToCell(centerLat, centerLng, selectedRes);
            const centerDisk = gridDisk(originIndex, 2);
            centerDisk.forEach((h3Index, idx) => {
                const risk = idx === 0 ? 0.85 : Number((0.85 * Math.exp(-Math.pow((idx + 1) * 300, 2) / (2 * Math.pow(600, 2)))).toFixed(2));
                cellsMap.set(h3Index, Math.max(cellsMap.get(h3Index) || 0, risk));
            });

            // 2. Add H3 cell disk for each active residential property marker
            activeMarkers.forEach((marker) => {
                try {
                    const markerCell = latLngToCell(marker.lat, marker.lng, selectedRes);
                    const markerDisk = gridDisk(markerCell, 1);
                    markerDisk.forEach((cellIdx, diskIdx) => {
                        const cellRisk = diskIdx === 0 ? 0.92 : 0.65;
                        cellsMap.set(cellIdx, Math.max(cellsMap.get(cellIdx) || 0, cellRisk));
                    });
                } catch {
                    // ignore individual cell error
                }
            });

            return Array.from(cellsMap.entries()).map(([h3Index, risk]) => ({
                h3Index,
                risk,
            }));
        } catch {
            return [];
        }
    }, [centerLat, centerLng, selectedRes, activeMarkers]);

    return (
        <div className="space-y-6">
            {/* Top Command HUD */}
            <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-background via-card to-background p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary text-xl font-bold">
                                🗺️
                            </div>
                            <div>
                                <h2 className="text-xl font-black tracking-tight text-foreground flex items-center gap-2">
                                    Uber H3 Spatial Tiling & Mapbox Engine
                                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">GeoJSON Layered</Badge>
                                </h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    High-precision Mapbox vector tiling with GeoJSON H3 polygon layers locked directly to Earth coordinates.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Generic Viewport Scope & Location Jumps */}
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground mr-1">Scope Level:</span>
                        <Button
                            size="sm"
                            variant={zoom <= 9 ? "default" : "outline"}
                            onClick={() => setZoom(7)}
                            className="h-8 text-xs font-semibold rounded-lg"
                        >
                            🌐 Macro (Global)
                        </Button>
                        <Button
                            size="sm"
                            variant={zoom > 9 && zoom <= 13 ? "default" : "outline"}
                            onClick={() => setZoom(11)}
                            className="h-8 text-xs font-semibold rounded-lg"
                        >
                            🗺️ Regional Cluster
                        </Button>
                        <Button
                            size="sm"
                            variant={zoom > 13 ? "default" : "outline"}
                            onClick={() => setZoom(14)}
                            className="h-8 text-xs font-semibold rounded-lg"
                        >
                            🎯 Micro Target
                        </Button>

                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleFitSignals}
                            className="h-8 text-xs font-semibold rounded-lg border-cyan-500/40 text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 shadow-xs"
                            title="Auto-fit viewport to centroid of all active signals"
                        >
                            📍 Fit Signals ({activeMarkers.length})
                        </Button>

                        <span className="text-xs font-semibold text-muted-foreground ml-2 mr-1">Presets:</span>
                        {CITY_PRESETS.slice(0, 5).map(city => (
                            <Button
                                key={city.label}
                                size="sm"
                                variant={Math.abs(centerLat - city.lat) < 0.01 && Math.abs(centerLng - city.lng) < 0.01 ? "secondary" : "ghost"}
                                onClick={() => handleCityJump(city)}
                                className="h-8 text-xs font-medium rounded-lg"
                            >
                                {city.label}
                            </Button>
                        ))}
                        <Button size="sm" variant="secondary" onClick={handleUseMyLocation} disabled={isLocating} className="h-8 text-xs font-semibold rounded-lg">
                            {isLocating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : "📍 My GPS"}
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setIsConfigOpen(true)}
                            className="h-8 text-xs font-semibold rounded-lg border-primary/40 text-primary hover:bg-primary/10 flex items-center gap-1.5"
                        >
                            ⚙️ Configure Radar
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleTakeSnapshot}
                            className="h-8 text-xs font-semibold rounded-lg border-amber-500/40 text-amber-400 hover:bg-amber-500/10 flex items-center gap-1.5"
                            title="Capture a snapshot of the current scan to track and compare progression over time"
                        >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Snapshot</span>
                        </Button>
                        <Button
                            size="sm"
                            variant="default"
                            onClick={() => setIsCompareOpen(true)}
                            className="h-8 text-xs font-semibold rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white flex items-center gap-1.5 shadow-md"
                            title="Compare baseline snapshots against live scans to measure distress accumulation"
                        >
                            <GitCompare className="w-3.5 h-3.5" />
                            <span>Compare Progression</span>
                            <span className="ml-0.5 px-1 py-0.2 rounded bg-white/20 text-[9px] font-mono">
                                {snapshots.length}
                            </span>
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setIsTrendsOpen(true)}
                            className="h-8 text-xs font-semibold rounded-lg border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-1.5 shadow-sm"
                            title="Analyze mortgage trends, note interest rates, loan vintages, remaining principal, and Subject-To viability"
                        >
                            <TrendingUp className="w-3.5 h-3.5" />
                            <span>Mortgage Trends</span>
                        </Button>
                    </div>
                </div>

                {/* Filter & Controls Bar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 mt-6 p-3 rounded-xl border border-border/50 bg-background/60 backdrop-blur-md">
                    <form onSubmit={handleSearch} className="flex items-center gap-2 md:col-span-2">
                        <Input
                            type="text"
                            placeholder="Search ZIP (e.g. 92604), address, city..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-9 text-xs bg-background"
                        />
                        <Button type="submit" size="sm" className="h-9 px-3 text-xs shrink-0">Search</Button>
                    </form>

                    {/* Multi-Select Distress / Signal Filter */}
                    <div>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-9 text-xs justify-between font-semibold border-border bg-background hover:bg-muted/50 text-foreground"
                                    aria-label="Filter by Signal Criteria"
                                >
                                    <span className="truncate">
                                        {selectedSignals.includes("all") || selectedSignals.length === activeFilterList.length
                                            ? `⚡ All Signals (${activeMarkers.length})`
                                            : selectedSignals.length === 0
                                            ? "⚡ None (0)"
                                            : `⚡ Signals (${selectedSignals.length} active)`}
                                    </span>
                                    <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-60 shrink-0" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-3 bg-card border-border shadow-xl z-50 text-xs" align="start">
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/50">
                                    <span className="font-semibold text-foreground">Signal Criteria</span>
                                    <div className="flex items-center gap-1.5">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-1.5 text-[10px] text-primary hover:text-primary/80 hover:bg-primary/10"
                                            onClick={() => setSelectedSignals(["all"])}
                                        >
                                            Select All
                                        </Button>
                                        <span className="text-muted-foreground text-[10px]">|</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30"
                                            onClick={() => setSelectedSignals([])}
                                        >
                                            Clear
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                                    {activeFilterList.map(crit => {
                                        const isChecked = selectedSignals.includes("all") || selectedSignals.includes(crit.id);
                                        return (
                                            <label
                                                key={crit.id}
                                                className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/40 cursor-pointer select-none text-foreground"
                                            >
                                                <Checkbox
                                                    checked={isChecked}
                                                    onCheckedChange={(checked) => {
                                                        if (selectedSignals.includes("all")) {
                                                            if (!checked) {
                                                                setSelectedSignals(activeFilterList.map(c => c.id).filter(id => id !== crit.id));
                                                            }
                                                        } else {
                                                            if (checked) {
                                                                const updated = [...selectedSignals, crit.id];
                                                                if (updated.length === activeFilterList.length) {
                                                                    setSelectedSignals(["all"]);
                                                                } else {
                                                                    setSelectedSignals(updated);
                                                                }
                                                            } else {
                                                                setSelectedSignals(selectedSignals.filter(id => id !== crit.id));
                                                            }
                                                        }
                                                    }}
                                                />
                                                <span className="text-sm shrink-0">{crit.icon}</span>
                                                <span className="text-xs truncate">{crit.label}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                                <div className="pt-2 mt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
                                    <span>{activeFilterList.length} criteria active</span>
                                    <span className="text-primary font-medium">Configurable in Signal Studio</span>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Multi-Select ZIP Code Filter */}
                    <div>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-9 text-xs justify-between font-semibold border-border bg-background hover:bg-muted/50 text-foreground"
                                    aria-label="Filter by ZIP Code"
                                >
                                    <span className="truncate">
                                        {selectedZips.includes("all") || (availableZips.length > 0 && selectedZips.length === availableZips.length)
                                            ? `📍 All ZIPs (${availableZips.length})`
                                            : selectedZips.length === 0
                                            ? "📍 No ZIPs (0)"
                                            : `📍 ${selectedZips.length} ZIP${selectedZips.length > 1 ? "s" : ""}`}
                                    </span>
                                    <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-60 shrink-0" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-3 bg-card border-border shadow-xl z-50 text-xs" align="start">
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/50">
                                    <span className="font-semibold text-foreground">ZIP Codes</span>
                                    <div className="flex items-center gap-1.5">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-1.5 text-[10px] text-primary hover:text-primary/80 hover:bg-primary/10"
                                            onClick={() => setSelectedZips(["all"])}
                                        >
                                            Select All
                                        </Button>
                                        <span className="text-muted-foreground text-[10px]">|</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30"
                                            onClick={() => setSelectedZips([])}
                                        >
                                            Clear
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                                    {availableZips.map(zip => {
                                        const isChecked = selectedZips.includes("all") || selectedZips.includes(zip);
                                        const city = ZIP_CODE_DIRECTORY[zip]?.city;
                                        return (
                                            <label
                                                key={zip}
                                                className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/40 cursor-pointer select-none text-foreground"
                                            >
                                                <Checkbox
                                                    checked={isChecked}
                                                    onCheckedChange={(checked) => {
                                                        if (selectedZips.includes("all")) {
                                                            if (!checked) {
                                                                setSelectedZips(availableZips.filter(z => z !== zip));
                                                            }
                                                        } else {
                                                            if (checked) {
                                                                const updated = [...selectedZips, zip];
                                                                if (updated.length === availableZips.length) {
                                                                    setSelectedZips(["all"]);
                                                                } else {
                                                                    setSelectedZips(updated);
                                                                }
                                                            } else {
                                                                setSelectedZips(selectedZips.filter(z => z !== zip));
                                                            }
                                                        }
                                                    }}
                                                />
                                                <span className="font-mono text-xs">{zip}</span>
                                                {city && <span className="text-muted-foreground text-[11px] truncate">({city})</span>}
                                            </label>
                                        );
                                    })}
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <Input
                            type="number"
                            step="0.001"
                            value={centerLat}
                            onChange={(e) => setCenterLat(Number(e.target.value))}
                            className="h-9 text-xs bg-background w-1/2"
                            title="Latitude"
                        />
                        <Input
                            type="number"
                            step="0.001"
                            value={centerLng}
                            onChange={(e) => setCenterLng(Number(e.target.value))}
                            className="h-9 text-xs bg-background w-1/2"
                            title="Longitude"
                        />
                    </div>

                </div>
            </div>

            {/* Mapbox Vector & GeoJSON H3 Spatial Canvas */}
            <div className="relative rounded-3xl border border-primary/30 bg-card overflow-hidden shadow-2xl h-[560px]">
                {/* Floating Glassmorphism Centroid & Layer Controls HUD */}
                <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-background/85 px-4 py-3 backdrop-blur-xl border border-primary/30 text-xs shadow-2xl">
                    <div className="flex items-center gap-3">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
                        </span>
                        <div>
                            <span className="font-bold text-foreground/85">Active Centroid: </span>
                            <span className="text-cyan-400 font-bold font-mono">{centerLat.toFixed(4)}°N, {centerLng.toFixed(4)}°E</span>
                            <span className="ml-2 text-muted-foreground font-mono">(H3-{selectedRes})</span>
                        </div>
                    </div>

                    {/* Gauges & Telemetry Badges */}
                    <div className="flex flex-wrap items-center gap-2">

                        {/* Layer Toggles */}
                        <div className="flex items-center gap-1 bg-card/80 p-1 rounded-lg border border-border">
                            <Button
                                size="sm"
                                variant={useGaussianKernel ? "default" : "ghost"}
                                onClick={() => setUseGaussianKernel(!useGaussianKernel)}
                                className="h-7 text-[10px] font-medium px-2 py-0"
                            >
                                🌊 Gaussian KDE
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] font-medium px-2 py-0 border-cyan-500/30 text-cyan-300 bg-cyan-500/10"
                            >
                                📐 PCA Vectors
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] font-medium px-2 py-0 border-purple-500/30 text-purple-300 bg-purple-500/10"
                            >
                                ❓ GQE Socratic
                            </Button>
                        </div>
                    </div>
                </div>


                {/* Floating Universal Signal & Parcel Inspector HUD */}
                {selectedMarker && (() => {
                    const isRealEstate = Boolean(
                        selectedMarker.apn ||
                        selectedMarker.delinquencyAmount ||
                        selectedMarker.estimatedValue ||
                        selectedMarker.specs ||
                        /notice|auction|tax|probate|substandard|parcel|foreclosure/i.test(selectedMarker.badge || selectedMarker.label || '')
                    );
                    const rawPayload = selectedMarker.rawEvent || selectedMarker;

                    const handleCopyJson = () => {
                        try {
                            navigator.clipboard.writeText(JSON.stringify(rawPayload, null, 2));
                            setCopiedPayload(true);
                            toast({
                                title: "📋 JSON Copied",
                                description: "Raw signal payload copied to clipboard.",
                            });
                            setTimeout(() => setCopiedPayload(false), 2000);
                        } catch {
                            // ignore clipboard fail
                        }
                    };

                    const handleSendSignalToCrew = () => {
                        const prompt = `Inspect telemetry signal "${selectedMarker.label}" (${selectedMarker.jurisdiction || 'Global'}) with severity ${selectedMarker.severity || 'Medium'}. Lat/Lng: ${selectedMarker.lat.toFixed(4)}, ${selectedMarker.lng.toFixed(4)}.`;
                        if (onSendToCrew) {
                            onSendToCrew(selectedMarker, prompt);
                        } else {
                            toast({
                                title: "📡 Dispatched to CREW",
                                description: `Sent "${selectedMarker.label}" context to active deliberation room.`,
                            });
                        }
                    };

                    return (
                        <div className="absolute bottom-4 left-4 z-20 w-84 sm:w-96 rounded-2xl bg-background/95 p-4 backdrop-blur-xl border border-border/80 text-xs shadow-2xl space-y-2.5">
                            {/* Header & Tabs */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <span className={cn(
                                        "h-2 w-2 rounded-full animate-ping",
                                        isRealEstate ? "bg-amber-400" : "bg-cyan-400"
                                    )}></span>
                                    <span className={cn(
                                        "font-bold text-xs",
                                        isRealEstate ? "text-amber-400" : "text-cyan-400"
                                    )}>
                                        {isRealEstate ? "Distressed Residential Parcel" : (selectedMarker.category || "Domain Signal")}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="flex items-center rounded-lg bg-muted/60 p-0.5 border border-border/50 text-[10px]">
                                        <button
                                            type="button"
                                            onClick={() => setInspectorTab('overview')}
                                            className={cn(
                                                "px-2 py-0.5 rounded font-medium transition-colors",
                                                inspectorTab === 'overview' ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            Overview
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setInspectorTab('payload')}
                                            className={cn(
                                                "px-2 py-0.5 rounded font-medium transition-colors",
                                                inspectorTab === 'payload' ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            Raw JSON
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedMarker(null)}
                                        className="text-muted-foreground hover:text-foreground text-xs p-1 ml-1"
                                        aria-label="Close inspector"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>

                            {/* TAB 1: Overview */}
                            {inspectorTab === 'overview' && (
                                <div className="space-y-2.5">
                                    {isRealEstate ? (
                                        <>
                                            {/* Property Exterior Photo & Zillow Quick Badge */}
                                            <div className="relative h-28 w-full rounded-xl overflow-hidden bg-muted group border border-border/60">
                                                {getPropertyPhoto(selectedMarker) ? (
                                                    <img src={getPropertyPhoto(selectedMarker)} alt={selectedMarker.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No photo recorded</div>
                                                )}
                                                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
                                                <a
                                                    href={getZillowSearchUrl(selectedMarker.address)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-blue-600/90 hover:bg-blue-600 text-white font-bold text-[10px] flex items-center gap-1 shadow-md transition-colors"
                                                    title="View property photos and valuation on Zillow"
                                                >
                                                    <Home className="w-3 h-3" />
                                                    <span>Zillow Photos</span>
                                                    <ExternalLink className="w-2.5 h-2.5" />
                                                </a>
                                            </div>

                                            <div>
                                                <h4 className="font-black text-foreground text-sm leading-tight">{selectedMarker.label}</h4>
                                                {selectedMarker.badge && (
                                                    <div className="mt-1 inline-block px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono text-[10px] font-bold">
                                                        {selectedMarker.badge}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Physical Street Address & Parcel Grounding HUD Card */}
                                            <div className="p-2.5 rounded-xl bg-card/90 border border-border/80 shadow-inner space-y-1.5">
                                                <div className="flex items-start gap-1.5">
                                                    <span className="text-amber-400 text-sm mt-0.5">📍</span>
                                                    <div className="leading-snug">
                                                        <div className="font-bold text-foreground text-[11px]">
                                                            {selectedMarker.address || `${selectedMarker.lat.toFixed(4)}°N, ${selectedMarker.lng.toFixed(4)}°W`}
                                                        </div>
                                                        <div className="text-[10px] text-muted-foreground font-mono">
                                                            {selectedMarker.jurisdiction || "Not recorded"}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1.5 border-t border-border/40 text-[10px] font-mono">
                                                    {selectedMarker.zip && (
                                                        <div>
                                                            <span className="text-muted-foreground">ZIP: </span>
                                                            <span className="font-bold text-foreground">{selectedMarker.zip}</span>
                                                        </div>
                                                    )}
                                                    {selectedMarker.apn && (
                                                        <div>
                                                            <span className="text-muted-foreground">APN: </span>
                                                            <span className="font-bold text-foreground">{selectedMarker.apn}</span>
                                                        </div>
                                                    )}
                                                    {selectedMarker.estimatedValue && (
                                                        <div>
                                                            <span className="text-muted-foreground">Est Val: </span>
                                                            <span className="font-bold text-emerald-400">{selectedMarker.estimatedValue}</span>
                                                        </div>
                                                    )}
                                                    {selectedMarker.delinquencyAmount && (
                                                        <div className="col-span-2">
                                                            <span className="text-muted-foreground">Delinquency: </span>
                                                            <span className="font-bold text-amber-400">{selectedMarker.delinquencyAmount}</span>
                                                        </div>
                                                    )}
                                                    {selectedMarker.specs && (
                                                        <div className="col-span-2 text-muted-foreground truncate">
                                                            {selectedMarker.specs}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px]">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setCenterLat(selectedMarker.lat);
                                                        setCenterLng(selectedMarker.lng);
                                                        setZoom(15);
                                                    }}
                                                    className="px-1.5 py-1.5 rounded-lg bg-card/90 border border-border/70 hover:border-cyan-500/50 hover:bg-accent font-medium text-foreground transition-colors text-center"
                                                >
                                                    🎯 Focus
                                                </button>
                                                <a
                                                    href={getZillowSearchUrl(selectedMarker.address)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="px-1.5 py-1.5 rounded-lg bg-card/90 border border-border/70 hover:border-blue-500/50 hover:bg-accent font-medium text-foreground transition-colors text-center flex items-center justify-center gap-0.5"
                                                >
                                                    <span>🏠 Zillow</span>
                                                </a>
                                                <button
                                                    type="button"
                                                    onClick={handleSendSignalToCrew}
                                                    className="px-1.5 py-1.5 rounded-lg bg-card/90 border border-border/70 hover:border-cyan-500/50 hover:bg-accent font-medium text-cyan-400 transition-colors text-center"
                                                >
                                                    📡 CREW
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenDossier(selectedMarker)}
                                                    className="px-1.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-400 hover:bg-amber-500/25 font-bold transition-colors text-center flex items-center justify-center gap-1"
                                                >
                                                    <FileText className="w-3 h-3" />
                                                    <span>Dossier</span>
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        /* General-Purpose Signal Telemetry Inspector */
                                        <>
                                            <div>
                                                <h4 className="font-bold text-foreground text-sm leading-tight">{selectedMarker.label}</h4>
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                    {selectedMarker.badge && (
                                                        <span className="rounded bg-primary/10 border border-primary/20 px-1.5 py-0.2 text-[10px] font-mono text-primary font-semibold">
                                                            {selectedMarker.badge}
                                                        </span>
                                                    )}
                                                    {selectedMarker.severity && (
                                                        <span className={cn(
                                                            "rounded px-1.5 py-0.2 text-[10px] font-mono font-bold uppercase",
                                                            /critical/i.test(selectedMarker.severity) ? "bg-rose-500/15 text-rose-400 border border-rose-500/30" :
                                                            /high/i.test(selectedMarker.severity) ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" :
                                                            "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                                        )}>
                                                            {selectedMarker.severity}
                                                        </span>
                                                    )}
                                                    {selectedMarker.confidenceScore && (
                                                        <span className="text-[10px] text-muted-foreground font-mono">
                                                            {(selectedMarker.confidenceScore * 100).toFixed(0)}% conf
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Geospatial & Telemetry Card */}
                                            <div className="p-2.5 rounded-xl bg-card/90 border border-border/80 shadow-inner space-y-1.5">
                                                <div className="flex items-start gap-1.5">
                                                    <span className="text-cyan-400 text-sm mt-0.5">🌐</span>
                                                    <div className="leading-snug">
                                                        <div className="font-bold text-foreground text-[11px] font-mono">
                                                            {selectedMarker.lat.toFixed(4)}°N, {selectedMarker.lng.toFixed(4)}°E
                                                        </div>
                                                        <div className="text-[10px] text-muted-foreground font-mono">
                                                            {selectedMarker.jurisdiction || "Global Jurisdiction"}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1.5 border-t border-border/40 text-[10px] font-mono">
                                                    <div>
                                                        <span className="text-muted-foreground">Sector: </span>
                                                        <span className="font-bold text-foreground truncate">{selectedMarker.category || "General"}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-muted-foreground">H3 Res: </span>
                                                        <span className="font-bold text-cyan-400">Res {selectedRes}</span>
                                                    </div>
                                                    {selectedMarker.filingDate && (
                                                        <div className="col-span-2">
                                                            <span className="text-muted-foreground">Harvested: </span>
                                                            <span className="text-foreground">{selectedMarker.filingDate}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-3 gap-1.5 pt-1 text-[10px]">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setCenterLat(selectedMarker.lat);
                                                        setCenterLng(selectedMarker.lng);
                                                        setZoom(15);
                                                    }}
                                                    className="px-2 py-1.5 rounded-lg bg-card/90 border border-border/70 hover:border-cyan-500/50 hover:bg-accent font-medium text-foreground transition-colors text-center"
                                                >
                                                    🎯 Focus
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleSendSignalToCrew}
                                                    className="px-2 py-1.5 rounded-lg bg-cyan-600/90 hover:bg-cyan-600 text-white font-bold transition-colors text-center flex items-center justify-center gap-1 shadow-sm"
                                                >
                                                    <Send className="w-3 h-3" />
                                                    <span>Send to CREW</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleCopyJson}
                                                    className="px-2 py-1.5 rounded-lg bg-card/90 border border-border/70 hover:bg-muted font-medium text-muted-foreground hover:text-foreground transition-colors text-center"
                                                >
                                                    {copiedPayload ? "✓ Copied" : "📋 Copy ID"}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* TAB 2: Raw JSON / Telemetry Viewer */}
                            {inspectorTab === 'payload' && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                        <span className="font-mono">Payload Envelope</span>
                                        <button
                                            type="button"
                                            onClick={handleCopyJson}
                                            className="hover:text-foreground text-[10px] font-medium text-primary flex items-center gap-0.5"
                                        >
                                            {copiedPayload ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                            <span>{copiedPayload ? "Copied" : "Copy JSON"}</span>
                                        </button>
                                    </div>
                                    <pre className="max-h-52 overflow-y-auto rounded-lg bg-muted/60 p-2.5 font-mono text-[9px] text-foreground leading-relaxed border border-border/60 select-all">
                                        {JSON.stringify(rawPayload, null, 2)}
                                    </pre>
                                    <button
                                        type="button"
                                        onClick={handleSendSignalToCrew}
                                        className="w-full py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px] flex items-center justify-center gap-1 shadow-sm transition-colors"
                                    >
                                        <Send className="w-3 h-3" />
                                        <span>Dispatch Telemetry to CREW</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Mapbox Vector & H3 Layer Engine */}
                <RescueMap
                    center={{ lat: centerLat, lng: centerLng }}
                    zoom={zoom}
                    hexCells={hexCells}
                    markers={activeMarkers}
                    interactive={true}
                    onMove={(lat, lng) => {
                        const nLat = Number(lat.toFixed(4));
                        const nLng = Number(lng.toFixed(4));
                        setCenterLat(nLat);
                        setCenterLng(nLng);
                    }}
                    className="w-full h-full"
                />
            </div>

            {/* Radar Configuration & Custom Property Ingestion Dialog */}
            <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-lg font-black text-foreground">
                            ⚙️ Spatial Radar & Distress Feed Configuration
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            Configure geographic scope, ZIP code targeting, live viewport discovery, or ingest custom residential properties.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-2">
                        {/* 1. Metro Preset Selector */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                🗺️ Select Target Geographic Metro / Region
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {CITY_PRESETS.map((city) => (
                                    <Button
                                        key={city.label}
                                        type="button"
                                        size="sm"
                                        variant={centerLat === city.lat && centerLng === city.lng ? "default" : "outline"}
                                        onClick={() => {
                                            handleCityJump(city);
                                            setIsConfigOpen(false);
                                        }}
                                        className="h-9 text-xs justify-start px-2.5 truncate"
                                    >
                                        📍 {city.label}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {/* 1b. Popular ZIP Code Presets */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                📮 Quick Jump by ZIP Code
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {["92604", "92625", "92626", "92804", "92706", "92648", "92660", "90210"].map(zip => {
                                    const entry = ZIP_CODE_DIRECTORY[zip];
                                    return (
                                        <button
                                            key={zip}
                                            type="button"
                                            onClick={() => {
                                                if (entry) {
                                                    setCenterLat(entry.lat);
                                                    setCenterLng(entry.lng);
                                                    setSelectedZips([zip]);
                                                    setIsConfigOpen(false);
                                                    triggerViewportScan(entry.lat, entry.lng, true);
                                                }
                                            }}
                                            className={cn(
                                                "px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition-colors",
                                                selectedZips.includes(zip)
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-card/80 border-border text-foreground hover:bg-accent"
                                            )}
                                        >
                                            {zip} ({entry?.city || "OC"})
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 3. Add Custom Distressed Property Form */}
                        <form onSubmit={handleAddCustomProperty} className="space-y-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                    📍 Add a Property You Are Tracking
                                </label>
                                <span className="text-[10px] text-muted-foreground font-mono">Your entry — not a public record</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">Property Name / Label *</label>
                                    <Input
                                        placeholder="e.g. Balboa Island Cottage"
                                        value={newProp.label}
                                        onChange={(e) => setNewProp(prev => ({ ...prev, label: e.target.value }))}
                                        className="h-8 text-xs bg-background"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">Physical Street Address *</label>
                                    <Input
                                        placeholder="e.g. 214 Marine Ave, Newport Beach, CA 92662"
                                        value={newProp.address}
                                        onChange={(e) => setNewProp(prev => ({ ...prev, address: e.target.value }))}
                                        className="h-8 text-xs bg-background"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">ZIP Code (Auto-locates Lat/Lng)</label>
                                    <Input
                                        placeholder="e.g. 92662"
                                        value={newProp.zip}
                                        onChange={(e) => {
                                            const z = e.target.value;
                                            const entry = ZIP_CODE_DIRECTORY[z];
                                            setNewProp(prev => ({
                                                ...prev,
                                                zip: z,
                                                city: entry?.city || prev.city,
                                                lat: entry ? String(entry.lat) : prev.lat,
                                                lng: entry ? String(entry.lng) : prev.lng,
                                            }));
                                        }}
                                        className="h-8 text-xs bg-background"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">APN (Assessor's Parcel Number)</label>
                                    <Input
                                        placeholder="e.g. 048-182-09"
                                        value={newProp.apn}
                                        onChange={(e) => setNewProp(prev => ({ ...prev, apn: e.target.value }))}
                                        className="h-8 text-xs bg-background"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">Building Specs</label>
                                    <Input
                                        placeholder="e.g. 3 Bed / 2 Bath SFR • 1,950 sq ft"
                                        value={newProp.specs}
                                        onChange={(e) => setNewProp(prev => ({ ...prev, specs: e.target.value }))}
                                        className="h-8 text-xs bg-background"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">Estimated Market Value</label>
                                    <Input
                                        placeholder="e.g. 2.45M"
                                        value={newProp.estimatedValue}
                                        onChange={(e) => setNewProp(prev => ({ ...prev, estimatedValue: e.target.value }))}
                                        className="h-8 text-xs bg-background"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">Distress Signal Type</label>
                                    <select
                                        value={newProp.badge}
                                        onChange={(e) => setNewProp(prev => ({ ...prev, badge: e.target.value }))}
                                        className="w-full h-8 text-xs bg-background border border-border rounded-lg px-2 text-foreground font-semibold"
                                        aria-label="Distress signal type"
                                    >
                                        <option value="Notice of Default ($42k Delinq)">⚠️ Notice of Default (NOD)</option>
                                        <option value="Trustee Sale Auction Scheduled">🔨 Scheduled Trustee Auction</option>
                                        <option value="3-Year Delinquent Property Tax Roll">💰 Tax Default Roll</option>
                                        <option value="Substandard Housing Red-Tag #CE-2026">🚫 Substandard / Code Enforcement</option>
                                        <option value="Probate Acceleration Lis Pendens">⚖️ Probate Lis Pendens</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">Latitude (Optional / Auto-offset)</label>
                                    <Input
                                        placeholder={centerLat.toFixed(4)}
                                        value={newProp.lat}
                                        onChange={(e) => setNewProp(prev => ({ ...prev, lat: e.target.value }))}
                                        className="h-8 text-xs bg-background"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-muted-foreground block mb-1">Longitude (Optional / Auto-offset)</label>
                                    <Input
                                        placeholder={centerLng.toFixed(4)}
                                        value={newProp.lng}
                                        onChange={(e) => setNewProp(prev => ({ ...prev, lng: e.target.value }))}
                                        className="h-8 text-xs bg-background"
                                    />
                                </div>
                            </div>

                            <Button
                                type="submit"
                                size="sm"
                                className="w-full h-9 bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs rounded-lg mt-2"
                            >
                                📍 Ingest & Pin to Spatial Radar
                            </Button>
                        </form>
                    </div>

                    <DialogFooter className="flex flex-row items-center justify-between sm:justify-between w-full pt-2 border-t border-border">
                        <div className="text-xs text-muted-foreground font-mono">
                            Active Markers: <strong className="text-foreground">{activeMarkers.length}</strong> ({customMarkers.length} custom ingested)
                        </div>
                        <div className="flex items-center gap-2">
                            {customMarkers.length > 0 && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setCustomMarkers([]);
                                        toast({ title: "Custom Markers Cleared", description: "Reverted to default public records dataset." });
                                    }}
                                    className="h-8 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    Reset to Default
                                </Button>
                            )}
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => setIsConfigOpen(false)}
                                className="h-8 text-xs font-semibold"
                            >
                                Done
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Property Residential Distress Dossier Modal */}
            <PropertyDossierDialog
                marker={dossierMarker}
                isOpen={isDossierOpen}
                onClose={() => setIsDossierOpen(false)}
            />

            {/* Spatial Progression & Snapshot Comparison Modal */}
            <SnapshotComparisonDialog
                snapshots={snapshots}
                currentLiveScan={currentLiveScan}
                isOpen={isCompareOpen}
                onClose={() => setIsCompareOpen(false)}
                onOpenDossier={(m) => {
                    setIsCompareOpen(false);
                    handleOpenDossier(m);
                }}
            />

            {/* Mortgage & Underwriting Trends Analytics Modal */}
            <MortgageTrendsDialog
                isOpen={isTrendsOpen}
                onClose={() => setIsTrendsOpen(false)}
                markers={activeMarkers}
                onOpenDossier={(m) => {
                    setIsTrendsOpen(false);
                    handleOpenDossier(m);
                }}
            />
        </div>
    );
}




// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PredictionIntelligenceDashboard() {
    return (
        <div className="min-h-screen bg-background p-3 pb-28 space-y-5 text-foreground sm:p-6 sm:pb-6 sm:space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <h1 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">Prediction Engine</h1>
                        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                            Operational
                        </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">Forecast cycle risk, surface backend coverage, and govern autonomous decisions.</p>
                </div>
                <p className="max-w-xl text-xs font-medium leading-5 text-muted-foreground md:text-right">
                    Built for Oddjob operations: every prediction should connect to a cycle, mission run, branch, contract, or event signal.
                </p>
            </div>

            <Tabs defaultValue="overview" className="w-full">
                <TabsList className="flex h-12 w-full justify-start overflow-x-auto rounded-xl bg-background/30 p-1 sm:grid sm:grid-cols-5">
                    <TabsTrigger value="overview" className="h-10 shrink-0 px-4">Overview</TabsTrigger>
                    <TabsTrigger value="evaluate" className="h-10 shrink-0 px-4">Evaluate</TabsTrigger>
                    <TabsTrigger value="govern" className="h-10 shrink-0 px-4">Govern</TabsTrigger>
                    <TabsTrigger value="telemetry" className="h-10 shrink-0 px-4">Telemetry</TabsTrigger>
                    <TabsTrigger value="spatial" className="h-10 shrink-0 px-4">🗺️ Spatial H3 Map</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                    <OperationalSummaryPanel />
                </TabsContent>
                <TabsContent value="evaluate">
                    <EvaluatePanel />
                </TabsContent>
                <TabsContent value="govern">
                    <GovernanceChecker />
                </TabsContent>
                <TabsContent value="telemetry">
                    <TelemetryFeed />
                </TabsContent>
                <TabsContent value="spatial">
                    <SpatialH3MapPanel />
                </TabsContent>
            </Tabs>
        </div>
    );
}

