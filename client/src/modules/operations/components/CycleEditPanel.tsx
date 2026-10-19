/**
 * CycleEditPanel — unified slide-over drawer for editing a cycle.
 * Four tabs: General (metadata), Blueprints (mission sequence), Resources
 * (human inputs), Integrations (per-cycle credential values).
 * Most changes are staged locally and submitted as a single PATCH on Save.
 * Integration values are saved per-credential via PUT (encrypted at rest).
 */
import React, { useState, useEffect } from "react";
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Settings, GitBranch, Package, Save, Loader2, TriangleAlert, Plug, CheckCircle2, AlertCircle, Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { TIMEZONES } from "@/lib/timezones";
import { BlueprintBuilder, type BlueprintValidationResult } from "./BlueprintBuilder";
import type { Blueprint } from "../data/cycle-templates";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { normalizeCycleInputRequirements } from "@shared/cycle-inputs";
import { normalizeCycleSchedule, previewCycleRuns, type CycleOverlapPolicy, type CycleScheduleMode } from "@shared/cycle-scheduling";

function toLocalDateTimeInput(value?: string | Date | null) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export interface CycleEditPanelProps {
    open: boolean;
    onClose: () => void;
    cycle: {
        id: number;
        name: string;
        description?: string;
        objective: string;
        status: string;
        priority?: number;
        budgetLimitUsd?: string | number;
        tokenLimit?: number;
        recurrence?: string;
        timezone?: string;
        startDate?: string;
        nextRunAt?: string | null;
        requiresApproval?: number;
        metadata?: {
            blueprints?: Blueprint[];
            resource_answers?: Record<string, Record<string, string>>;
        };
    };
    onSave: (patch: {
        name?: string;
        description?: string;
        objective?: string;
        priority?: number;
        budgetLimitUsd?: string;
        tokenLimit?: number;
        recurrence?: string;
        timezone?: string;
        nextRunAt?: string | null;
        requiresApproval?: number;
        metadata?: Record<string, any>;
        blueprints?: Blueprint[];
        resourceAnswers?: Record<string, Record<string, string>>;
        blueprintChangeReason?: string;
    }) => Promise<void>;
    saving?: boolean;
}
export function CycleEditPanel({ open, onClose, cycle, onSave, saving }: CycleEditPanelProps) {
    const panelRef = useModalBehavior<HTMLDivElement>({ isOpen: open, onClose });
    // General tab state
    const [name, setName] = useState(cycle.name);
    const [description, setDescription] = useState(cycle.description ?? "");
    const [objective, setObjective] = useState(cycle.objective);
    const [priority, setPriority] = useState(String(cycle.priority ?? 5));
    const [budget, setBudget] = useState(String(cycle.budgetLimitUsd ?? "100"));
    const [tokenLimit, setTokenLimit] = useState(String(cycle.tokenLimit ?? ""));
    const initialSchedule = normalizeCycleSchedule(cycle.metadata, cycle.recurrence, cycle.timezone);
    const [recurrence, setRecurrence] = useState<CycleScheduleMode>(initialSchedule.mode);
    const [requiresApproval, setRequiresApproval] = useState(!!(cycle.requiresApproval));
    const [followUpCycleTemplateId, setFollowUpCycleTemplateId] = useState<string>(
        String((cycle.metadata as any)?.follow_up_cycle_template_id || "")
    );
    const [timeUnit, setTimeUnit] = useState((cycle.metadata as any)?.timeUnit || "d");

    // Advanced Scheduling State
    const [cooldownMinutes, setCooldownMinutes] = useState<number>(initialSchedule.cooldownMinutes);
    const [anchorAt, setAnchorAt] = useState(toLocalDateTimeInput(initialSchedule.anchorAt ?? cycle.nextRunAt ?? cycle.startDate));
    const [timezone, setTimezone] = useState(initialSchedule.timezone);
    const [overlapPolicy, setOverlapPolicy] = useState<CycleOverlapPolicy>(initialSchedule.overlapPolicy);
    const [pauseOnFailure, setPauseOnFailure] = useState(initialSchedule.pauseOnFailure);
    const [catchupWindowHours, setCatchupWindowHours] = useState(Math.max(1, Math.round(initialSchedule.catchupWindowSeconds / 3600)));
    const [maxConsecutiveRuns, setMaxConsecutiveRuns] = useState(initialSchedule.maxConsecutiveRuns);

    // Blueprints tab state
    const [blueprints, setBlueprints] = useState<Blueprint[]>(cycle.metadata?.blueprints ?? []);
    const [blueprintChangeReason, setBlueprintChangeReason] = useState("");
    const [validation, setValidation] = useState<BlueprintValidationResult | null>(null);

    // Resources tab state
    const [resourceAnswers, setResourceAnswers] = useState<Record<string, Record<string, string>>>(
        cycle.metadata?.resource_answers ?? {}
    );

    // Sync blueprints timeUnit
    useEffect(() => {
        setBlueprints(prev => prev.map(bp => ({ ...bp, timeUnit: timeUnit as any })));
    }, [timeUnit]);

    // Reset local state when cycle changes or panel opens
    useEffect(() => {
        if (!open) return;
        setName(cycle.name);
        setDescription(cycle.description ?? "");
        setObjective(cycle.objective);
        setPriority(String(cycle.priority ?? 5));
        setBudget(String(cycle.budgetLimitUsd ?? "100"));
        setTokenLimit(String(cycle.tokenLimit ?? ""));
        const scheduling = normalizeCycleSchedule(cycle.metadata, cycle.recurrence, cycle.timezone);
        setRecurrence(scheduling.mode);
        setRequiresApproval(!!(cycle.requiresApproval));
        setFollowUpCycleTemplateId(String((cycle.metadata as any)?.follow_up_cycle_template_id || ""));
        const nextTimeUnit = (cycle.metadata as any)?.timeUnit || "d";
        setTimeUnit(nextTimeUnit);
        
        setCooldownMinutes(scheduling.cooldownMinutes);
        setAnchorAt(toLocalDateTimeInput(scheduling.anchorAt ?? cycle.nextRunAt ?? cycle.startDate));
        setTimezone(scheduling.timezone);
        setOverlapPolicy(scheduling.overlapPolicy);
        setPauseOnFailure(scheduling.pauseOnFailure);
        setCatchupWindowHours(Math.max(1, Math.round(scheduling.catchupWindowSeconds / 3600)));
        setMaxConsecutiveRuns(scheduling.maxConsecutiveRuns);

        setBlueprints((cycle.metadata?.blueprints ?? []).map(bp => ({ ...bp, timeUnit: nextTimeUnit as any })));
        setResourceAnswers(cycle.metadata?.resource_answers ?? {});
        setBlueprintChangeReason("");
        setValidation(null);
    }, [open, cycle.id]);

    // Fetch available cycle templates
    const { data: templates } = useQuery<{ id: number; name: string }[]>({
        queryKey: ["/api/cycle-collaboration/templates"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/cycle-collaboration/templates");
            return res.json();
        },
        enabled: open,
    });

    const blueprintsWithResources = blueprints.filter(b => normalizeCycleInputRequirements(b).length > 0);
    const isLive = ["active", "running", "paused"].includes(cycle.status);
    const hasValidationErrors = validation !== null && !validation.valid && (validation.errors?.length ?? 0) > 0;

    const currentSchedule = normalizeCycleSchedule({
        scheduling: {
            mode: recurrence,
            enabled: recurrence !== "once",
            anchorAt: anchorAt ? new Date(anchorAt).toISOString() : null,
            timezone,
            overlapPolicy,
            pauseOnFailure,
            catchupWindowSeconds: catchupWindowHours * 3600,
            cooldownMinutes,
            maxConsecutiveRuns,
        }
    }, recurrence, timezone);
    const schedulePreview = previewCycleRuns(new Date(), currentSchedule, 5);

    const handleSave = async () => {
        const nextRunAt = recurrence === "on_complete" || recurrence === "once"
            ? null
            : (schedulePreview[0]?.toISOString() ?? (anchorAt ? new Date(anchorAt).toISOString() : null));

        await onSave({
            name: name.trim() || undefined,
            description: description.trim() || undefined,
            objective: objective.trim() || undefined,
            priority: parseInt(priority) || undefined,
            budgetLimitUsd: budget || undefined,
            tokenLimit: tokenLimit ? parseInt(tokenLimit) : undefined,
            recurrence,
            timezone: timezone,
            nextRunAt,
            requiresApproval: requiresApproval ? 1 : 0,
            blueprints: blueprints.map(bp => ({ ...bp, timeUnit: timeUnit as any })),
            resourceAnswers,
            ...(blueprintChangeReason.trim() ? { blueprintChangeReason: blueprintChangeReason.trim() } : {}),
            metadata: {
                ...cycle.metadata,
                follow_up_cycle_template_id: followUpCycleTemplateId ? Number(followUpCycleTemplateId) : null,
                timeUnit: timeUnit,
                scheduling: {
                    mode: recurrence,
                    type: recurrence,
                    enabled: recurrence !== "once",
                    anchorAt: anchorAt ? new Date(anchorAt).toISOString() : null,
                    nextRunAt,
                    timezone,
                    overlapPolicy,
                    pauseOnFailure,
                    catchupWindowSeconds: catchupWindowHours * 3600,
                    cooldownMinutes,
                    maxConsecutiveRuns,
                    ganttResetAt: recurrence === "on_complete"
                        ? ((cycle.metadata as any)?.scheduling?.ganttResetAt ?? new Date().toISOString())
                        : (cycle.metadata as any)?.scheduling?.ganttResetAt,
                }
            }
        });
    };

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 z-overlay backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Slide-over panel */}
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Edit cycle"
                className="fixed right-0 top-0 bottom-0 w-full max-w-2xl z-modal flex flex-col bg-background border-l border-white/10 shadow-2xl animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="flex flex-col gap-3 border-b border-white/5 px-4 py-3 shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <Settings className="w-5 h-5 text-primary" />
                        <div className="min-w-0">
                            <h2 className="text-lg font-black tracking-tight">Edit Cycle</h2>
                            <p className="truncate text-[10px] text-muted-foreground font-medium">{cycle.name}</p>
                        </div>
                        {isLive && (
                            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[9px]">
                                LIVE
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={handleSave}
                            disabled={saving || hasValidationErrors}
                            className="h-9 flex-1 rounded-full bg-primary px-4 hover:bg-primary/90 shadow-lg shadow-primary/20 sm:flex-none sm:px-5"
                            title={hasValidationErrors ? "Fix blueprint validation errors before saving" : undefined}
                        >
                            {saving
                                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                : <Save className="w-4 h-4 mr-2" />}
                            Save Changes
                        </Button>
                        <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="general" className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="flex h-12 shrink-0 justify-start overflow-x-auto rounded-none border-b border-white/5 bg-black/30 px-2 py-0 sm:grid sm:h-11 sm:grid-cols-4 sm:px-6">
                        <TabsTrigger value="general" className="h-full shrink-0 rounded-none border-b-2 border-transparent px-3 text-xs font-bold data-[state=active]:border-primary data-[state=active]:bg-transparent sm:px-2">
                            <Settings className="w-3.5 h-3.5 mr-1.5" /> General
                        </TabsTrigger>
                        <TabsTrigger value="blueprints" className="h-full shrink-0 rounded-none border-b-2 border-transparent px-3 text-xs font-bold data-[state=active]:border-primary data-[state=active]:bg-transparent sm:px-2">
                            <GitBranch className="w-3.5 h-3.5 mr-1.5" /> Blueprints
                            {hasValidationErrors && <TriangleAlert className="w-3 h-3 ml-1 text-red-400" />}
                        </TabsTrigger>
                        <TabsTrigger value="resources" className="h-full shrink-0 rounded-none border-b-2 border-transparent px-3 text-xs font-bold data-[state=active]:border-primary data-[state=active]:bg-transparent sm:px-2">
                            <Package className="w-3.5 h-3.5 mr-1.5" /> Resources
                            {blueprintsWithResources.length > 0 && (
                                <Badge variant="outline" className="ml-1.5 text-[8px] h-4">{blueprintsWithResources.length}</Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="integrations" className="h-full shrink-0 rounded-none border-b-2 border-transparent px-3 text-xs font-bold data-[state=active]:border-primary data-[state=active]:bg-transparent sm:px-2">
                            <Plug className="w-3.5 h-3.5 mr-1.5" /> Integrations
                        </TabsTrigger>
                    </TabsList>

                    {/* ── General ───────────────────────────────────────────── */}
                    <TabsContent value="general" className="flex-1 overflow-y-auto px-4 py-4 space-y-5 mt-0 sm:px-6 sm:py-5">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Cycle Name</Label>
                            <Input value={name} onChange={e => setName(e.target.value)}
                                className="bg-black/40 border-white/10" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input value={description} onChange={e => setDescription(e.target.value)}
                                placeholder="Short summary of this cycle's purpose…"
                                className="bg-black/40 border-white/10" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Strategic Objective</Label>
                            <Textarea value={objective} onChange={e => setObjective(e.target.value)}
                                rows={4} className="bg-black/40 border-white/10 resize-none" />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Recurrence</Label>
                                <Select value={recurrence} onValueChange={(value) => setRecurrence(value as CycleScheduleMode)}>
                                    <SelectTrigger className="bg-black/40 border-white/10">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="once">Once</SelectItem>
                                        <SelectItem value="yearly">Yearly</SelectItem>
                                        <SelectItem value="monthly">Monthly</SelectItem>
                                        <SelectItem value="weekly">Weekly</SelectItem>
                                        <SelectItem value="daily">Daily</SelectItem>
                                        <SelectItem value="hourly">Hourly</SelectItem>
                                        <SelectItem value="on_complete">On Complete</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Priority (1–10)</Label>
                                <Input type="number" min={1} max={10} value={priority}
                                    onChange={e => setPriority(e.target.value)}
                                    className="bg-black/40 border-white/10" />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Time Scale Resolution (Gantt)</Label>
                            <Select value={timeUnit} onValueChange={setTimeUnit}>
                                <SelectTrigger className="bg-black/40 border-white/10">
                                    <SelectValue placeholder="Select scale resolution" />
                                </SelectTrigger>
                                <SelectContent className="bg-background border-white/10">
                                    <SelectItem value="ms">Milliseconds (ms)</SelectItem>
                                    <SelectItem value="s">Seconds (s)</SelectItem>
                                    <SelectItem value="m">Minutes (m)</SelectItem>
                                    <SelectItem value="h">Hours (h)</SelectItem>
                                    <SelectItem value="d">Days (d)</SelectItem>
                                    <SelectItem value="w">Weeks (w)</SelectItem>
                                    <SelectItem value="M">Months (M)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {recurrence !== "once" && (
                            <div className="space-y-4 rounded-xl border border-white/10 bg-foreground/[0.02] p-4 animate-in fade-in slide-in-from-top-1">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40">Schedule Policy</Label>
                                    <p className="text-[11px] text-muted-foreground">
                                        Runs are scheduled independently from execution. By default, a new start is skipped while a prior wave is still active.
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    {recurrence !== "on_complete" && (
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold">First Run / Anchor</Label>
                                            <Input type="datetime-local" value={anchorAt} onChange={e => setAnchorAt(e.target.value)} className="bg-black/40 border-white/10" />
                                        </div>
                                    )}
                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-semibold">Timezone</Label>
                                        <Select value={timezone} onValueChange={setTimezone}>
                                            <SelectTrigger className="bg-black/40 border-white/10">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-[300px] bg-background border-white/10">
                                                {TIMEZONES.map(tz => (
                                                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-semibold">Overlap Policy</Label>
                                        <Select value={overlapPolicy} onValueChange={(value) => setOverlapPolicy(value as CycleOverlapPolicy)}>
                                            <SelectTrigger className="bg-black/40 border-white/10">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-background border-white/10">
                                                <SelectItem value="skip">Skip if running</SelectItem>
                                                <SelectItem value="buffer_one">Buffer one run</SelectItem>
                                                <SelectItem value="allow_all">Allow concurrent runs</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-semibold">Catch-up Window (hours)</Label>
                                        <Input type="number" min={1} value={catchupWindowHours} onChange={e => setCatchupWindowHours(Math.max(1, Number(e.target.value)))} className="bg-black/40 border-white/10" />
                                    </div>
                                </div>
                                {recurrence === "on_complete" && (
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold">Cooldown Buffer (minutes)</Label>
                                            <Input type="number" min={0} value={cooldownMinutes} onChange={e => setCooldownMinutes(Math.max(0, Number(e.target.value)))} className="bg-black/40 border-white/10" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold">Runaway Guard</Label>
                                            <Input type="number" min={1} value={maxConsecutiveRuns} onChange={e => setMaxConsecutiveRuns(Math.max(1, Number(e.target.value)))} className="bg-black/40 border-white/10" />
                                        </div>
                                    </div>
                                )}
                                <div className="flex items-center gap-3">
                                    <Checkbox id="pause-on-failure" checked={pauseOnFailure} onCheckedChange={v => setPauseOnFailure(!!v)} />
                                    <Label htmlFor="pause-on-failure" className="text-xs font-semibold cursor-pointer">
                                        Pause schedule after failed cycle synthesis
                                    </Label>
                                </div>
                                {recurrence !== "on_complete" && (
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-foreground/40">Next Starts</Label>
                                        <div className="flex flex-wrap gap-2">
                                            {schedulePreview.length > 0 ? schedulePreview.map((run) => (
                                                <Badge key={run.toISOString()} variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                                                    {run.toLocaleString()}
                                                </Badge>
                                            )) : (
                                                <span className="text-xs text-muted-foreground">No future starts from this schedule.</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Budget Limit (USD)</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
                                    <Input type="number" min={0} step={10} value={budget}
                                        onChange={e => setBudget(e.target.value)}
                                        className="pl-6 bg-black/40 border-white/10" />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Token Limit <span className="text-muted-foreground font-normal">(0 = unlimited)</span></Label>
                                <Input type="number" min={0} step={100000} value={tokenLimit}
                                    onChange={e => setTokenLimit(e.target.value)}
                                    placeholder="e.g. 1000000"
                                    className="bg-black/40 border-white/10" />
                            </div>
                        </div>
                        <div className="space-y-1.5 pt-2">
                            <Label className="text-xs font-semibold flex items-center gap-1.5">
                                <GitBranch className="w-3.5 h-3.5 text-primary" /> Follow-up Cycle
                            </Label>
                            <Select value={followUpCycleTemplateId || "none"} onValueChange={(val) => setFollowUpCycleTemplateId(val === "none" ? "" : val)}>
                                <SelectTrigger className="bg-black/40 border-white/10">
                                    <SelectValue placeholder="None (Disabled)" />
                                </SelectTrigger>
                                <SelectContent className="bg-background border-white/10">
                                    <SelectItem value="none">None (Disabled)</SelectItem>
                                    {templates?.map(t => (
                                        <SelectItem key={t.id} value={String(t.id)}>
                                            {t.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground">
                                Automatically initiate a new cycle from the selected template when this cycle completes successfully.
                            </p>
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                            <Checkbox id="ep-hil" checked={requiresApproval}
                                onCheckedChange={v => setRequiresApproval(!!v)} />
                            <Label htmlFor="ep-hil" className="text-xs font-semibold cursor-pointer">
                                Require Human-in-the-Loop approval before launch
                            </Label>
                        </div>
                    </TabsContent>

                    {/* ── Blueprints ─────────────────────────────────────────── */}
                    <TabsContent value="blueprints" className="flex-1 overflow-y-auto px-4 py-4 space-y-4 mt-0 sm:px-6 sm:py-5">
                        {isLive && (
                            <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300 text-xs">
                                <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-bold">Live cycle — changes will be recorded</p>
                                    <p className="text-amber-700 dark:text-amber-200/60 mt-0.5">The previous blueprint plan will be saved to revision history before your changes apply.</p>
                                </div>
                            </div>
                        )}
                        {isLive && (
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-muted-foreground">Change reason <span className="font-normal">(recommended)</span></Label>
                                <Textarea
                                    value={blueprintChangeReason}
                                    onChange={e => setBlueprintChangeReason(e.target.value)}
                                    placeholder="Why is this plan changing?"
                                    rows={2}
                                    className="bg-black/40 border-amber-500/20 resize-none text-sm"
                                />
                            </div>
                        )}
                        <BlueprintBuilder
                            blueprints={blueprints}
                            onChange={bp => { setBlueprints(bp); setValidation(null); }}
                            cycleId={cycle.id}
                            onValidation={setValidation}
                        />
                    </TabsContent>

                    {/* ── Resources ──────────────────────────────────────────── */}
                    <TabsContent value="resources" className="flex-1 overflow-y-auto px-4 py-4 space-y-6 mt-0 sm:px-6 sm:py-5">
                        {blueprintsWithResources.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center gap-3 opacity-50">
                                <Package className="w-10 h-10 text-muted-foreground" />
                                <p className="text-sm font-bold">No resources declared</p>
                                <p className="text-xs text-muted-foreground">Add resource requirements to blueprints in the Blueprints tab.</p>
                            </div>
                        ) : (
                            blueprintsWithResources.map(bp => (
                                <div key={bp.name} className="space-y-4">
                                    <p className="text-xs font-black uppercase tracking-widest text-primary/70">{bp.name}</p>
                                    {normalizeCycleInputRequirements(bp).map(res => {
                                        const current = resourceAnswers[bp.name]?.[res.id] ?? "";
                                        const update = (val: string) => setResourceAnswers(p => ({
                                            ...p,
                                            [bp.name]: { ...(p[bp.name] ?? {}), [res.id]: val },
                                        }));
                                        return (
                                            <div key={res.id} className="space-y-1.5">
                                                <Label className="text-xs font-semibold">
                                                    {res.label}
                                                    {res.required && <span className="text-red-400 ml-1">*</span>}
                                                </Label>
                                                <p className="text-[10px] text-muted-foreground">{res.description}</p>
                                                {res.type === "url_list" ? (
                                                    <Textarea
                                                        value={current}
                                                        onChange={e => update(e.target.value)}
                                                        placeholder={res.placeholder ?? "One URL per line…"}
                                                        rows={4}
                                                        className="bg-black/40 border-white/10 font-mono text-xs resize-none"
                                                    />
                                                ) : (
                                                    <Input
                                                        value={current}
                                                        onChange={e => update(e.target.value)}
                                                        placeholder={res.placeholder ?? `Enter ${res.label}…`}
                                                        className="bg-black/40 border-white/10 text-sm"
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </TabsContent>

                    {/* ── Integrations ──────────────────────────────────────── */}
                    <TabsContent value="integrations" className="flex-1 overflow-y-auto px-4 py-4 space-y-4 mt-0 sm:px-6 sm:py-5">
                        <IntegrationsTab cycleId={cycle.id} open={open} />
                    </TabsContent>
                </Tabs>
            </div>
        </>
    );
}

// ─── Integrations Tab ──────────────────────────────────────────────────────────

interface CycleIntegration {
    credentialId: number;
    name: string;
    integrationName: string;
    type: string;
    envVarName: string;
    status: "set_encrypted" | "set_env" | "missing";
    metadata: Record<string, any>;
}

function IntegrationsTab({ cycleId, open }: { cycleId: number; open: boolean }) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [drafts, setDrafts] = useState<Record<number, string>>({});
    const [revealed, setRevealed] = useState<Record<number, boolean>>({});

    const { data, isLoading, error } = useQuery<{ encryptionAvailable: boolean; integrations: CycleIntegration[] }>({
        queryKey: ["/api/cycles", cycleId, "integrations"],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/cycles/${cycleId}/integrations`);
            return res.json();
        },
        enabled: open,
    });

    const saveMutation = useMutation({
        mutationFn: async ({ credentialId, value }: { credentialId: number; value: string }) => {
            const res = await apiRequest("PUT", `/api/cycles/${cycleId}/integrations/${credentialId}`, { value });
            if (!res.ok) throw new Error((await res.json()).error || "Save failed");
            return res.json();
        },
        onSuccess: (_data, { credentialId }) => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles", cycleId, "integrations"] });
            setDrafts(p => { const n = { ...p }; delete n[credentialId]; return n; });
            toast({ title: "Saved", description: "Encrypted at rest." });
        },
        onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
    });

    const clearMutation = useMutation({
        mutationFn: async (credentialId: number) => {
            const res = await apiRequest("DELETE", `/api/cycles/${cycleId}/integrations/${credentialId}`);
            if (!res.ok) throw new Error((await res.json()).error || "Clear failed");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/cycles", cycleId, "integrations"] });
            toast({ title: "Cleared", description: "Falling back to env var if set." });
        },
        onError: (err: any) => toast({ title: "Clear failed", description: err.message, variant: "destructive" }),
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (error) {
        return (
            <div className="text-sm text-red-400 py-4">Failed to load integrations: {(error as Error).message}</div>
        );
    }
    const integrations = data?.integrations ?? [];
    if (integrations.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3 opacity-50">
                <Plug className="w-10 h-10 text-muted-foreground" />
                <p className="text-sm font-bold">No integrations declared</p>
                <p className="text-xs text-muted-foreground">This cycle was installed without any external credential references.</p>
            </div>
        );
    }

    return (
        <>
            {!data?.encryptionAvailable && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                        <p className="text-xs font-bold text-red-700 dark:text-red-300">Encryption not configured</p>
                        <p className="text-[11px] text-red-700 dark:text-red-300/80">Set <code className="bg-black/30 px-1 rounded">ENCRYPTION KEY</code> (32-byte hex) on the server to enable saving secret values. Until then, only environment variables can supply credentials.</p>
                    </div>
                </div>
            )}

            {integrations.map(it => {
                const draft = drafts[it.credentialId] ?? "";
                const isRevealed = revealed[it.credentialId];
                const statusBadge = it.status === "set_encrypted"
                    ? <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"><CheckCircle2 className="w-3 h-3 mr-1" /> Encrypted</Badge>
                    : it.status === "set_env"
                        ? <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30"><CheckCircle2 className="w-3 h-3 mr-1" /> Env var set</Badge>
                        : <Badge className="bg-red-500/10 text-red-400 border-red-500/30"><AlertCircle className="w-3 h-3 mr-1" /> Missing</Badge>;

                return (
                    <div key={it.credentialId} className="space-y-2 p-3 rounded-lg border border-white/5 bg-black/20">
                        <div className="flex items-center justify-between gap-2">
                            <div className="space-y-0.5 min-w-0">
                                <p className="text-xs font-bold uppercase tracking-wide truncate">{it.integrationName}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">env: {it.envVarName}</p>
                            </div>
                            {statusBadge}
                        </div>

                        {Object.keys(it.metadata).length > 0 && (
                            <div className="text-[10px] text-muted-foreground space-y-0.5">
                                {Object.entries(it.metadata).map(([k, v]) => (
                                    <div key={k} className="flex gap-2"><span className="opacity-60">{k}:</span><span className="font-mono truncate">{typeof v === "object" && v?.envVarName ? `\${ENV.${v.envVarName}}` : String(v)}</span></div>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-2 items-stretch">
                            <Input
                                type={isRevealed ? "text" : "password"}
                                value={draft}
                                placeholder={it.status === "missing" ? "Paste secret value…" : "Replace existing value…"}
                                onChange={e => setDrafts(p => ({ ...p, [it.credentialId]: e.target.value }))}
                                disabled={!data?.encryptionAvailable}
                                className="bg-black/40 border-white/10 text-xs font-mono flex-1"
                            />
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setRevealed(p => ({ ...p, [it.credentialId]: !p[it.credentialId] }))}
                                className="h-9 px-2"
                                title={isRevealed ? "Hide" : "Reveal"}
                            >
                                {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                disabled={!draft || saveMutation.isPending || !data?.encryptionAvailable}
                                onClick={() => saveMutation.mutate({ credentialId: it.credentialId, value: draft })}
                                className="h-9 px-3 text-xs font-bold"
                            >
                                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                            </Button>
                            {it.status === "set_encrypted" && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => clearMutation.mutate(it.credentialId)}
                                    disabled={clearMutation.isPending}
                                    className="h-9 px-2 text-red-400 border-red-500/30 hover:bg-red-500/10"
                                    title="Remove stored value"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            )}
                        </div>
                    </div>
                );
            })}
        </>
    );
}
