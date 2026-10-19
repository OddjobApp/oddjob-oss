
import React, { useState, useMemo } from "react";
import cronstrue from "cronstrue";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
    Card, CardContent, CardDescription, CardHeader, CardTitle
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
    Zap, Eye, Loader2, ArrowLeft, Target,
    Shield, BarChart3, AlertCircle, Sparkles, ChevronRight, HelpCircle,
    Database, Key, Link as LinkIcon, FileText, Hash, GitBranch, AlertTriangle
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import CronExpressionBuilder from "@domain-ui/core/ui/components/shared/CronExpressionBuilder";
import { TIMEZONES } from "@/lib/timezones";
import { CYCLE_TEMPLATES, type CycleTemplate, type Blueprint } from "../data/cycle-templates";
import { BlueprintBuilder } from "../components/BlueprintBuilder";
import { DependencyGraph } from "../components/DependencyGraph";
import { normalizeCycleInputRequirements } from "@shared/cycle-inputs";
import fuzzysort from "fuzzysort";

interface SimulationResult {
    missionCount: number;
    totalEstimatedCost: number;
    totalEstimatedTokens: number;
    recommendedPriority: number;
    stratagem: string;
}

export default function StageCycle() {
    const { toast } = useToast();
    const [, setLocation] = useLocation();

    // Wizard State
    const [step, setStep] = useState<number>(0);
    const [selectedTemplate, setSelectedTemplate] = useState<CycleTemplate | null>(null);
    const [questions, setQuestions] = useState<string[]>([]);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [refiningBlueprints, setRefiningBlueprints] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const filteredTemplates = searchQuery.trim()
        ? fuzzysort.go(searchQuery, CYCLE_TEMPLATES, { keys: ['name', 'description', 'objective'] }).map(r => r.obj)
        : CYCLE_TEMPLATES;

    // Core State
    const [name, setName] = useState("");
    const [objective, setObjective] = useState("");
    const [recurrence, setRecurrence] = useState("once");
    const [customCron, setCustomCron] = useState("0 9 * * *"); // Default: daily at 9am
    const [cooldownMinutes, setCooldownMinutes] = useState(1);
    const [intervalValue, setIntervalValue] = useState(15);
    const [intervalUnit, setIntervalUnit] = useState<"minutes" | "hours" | "days">("minutes");
    const [startTime, setStartTime] = useState("09:00");
    const [timezone, setTimezone] = useState("UTC");
    const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [dayOfMonth, setDayOfMonth] = useState(1);
    const [priority, setPriority] = useState("5");
    const [budget, setBudget] = useState("100");
    const [requiresApproval, setRequiresApproval] = useState(true);
    const [blueprints, setBlueprints] = useState<Blueprint[]>([{ name: "", objective: "", type: "mission" }]);
    const [timeUnit, setTimeUnit] = useState("d");
    const [simulation, setSimulation] = useState<SimulationResult | null>(null);
    const [simulating, setSimulating] = useState(false);
    const [resourceAnswers, setResourceAnswers] = useState<Record<string, Record<string, string>>>({});
    const [synthesizing, setSynthesizing] = useState(false);

    // Sync blueprints timeUnit
    React.useEffect(() => {
        setBlueprints(prev => prev.map(bp => ({ ...bp, timeUnit: timeUnit as any })));
    }, [timeUnit]);

    const needsResources = blueprints.some(b => normalizeCycleInputRequirements(b).length > 0);
    const budgetNum = parseFloat(budget) || 0;
    const overBudget = simulation && simulation.totalEstimatedCost > budgetNum;

    // ── Template helpers ─────────────────────────────────────────────────────

    const applyTemplate = (t: CycleTemplate, opts: { guided: boolean }) => {
        setSelectedTemplate(t);
        setName(t.name);
        setObjective(t.objective);
        setRecurrence(t.recurrence);
        const nextTimeUnit = t.timeUnit ?? "d";
        setTimeUnit(nextTimeUnit);
        setPriority(String(t.priority));
        setBudget(String(t.budgetLimitUsd));
        setRequiresApproval(t.requiresApproval);
        setBlueprints(t.blueprints.length > 0
            ? t.blueprints.map(bp => ({ ...bp, timeUnit: nextTimeUnit as any }))
            : [{ name: "", objective: "", type: "mission", timeUnit: nextTimeUnit as any }]);
        setSimulation(null);

        const scheduling = (t as any).metadata?.scheduling;
        if (scheduling) {
            setCooldownMinutes(scheduling.cooldownMinutes ?? 1);
            setIntervalValue(scheduling.intervalValue ?? 15);
            setIntervalUnit(scheduling.intervalUnit ?? "minutes");
        } else {
            setCooldownMinutes(1);
            setIntervalValue(15);
            setIntervalUnit("minutes");
        }
        if (opts.guided) {
            startGuidedSetup(t);
        } else {
            setStep(2);
            toast({ title: "Template Applied" });
        }
    };

    const startGuidedSetup = async (t: CycleTemplate) => {
        setLoadingQuestions(true);
        setStep(1);
        try {
            const res = await apiRequest("POST", "/api/cycles/questions", t);
            const data = await res.json();
            setQuestions(data);
        } catch {
            toast({ title: "Intelligence Error", description: "Falling back to manual config.", variant: "destructive" });
            setStep(2);
        } finally {
            setLoadingQuestions(false);
        }
    };

    const handleRefine = async () => {
        setRefiningBlueprints(true);
        try {
            const res = await apiRequest("POST", "/api/cycles/refine", {
                template: { ...selectedTemplate, name, objective, blueprints },
                answers,
            });
            const refined = await res.json();
            setBlueprints(Array.isArray(refined) ? refined.map((bp: Blueprint) => ({ ...bp, timeUnit: timeUnit as any })) : refined);
            setStep(2);
            toast({ title: "Strategy Refined", description: "Blueprints updated with your business context." });
        } catch {
            setStep(2);
        } finally {
            setRefiningBlueprints(false);
        }
    };

    const handleSynthesize = async () => {
        if (!searchQuery.trim()) return;
        setSynthesizing(true);
        try {
            const res = await apiRequest("POST", "/api/cycles/synthesize", { objective: searchQuery });
            const data = await res.json();
            setName(`Strategy: ${searchQuery}`);
            setObjective(searchQuery);
            setBlueprints(Array.isArray(data)
                ? data.map((bp: Blueprint) => ({ ...bp, timeUnit: timeUnit as any }))
                : [{ name: "", objective: "", type: "mission", timeUnit: timeUnit as any }]);
            setStep(2);
            toast({ title: "Strategy Synthesized" });
        } catch (e: any) {
            toast({ title: "Synthesis failed", description: e.message, variant: "destructive" });
        } finally {
            setSynthesizing(false);
        }
    };

    const handleSimulate = async () => {
        if (!objective.trim()) return;
        setSimulating(true);
        setSimulation(null);
        try {
            const res = await apiRequest("POST", "/api/cycles/simulate", {
                name, objective,
                blueprints: blueprints.filter(b => b.name && b.objective),
                priority: parseInt(priority),
            });
            setSimulation(await res.json());
        } catch {
            toast({ title: "Simulation failed", variant: "destructive" });
        } finally {
            setSimulating(false);
        }
    };

    const launchMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest("POST", "/api/cycles/launch", data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles"] });
            toast({ title: "Cycle Staged", description: "Fleet orchestration has commenced." });
            setLocation("/operations/cycles");
        },
        onError: (err: any) => {
            toast({ title: "Launch failed", description: err.message, variant: "destructive" });
        },
    });

    const handleSubmit = () => {
        if (!name.trim() || !objective.trim()) {
            toast({ title: "Required fields missing", description: "Name and objective are required.", variant: "destructive" });
            return;
        }

        let effectiveRecurrence = recurrence;
        if (recurrence === "custom") {
            effectiveRecurrence = customCron;
        } else if (recurrence === "daily") {
            const [h, m] = startTime.split(':').map(Number);
            effectiveRecurrence = `${m} ${h} * * *`;
        } else if (recurrence === "weekly") {
            const [h, m] = startTime.split(':').map(Number);
            effectiveRecurrence = `${m} ${h} * * ${weekdays.join(',')}`;
        } else if (recurrence === "monthly") {
            const [h, m] = startTime.split(':').map(Number);
            effectiveRecurrence = `${m} ${h} ${dayOfMonth} * *`;
        } else if (recurrence === "interval") {
            if (intervalUnit === "minutes") {
                effectiveRecurrence = `*/${intervalValue} * * * *`;
            } else if (intervalUnit === "hours") {
                effectiveRecurrence = `0 */${intervalValue} * * *`;
            } else if (intervalUnit === "days") {
                effectiveRecurrence = `0 0 */${intervalValue} * *`;
            }
        }

        launchMutation.mutate({
            name: name.trim(),
            objective: objective.trim(),
            recurrence: effectiveRecurrence,
            timezone: timezone,
            priority: parseInt(priority),
            budgetLimitUsd: parseFloat(budget),
            requiresApproval: requiresApproval ? 1 : 0,
            blueprints: blueprints.filter(b => b.name && b.objective).map(bp => ({ ...bp, timeUnit: timeUnit as any })),
            metadata: {
                ...(simulation ? { forecast: simulation } : {}),
                resource_answers: resourceAnswers,
                timeUnit: timeUnit,
                scheduling: {
                    type: recurrence,
                    startTime,
                    timezone,
                    weekdays,
                    dayOfMonth,
                    originalCustomCron: customCron,
                    cooldownMinutes,
                    intervalValue,
                    intervalUnit
                }
            },
        });
    };

    // ── Step indicator ───────────────────────────────────────────────────────

    const STEPS = ["Template", "Intelligence", "Blueprints", "Resources"];
    const visibleStep = step === 0 ? 0 : step === 1 ? 1 : step === 2 ? 2 : 3;

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="w-full px-2 py-6 space-y-6 animate-in slide-in-from-bottom-4 duration-700">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon"
                        onClick={() => step === 0 ? setLocation("/operations/cycles") : setStep(s => Math.max(0, s - 1))}
                        className="rounded-full">
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black tracking-tight">Stage New <span className="text-primary">Cycle</span></h1>
                        <p className="text-muted-foreground text-sm font-medium">
                            {step === 0 ? "Select a strategic template or synthesize a custom plan." :
                             step === 1 ? "Answer discovery questions to refine your strategy." :
                             step === 2 ? "Define your mission blueprint sequence." :
                             "Provide human-supplied resources for the fleet."}
                        </p>
                    </div>
                </div>

                {/* Step 2 actions */}
                {step === 2 && (
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={handleSimulate}
                            disabled={simulating || !objective.trim()} className="rounded-full px-5">
                            {simulating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                            Simulate
                        </Button>
                        {needsResources ? (
                            <Button onClick={() => setStep(3)}
                                className="rounded-full px-6 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
                                <ChevronRight className="w-4 h-4 mr-2" /> Configure Resources
                            </Button>
                        ) : (
                            <Button onClick={handleSubmit} disabled={launchMutation.isPending}
                                className="rounded-full px-6 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
                                {launchMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                                {requiresApproval ? "Stage for Approval" : "Launch Fleet"}
                            </Button>
                        )}
                    </div>
                )}

                {/* Step 3 actions */}
                {step === 3 && (
                    <Button onClick={handleSubmit} disabled={launchMutation.isPending}
                        className="rounded-full px-6 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
                        {launchMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                        {requiresApproval ? "Stage for Approval" : "Launch Fleet"}
                    </Button>
                )}
            </div>

            {/* Step breadcrumb (steps 1-3) */}
            {step > 0 && (
                <div className="flex items-center gap-2 w-full">
                    {STEPS.slice(1).map((label, i) => {
                        const si = i + 1;
                        const active = visibleStep === si;
                        const done = visibleStep > si;
                        return (
                            <React.Fragment key={label}>
                                <div className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full transition-all ${
                                    active ? "bg-primary/15 text-primary" :
                                    done ? "text-emerald-400" : "text-muted-foreground/40"
                                }`}>
                                    <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center ${
                                        active ? "bg-primary text-foreground" :
                                        done ? "bg-emerald-500/20 text-emerald-400" : "bg-foreground/5"
                                    }`}>{done ? "✓" : si}</span>
                                    {label}
                                </div>
                                {i < 2 && <div className="w-4 h-px bg-foreground/10 shrink-0" />}
                            </React.Fragment>
                        );
                    })}
                </div>
            )}

            {/* ── Step 0: Template Selection ──────────────────────────────────── */}
            {step === 0 && (
                <div className="space-y-6 animate-in fade-in duration-400">
                    <div className="flex gap-3 w-full">
                        <div className="relative flex-1">
                            <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                className="pl-11 h-12 bg-foreground/5 border-foreground/10 rounded-xl text-sm"
                                placeholder="Search templates or type any objective to synthesize a custom strategy…"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <Button className="h-12 px-6 rounded-xl bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/20"
                            disabled={!searchQuery.trim() || synthesizing} onClick={handleSynthesize}>
                            {synthesizing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                            AI Synthesize
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredTemplates.map(t => (
                            <Card key={t.id} className="border-foreground/10 bg-foreground/5 hover:border-primary/40 transition-all group overflow-hidden">
                                <CardHeader className="pb-3">
                                    <div className="text-3xl mb-3 grayscale group-hover:grayscale-0 transition-all">{t.icon}</div>
                                    <CardTitle className="text-base font-bold">{t.name}</CardTitle>
                                    <CardDescription className="line-clamp-2 text-xs">{t.description}</CardDescription>
                                </CardHeader>
                                <CardContent className="pt-0 space-y-2">
                                    <div className="flex gap-1.5 flex-wrap">
                                        <Badge variant="outline" className="text-[9px]">{t.recurrence}</Badge>
                                        <Badge variant="outline" className="text-[9px]">P{t.priority}</Badge>
                                        <Badge variant="outline" className="text-[9px] text-emerald-400">${t.budgetLimitUsd}</Badge>
                                    </div>
                                    <Button className="w-full rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-foreground text-xs h-8"
                                        onClick={() => applyTemplate(t, { guided: true })}>
                                        <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Guided Setup
                                    </Button>
                                    <Button variant="ghost" className="w-full text-[11px] text-muted-foreground h-7"
                                        onClick={() => applyTemplate(t, { guided: false })}>
                                        Skip to Builder
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Step 1: Guided Intelligence ─────────────────────────────────── */}
            {step === 1 && (
                <div className="w-full space-y-6 animate-in fade-in duration-400">
                    <Card className="border-primary/20 bg-primary/5 p-6 text-center space-y-3">
                        <div className="mx-auto w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-primary animate-pulse" />
                        </div>
                        <h2 className="text-xl font-black">Contextual Intelligence</h2>
                        <p className="text-sm text-muted-foreground">Help the AI refine your blueprints with specific business context.</p>
                    </Card>

                    {loadingQuestions ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-4">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            <p className="text-xs font-bold text-primary animate-pulse uppercase tracking-widest">Generating Discovery Questions…</p>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            {questions.map((q, i) => (
                                <div key={i} className="space-y-2">
                                    <Label className="font-bold flex items-center gap-2 text-sm">
                                        <HelpCircle className="w-4 h-4 text-primary" />{q}
                                    </Label>
                                    <Input
                                        className="bg-background/20 border-foreground/10 h-11"
                                        placeholder="Your answer…"
                                        value={answers[q] || ""}
                                        onChange={e => setAnswers(p => ({ ...p, [q]: e.target.value }))}
                                    />
                                </div>
                            ))}
                            <div className="flex gap-3 pt-4">
                                <Button size="lg"
                                    className="flex-1 rounded-full bg-primary hover:bg-primary/90 font-bold h-12 shadow-xl shadow-primary/20"
                                    onClick={handleRefine} disabled={refiningBlueprints}>
                                    {refiningBlueprints ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ChevronRight className="w-4 h-4 mr-2" />}
                                    Refine Plan
                                </Button>
                                <Button variant="ghost" onClick={() => setStep(2)} className="h-12">Skip</Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Step 2: Blueprint Builder ───────────────────────────────────── */}
            {step === 2 && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-in fade-in duration-400">

                    {/* Left: config + blueprint builder */}
                    <div className="xl:col-span-2 space-y-6">

                        {/* Strategic Definition */}
                        <Card className="border-foreground/10 bg-foreground/5">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-base font-bold flex items-center gap-2">
                                    <Target className="w-4 h-4 text-primary" /> Strategic Definition
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2 space-y-1.5">
                                        <Label className="text-xs font-semibold">Cycle Name</Label>
                                        <Input value={name} onChange={e => setName(e.target.value)}
                                            placeholder="e.g. Q3 Security Audit"
                                            className="bg-background/20 border-foreground/10" />
                                    </div>
                                    <div className="col-span-2 space-y-1.5">
                                        <Label className="text-xs font-semibold">Strategic Objective</Label>
                                        <Textarea value={objective} onChange={e => setObjective(e.target.value)}
                                            placeholder="Describe the high-level goal the fleet should achieve…"
                                            rows={3} className="bg-background/20 border-foreground/10 resize-none text-sm" />
                                    </div>
                                    <div className="col-span-2 space-y-1.5">
                                        <Label className="text-xs font-semibold">Recurrence</Label>
                                        <Select value={recurrence} onValueChange={setRecurrence}>
                                            <SelectTrigger className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic uppercase">
                                                <SelectValue placeholder="Frequency" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-background border-foreground/10">
                                                <SelectItem value="once" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Once</SelectItem>
                                                <SelectItem value="continuous" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Continuous Loop</SelectItem>
                                                <SelectItem value="interval" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Interval (Every N)</SelectItem>
                                                <SelectItem value="daily" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Daily</SelectItem>
                                                <SelectItem value="weekly" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Weekly</SelectItem>
                                                <SelectItem value="monthly" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Monthly</SelectItem>
                                                <SelectItem value="custom" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Custom (Cron)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="col-span-2 space-y-1.5">
                                        <Label className="text-xs font-semibold">Time Scale Resolution (Gantt)</Label>
                                        <Select value={timeUnit} onValueChange={setTimeUnit}>
                                            <SelectTrigger className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic uppercase">
                                                <SelectValue placeholder="Time scale resolution" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-background border-foreground/10">
                                                <SelectItem value="ms" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Milliseconds (ms)</SelectItem>
                                                <SelectItem value="s" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Seconds (s)</SelectItem>
                                                <SelectItem value="m" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Minutes (m)</SelectItem>
                                                <SelectItem value="h" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Hours (h)</SelectItem>
                                                <SelectItem value="d" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Days (d)</SelectItem>
                                                <SelectItem value="w" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Weeks (w)</SelectItem>
                                                <SelectItem value="M" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Months (M)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Advanced Timing Options */}
                                    {(recurrence === "daily" || recurrence === "weekly" || recurrence === "monthly") && (
                                        <div className="col-span-2 grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1">
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Run Time (HH:MM) *</Label>
                                                <Input
                                                    type="time"
                                                    value={startTime}
                                                    onChange={e => setStartTime(e.target.value)}
                                                    className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Temporal Region *</Label>
                                                <Select value={timezone} onValueChange={setTimezone}>
                                                    <SelectTrigger className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="max-h-[300px] bg-background border-foreground/10">
                                                        {TIMEZONES.map(tz => (
                                                            <SelectItem key={tz.value} value={tz.value} className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">{tz.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    )}

                                    {recurrence === "weekly" && (
                                        <div className="col-span-2 space-y-3 animate-in fade-in slide-in-from-top-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Active Days *</Label>
                                            <div className="flex flex-wrap gap-2">
                                                {[
                                                    { v: 1, l: 'M' }, { v: 2, l: 'T' }, { v: 3, l: 'W' },
                                                    { v: 4, l: 'T' }, { v: 5, l: 'F' }, { v: 6, l: 'S' }, { v: 0, l: 'S' }
                                                ].map(day => (
                                                    <Button
                                                        key={day.v}
                                                        type="button"
                                                        variant={weekdays.includes(day.v) ? 'default' : 'outline'}
                                                        className={`w-10 h-10 rounded-xl text-[10px] font-black ${weekdays.includes(day.v) ? 'bg-primary text-primary-foreground' : 'bg-foreground/5 border-foreground/10 text-foreground/40'}`}
                                                        onClick={() => {
                                                            setWeekdays(prev => prev.includes(day.v) ? prev.filter(d => d !== day.v) : [...prev, day.v].sort());
                                                        }}
                                                    >
                                                        {day.l}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {recurrence === "custom" && (
                                        <div className="col-span-2 space-y-3 animate-in fade-in slide-in-from-top-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Cron Matrix Builder</Label>
                                            <div className="bg-foreground/[0.02] border border-foreground/5 rounded-2xl overflow-hidden p-4">
                                                <CronExpressionBuilder
                                                    value={customCron}
                                                    onChange={setCustomCron}
                                                    testIdPrefix="cycle"
                                                />
                                            </div>
                                            <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-xl border border-primary/10">
                                                <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5" />
                                                <p className="text-[10px] font-bold text-foreground/60 leading-relaxed italic">
                                                    {(() => {
                                                        try {
                                                            return cronstrue.toString(customCron);
                                                        } catch {
                                                            return "Invalid cron expression";
                                                        }
                                                    })()}
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {recurrence === "monthly" && (
                                        <div className="col-span-2 space-y-2 animate-in fade-in slide-in-from-top-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Day of Month (1–31) *</Label>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={31}
                                                value={dayOfMonth}
                                                onChange={e => setDayOfMonth(Number(e.target.value))}
                                                className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic"
                                            />
                                        </div>
                                    )}

                                    {recurrence === "continuous" && (
                                        <div className="col-span-2 space-y-2 animate-in fade-in slide-in-from-top-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Cooldown Buffer (Minutes) *</Label>
                                            <Input
                                                type="number"
                                                min={1}
                                                value={cooldownMinutes}
                                                onChange={e => setCooldownMinutes(Math.max(1, Number(e.target.value)))}
                                                className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic"
                                            />
                                            <p className="text-[10px] text-muted-foreground/60 italic ml-1">The buffer time before starting the next continuous loop pass.</p>
                                        </div>
                                    )}

                                    {recurrence === "interval" && (
                                        <div className="col-span-2 grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1">
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Interval Value *</Label>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={intervalValue}
                                                    onChange={e => setIntervalValue(Math.max(1, Number(e.target.value)))}
                                                    className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Interval Unit *</Label>
                                                <Select value={intervalUnit} onValueChange={(val: any) => setIntervalUnit(val)}>
                                                    <SelectTrigger className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic uppercase">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-background border-foreground/10">
                                                        <SelectItem value="minutes" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Minutes</SelectItem>
                                                        <SelectItem value="hours" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Hours</SelectItem>
                                                        <SelectItem value="days" className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">Days</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-semibold">Priority (1–10)</Label>
                                        <Input type="number" min={1} max={10} value={priority}
                                            onChange={e => setPriority(e.target.value)}
                                            className="bg-background/20 border-foreground/10" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-semibold">Budget Limit (USD)</Label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
                                            <Input type="number" min={0} step={10} value={budget}
                                                onChange={e => setBudget(e.target.value)}
                                                className="pl-6 bg-background/20 border-foreground/10" />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 pt-5">
                                        <Checkbox id="hil" checked={requiresApproval}
                                            onCheckedChange={v => setRequiresApproval(!!v)} />
                                        <Label htmlFor="hil" className="text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                                            <Shield className="w-3.5 h-3.5 text-primary" /> Human-in-the-Loop Gate
                                        </Label>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Blueprint Builder */}
                        <Card className="border-foreground/10 bg-foreground/5">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-base font-bold flex items-center gap-2">
                                    <GitBranch className="w-4 h-4 text-primary" /> Mission Blueprints
                                    <Badge variant="outline" className="ml-auto text-[9px]">{blueprints.filter(b => b.name).length} defined</Badge>
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Configure each phase: set dependencies, branch logic, required resources, and data contracts.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <BlueprintBuilder blueprints={blueprints} onChange={setBlueprints} />
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right: graph + simulation + quick-switch */}
                    <div className="space-y-5">

                        {/* Dependency Graph */}
                        <Card className="border-foreground/10 bg-foreground/5">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                                    Dependency Graph
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <DependencyGraph blueprints={blueprints} />
                            </CardContent>
                        </Card>

                        {/* Budget warning */}
                        {overBudget && (
                            <div className="flex items-start gap-2 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-medium">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                Estimated cost <strong>${simulation!.totalEstimatedCost.toFixed(2)}</strong> exceeds your budget of <strong>${budgetNum.toFixed(2)}</strong>.
                            </div>
                        )}

                        {/* Simulation result */}
                        {simulation ? (
                            <Card className="border-primary/20 bg-primary/5 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-3 opacity-5">
                                    <BarChart3 className="w-16 h-16 text-primary" />
                                </div>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary">
                                        Strategic Forecast
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4 pt-0 relative z-10">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <p className="text-[10px] text-muted-foreground">Est. Cost</p>
                                            <p className={`text-xl font-black ${overBudget ? "text-red-400" : "text-foreground"}`}>
                                                ${simulation.totalEstimatedCost.toFixed(2)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-muted-foreground">Token Load</p>
                                            <p className="text-xl font-black">{(simulation.totalEstimatedTokens / 1000).toFixed(0)}k</p>
                                        </div>
                                    </div>
                                    {/* Budget progress */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span>Budget utilisation</span>
                                            <span>{Math.min(Math.round((simulation.totalEstimatedCost / budgetNum) * 100), 999)}%</span>
                                        </div>
                                        <Progress
                                            value={Math.min((simulation.totalEstimatedCost / budgetNum) * 100, 100)}
                                            className={`h-1.5 ${overBudget ? "[&>div]:bg-red-500" : ""}`}
                                        />
                                    </div>
                                    <p className="text-[11px] leading-relaxed text-foreground/80 p-2 rounded-lg bg-background/30 border border-foreground/5">
                                        {simulation.stratagem}
                                    </p>
                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary">
                                        <Shield className="w-3 h-3" /> Forecast confidence: 88%
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="p-6 rounded-2xl border border-dashed border-foreground/10 flex flex-col items-center gap-3 text-center opacity-50">
                                <AlertCircle className="w-7 h-7 text-muted-foreground" />
                                <p className="text-xs font-bold">No Forecast Yet</p>
                                <p className="text-[11px] text-muted-foreground">Click "Simulate" to estimate cost & token load.</p>
                            </div>
                        )}

                        {/* Quick-switch templates */}
                        <Card className="border-foreground/10 bg-foreground/5">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                    Switch Template
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 pt-0">
                                {CYCLE_TEMPLATES.slice(0, 4).map(t => (
                                    <button key={t.id} type="button"
                                        onClick={() => applyTemplate(t, { guided: false })}
                                        className="flex items-center gap-3 p-3 w-full rounded-xl border border-foreground/5 bg-background/20 hover:bg-primary/5 hover:border-primary/30 transition-all text-left group">
                                        <span className="text-xl grayscale group-hover:grayscale-0 transition-all">{t.icon}</span>
                                        <span className="text-xs font-bold">{t.name}</span>
                                    </button>
                                ))}
                                <Button variant="ghost" onClick={() => setStep(0)} className="w-full text-xs h-8">
                                    View All Templates
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {/* ── Step 3: Resource Configuration ─────────────────────────────── */}
            {step === 3 && (
                <div className="w-full space-y-6 animate-in fade-in duration-400">
                    <Card className="border-primary/20 bg-primary/5 p-6 text-center space-y-3">
                        <div className="mx-auto w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                            <Target className="w-6 h-6 text-primary" />
                        </div>
                        <h2 className="text-xl font-black">Mission Pre-flight Check</h2>
                        <p className="text-sm text-muted-foreground">Provide human-supplied resources required before the fleet launches.</p>
                    </Card>

                    <div className="space-y-8">
                        {blueprints.filter(b => normalizeCycleInputRequirements(b).length > 0).map((bp, bi) => (
                            <div key={bi} className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-foreground text-xs font-black shadow-lg shadow-primary/20">
                                        {bi + 1}
                                    </div>
                                    <h3 className="text-lg font-bold">{bp.name}</h3>
                                </div>
                                <Card className="border-foreground/10 bg-foreground/5 overflow-hidden">
                                    <CardContent className="p-0 divide-y divide-white/5">
                                        {normalizeCycleInputRequirements(bp).map(res => (
                                            <div key={res.id} className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center gap-2">
                                                        {res.type === 'url_list' && <LinkIcon className="w-3.5 h-3.5 text-primary" />}
                                                        {res.type === 'dataset' && <Database className="w-3.5 h-3.5 text-primary" />}
                                                        {res.type === 'credential' && <Key className="w-3.5 h-3.5 text-primary" />}
                                                        {res.type === 'text' && <FileText className="w-3.5 h-3.5 text-primary" />}
                                                        {res.type === 'number' && <Hash className="w-3.5 h-3.5 text-primary" />}
                                                        <Label className="text-sm font-bold">{res.label}</Label>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground leading-relaxed">{res.description}</p>
                                                </div>
                                                <div className="md:col-span-2">
                                                    {res.type === 'url_list' ? (
                                                        <Textarea
                                                            className="bg-background/40 border-foreground/10 min-h-[100px] font-mono text-sm"
                                                            placeholder={res.placeholder || "One URL per line…"}
                                                            value={resourceAnswers[bp.name]?.[res.id] || ""}
                                                            onChange={e => setResourceAnswers(p => ({
                                                                ...p,
                                                                [bp.name]: { ...(p[bp.name] || {}), [res.id]: e.target.value }
                                                            }))}
                                                        />
                                                    ) : (
                                                        <Input
                                                            className="bg-background/40 border-foreground/10 h-11"
                                                            placeholder={res.placeholder}
                                                            value={resourceAnswers[bp.name]?.[res.id] || ""}
                                                            onChange={e => setResourceAnswers(p => ({
                                                                ...p,
                                                                [bp.name]: { ...(p[bp.name] || {}), [res.id]: e.target.value }
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

                    <div className="flex justify-between pt-4 border-t border-foreground/10">
                        <Button variant="ghost" onClick={() => setStep(2)}>← Back to Blueprints</Button>
                        <Button onClick={handleSubmit} disabled={launchMutation.isPending}
                            className="rounded-full px-10 bg-primary hover:bg-primary/90 shadow-xl shadow-primary/30 h-12 font-bold">
                            {launchMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                            Initialize Fleet Cycle
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
