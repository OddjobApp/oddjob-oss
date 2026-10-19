import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import {
    Save,
    Plus,
    Trash2,
    Star,
    StarOff,
    Zap,
    GitCompare,
    Camera,
    CheckCircle2,
    XCircle,
    ArrowRightLeft,
    ChevronDown,
    ChevronRight,
    AlertTriangle,
    Clock,
    Hash,
    X,
    Loader2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import type { JobDiffConfig } from "@shared/schema/jobs/table";
import { cn } from "@/lib/utils";

const isSuccessStatus = (status: string) => status === "success" || status === "completed";

interface JobReactiveTabProps {
    jobId: number;
}

// ─── Diff result viewer ──────────────────────────────────────────────────────

interface DiffChange {
    op: "add" | "remove" | "replace";
    path: string;
    value?: any;
    oldValue?: any;
}

interface DiffResult {
    hasChanges: boolean;
    changeCount: number;
    changes: DiffChange[];
    summary: { added: number; removed: number; modified: number };
}

function DiffChangeRow({ change }: { change: DiffChange }) {
    const [open, setOpen] = useState(false);

    const opStyles = {
        add: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
        remove: "text-red-400 bg-red-500/10 border-red-500/20",
        replace: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    };
    const opLabels = { add: "+ADD", remove: "−DEL", replace: "~MOD" };

    return (
        <div className="border border-foreground/5 rounded-xl overflow-hidden bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors">
            <button
                type="button"
                className="w-full flex items-center gap-3 p-3 text-left transition-colors"
                onClick={() => setOpen(o => !o)}
            >
                <Badge className={`text-[9px] font-black px-1.5 py-0 shrink-0 italic tracking-widest ${opStyles[change.op]}`}>
                    {opLabels[change.op]}
                </Badge>
                <span className="text-[11px] font-mono truncate flex-1 text-foreground/40 italic">{change.path}</span>
                {(change.value !== undefined || change.oldValue !== undefined) && (
                    open ? <ChevronDown className="w-3 h-3 text-foreground/20 shrink-0" />
                         : <ChevronRight className="w-3 h-3 text-foreground/20 shrink-0" />
                )}
            </button>
            {open && (change.value !== undefined || change.oldValue !== undefined) && (
                <div className="px-4 pb-4 space-y-3 bg-background/40 border-t border-foreground/5">
                    {change.oldValue !== undefined && (
                        <div>
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-red-400/60 block mb-1.5 italic">PREVIOUS STATE</span>
                            <pre className="text-[10px] font-mono bg-red-500/5 border border-red-500/10 p-3 rounded-lg overflow-auto max-h-32 text-red-700 dark:text-red-200/70">
                                {JSON.stringify(change.oldValue, null, 2)}
                            </pre>
                        </div>
                    )}
                    {change.value !== undefined && (
                        <div>
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400/60 block mb-1.5 italic">EVOLVED STATE</span>
                            <pre className="text-[10px] font-mono bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-lg overflow-auto max-h-32 text-emerald-700 dark:text-emerald-200/70">
                                {JSON.stringify(change.value, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function DiffResultPanel({ diff, title = "Diff Result" }: { diff: DiffResult; title?: string }) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/30 italic">{title}</span>
                <div className="flex items-center gap-2">
                    {diff.summary.added > 0 && (
                        <Badge variant="outline" className="text-[9px] font-black px-2 py-0.5 text-emerald-400 border-emerald-500/20 bg-emerald-500/10 italic">
                            +{diff.summary.added}_ADDED
                        </Badge>
                    )}
                    {diff.summary.removed > 0 && (
                        <Badge variant="outline" className="text-[9px] font-black px-2 py-0.5 text-red-400 border-red-500/20 bg-red-500/10 italic">
                            −{diff.summary.removed}_REMOVED
                        </Badge>
                    )}
                    {diff.summary.modified > 0 && (
                        <Badge variant="outline" className="text-[9px] font-black px-2 py-0.5 text-amber-400 border-amber-500/20 bg-amber-500/10 italic">
                            ~{diff.summary.modified}_MUTATED
                        </Badge>
                    )}
                    {!diff.hasChanges && (
                        <Badge variant="outline" className="text-[9px] font-black px-2 py-0.5 text-foreground/20 border-foreground/5 italic">
                            ZERO DRIFT
                        </Badge>
                    )}
                </div>
            </div>
            {diff.hasChanges && (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {diff.changes.map((c, i) => (
                        <DiffChangeRow key={i} change={c} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Tag input for ignore paths ──────────────────────────────────────────────

function IgnorePathsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const [input, setInput] = useState("");

    const add = () => {
        const p = input.trim();
        if (p && !value.includes(p)) onChange([...value, p]);
        setInput("");
    };

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Input
                    value={input}
                    placeholder="E.G., METADATA.TIMESTAMP, RUN_ID"
                    className="h-10 text-[11px] font-mono bg-foreground/[0.03] border-foreground/10 italic tracking-widest uppercase"
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
                />
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 border-foreground/10 hover:bg-foreground/5" onClick={add}>
                    <Plus className="w-4 h-4 text-primary" />
                </Button>
            </div>
            {value.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {value.map(p => (
                        <span key={p} className="inline-flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-2.5 py-1 text-[10px] font-mono text-primary italic">
                            {p.toUpperCase()}
                            <button type="button" title={`Remove ${p}`} onClick={() => onChange(value.filter(v => v !== p))}>
                                <X className="w-3 h-3 text-primary/40 hover:text-primary transition-colors" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function JobReactiveTab({ jobId }: JobReactiveTabProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: job, isLoading: jobLoading } = useQuery<any>({
        queryKey: [`/api/jobs/${jobId}`],
    });

    const { data: snapshots = [], isLoading: snapsLoading } = useQuery<any[]>({
        queryKey: [`/api/snapshots`, { entityType: "job_output", jobId }],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/snapshots?entityType=job_output&jobId=${jobId}`);
            if (!res.ok) return [];
            return res.json();
        },
        enabled: !!jobId,
    });

    const { data: executions = [] } = useQuery<any[]>({
        queryKey: [`/api/jobs/${jobId}/executions`],
        enabled: !!jobId,
    });

    const [cfg, setCfg] = useState<JobDiffConfig>({
        enabled: false,
        mode: "latest",
        ignorePaths: [],
        threshold: undefined,
    });

    const [snapshotLabel, setSnapshotLabel] = useState("");
    const [snapshotDesc, setSnapshotDesc] = useState("");

    const [livePreview, setLivePreview] = useState<DiffResult | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    useEffect(() => {
        if (job?.diffConfig) {
            const dc = job.diffConfig as any;
            setCfg({
                enabled: dc.enabled ?? false,
                mode: dc.mode ?? "latest",
                baselineSnapshotId: dc.baselineSnapshotId ?? undefined,
                ignorePaths: dc.ignorePaths ?? [],
                threshold: dc.threshold ?? undefined,
            });
        }
    }, [job]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("PUT", `/api/jobs/${jobId}`, { diffConfig: cfg });
            if (!res.ok) throw new Error("Save failed");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}`] });
            toast({ title: "Governance Matrix Updated", description: "Reactive drift detection protocols are now active." });
        },
        onError: (err: any) => toast({ title: "Sync Error", description: err.message, variant: "destructive" }),
    });

    const captureMutation = useMutation({
        mutationFn: async () => {
            const lastSuccess = executions.find((e: any) =>
                isSuccessStatus(e.status)
            );
            if (!lastSuccess?.output) throw new Error("No valid state output detected in latest cycles");

            let data: any;
            try { data = JSON.parse(lastSuccess.output); } catch { data = { value: lastSuccess.output }; }

            const res = await apiRequest("POST", "/api/snapshots", {
                entityType: "job_output",
                entityId: jobId,
                jobId,
                data,
                label: snapshotLabel || `BASELINE_${new Date().getTime().toString().slice(-4)}`,
                description: snapshotDesc || null,
                isPrimary: snapshots.length === 0, 
            });
            if (!res.ok) throw new Error("Registry write failed");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/snapshots`, { entityType: "job_output", jobId }] });
            setSnapshotLabel("");
            setSnapshotDesc("");
            toast({ title: "Gold Baseline Captured", description: "System state pinned for fixed-delta comparison." });
        },
        onError: (err: any) => toast({ title: "Capture Failure", description: err.message, variant: "destructive" }),
    });

    const setPrimaryMutation = useMutation({
        mutationFn: async (snapshotId: number) => {
            const res = await apiRequest("PATCH", `/api/snapshots/${snapshotId}/primary`, {});
            if (!res.ok) throw new Error("Promotion failed");
            return res.json();
        },
        onSuccess: (updated) => {
            queryClient.invalidateQueries({ queryKey: [`/api/snapshots`, { entityType: "job_output", jobId }] });
            setCfg(prev => ({ ...prev, baselineSnapshotId: updated.id }));
            toast({ title: "Baseline Promoted", description: "Snapshot is now the primary reference point." });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (snapshotId: number) => {
            const res = await apiRequest("DELETE", `/api/snapshots/${snapshotId}`, {});
            if (!res.ok) throw new Error("Purge failed");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/snapshots`, { entityType: "job_output", jobId }] });
            toast({ title: "Snapshot Purged" });
        },
    });

    const loadLivePreview = async () => {
        const successes = executions.filter((e: any) =>
            isSuccessStatus(e.status)
        );
        if (successes.length < 2) {
            toast({ title: "Incomplete Telemetry", description: "Protocol requires 2+ successful cycles for drift analysis.", variant: "destructive" });
            return;
        }
        setPreviewLoading(true);
        try {
            let baseline: any, current: any;
            try { baseline = JSON.parse(successes[1].output ?? "{}"); } catch { baseline = { value: successes[1].output }; }
            try { current = JSON.parse(successes[0].output ?? "{}"); } catch { current = { value: successes[0].output }; }

            const res = await apiRequest("POST", "/api/snapshots/diff/preview", {
                baseline,
                current,
                ignorePaths: cfg.ignorePaths,
            });
            const result = await res.json();
            setLivePreview(result);
        } catch {
            toast({ title: "Analysis Interrupted", description: "Could not establish delta between state fragments.", variant: "destructive" });
        } finally {
            setPreviewLoading(false);
        }
    };

    if (jobLoading) return (
        <div className="flex flex-col items-center justify-center p-24 text-[11px] font-black uppercase tracking-[0.5em] text-primary/40 animate-pulse italic">
            <Loader2 className="w-8 h-8 animate-spin mb-4 opacity-20" />
            Synchronizing Governance Data...
        </div>
    );

    const successfulRuns = executions.filter((e: any) =>
        isSuccessStatus(e.status)
    );

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Action Bar */}
            <div className="flex items-center justify-between glass-panel-heavy p-4 rounded-3xl border-foreground/5">
                <div className="flex items-center gap-4 pl-2">
                    <div className={cn(
                        "w-2 h-2 rounded-full animate-pulse",
                        cfg.enabled ? "bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.8)]" : "bg-foreground/10"
                    )} />
                    <div className="space-y-0.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground italic">
                            Reactive Drift Governance
                        </span>
                        <p className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest italic">
                            {cfg.enabled ? "STATUS: ACTIVE_MONITORING" : "STATUS: DORMANT"}
                        </p>
                    </div>
                </div>
                <Button
                    className="h-11 px-8 text-[10px] font-black uppercase tracking-[0.2em] gap-3 italic rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_hsl(var(--primary)/0.2)]"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                >
                    <Save className="w-4 h-4" />
                    {saveMutation.isPending ? "COMMITTING..." : "SAVE_PROTOCOLS"}
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* ── Left: Configuration ── */}
                <div className="space-y-6">
                    <Card className="glass-panel-deep border-foreground/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
                        <CardHeader className="border-b border-foreground/5 bg-foreground/[0.01] py-6 px-8">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-primary italic">
                                <GitCompare className="w-4 h-4" /> Configuration Matrix
                            </CardTitle>
                            <CardDescription className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mt-1 italic leading-relaxed">
                                Define significance thresholds and state exclusion filters.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-8 space-y-8">
                            {/* Enable toggle */}
                            <div className="flex items-center justify-between p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/5">
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-widest text-foreground italic">Initiate Detection</p>
                                    <p className="text-[9px] font-bold text-foreground/30 mt-1 uppercase tracking-widest italic">
                                        Track state evolution across successive cycles.
                                    </p>
                                </div>
                                <Switch
                                    checked={cfg.enabled}
                                    onCheckedChange={v => setCfg(prev => ({ ...prev, enabled: v }))}
                                    className="data-[state=checked]:bg-primary"
                                />
                            </div>

                            {cfg.enabled && (
                                <div className="space-y-8 animate-in fade-in duration-500">
                                    {/* Mode selection */}
                                    <div className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">
                                            Comparison Heuristics
                                        </Label>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { id: 'latest', label: 'Rolling_Cycle', sub: 'Compare N with N-1' },
                                                { id: 'baseline', label: 'Fixed_Baseline', sub: 'Compare N with Gold' }
                                            ].map(m => (
                                                <button
                                                    key={m.id}
                                                    onClick={() => setCfg(prev => ({ ...prev, mode: m.id as any }))}
                                                    className={cn(
                                                        "flex flex-col items-start gap-1.5 p-4 rounded-2xl border-2 text-left transition-all",
                                                        cfg.mode === m.id 
                                                            ? "bg-primary/5 border-primary shadow-[0_0_15px_hsl(var(--primary)/0.1)]" 
                                                            : "bg-foreground/[0.02] border-foreground/5 hover:border-foreground/10"
                                                    )}
                                                >
                                                    <span className={cn(
                                                        "text-[10px] font-black uppercase tracking-widest",
                                                        cfg.mode === m.id ? "text-primary" : "text-foreground/60"
                                                    )}>{m.label}</span>
                                                    <span className="text-[8px] font-bold text-foreground/20 uppercase tracking-widest italic">{m.sub}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Snapshot selector for baseline mode */}
                                    {cfg.mode === "baseline" && snapshots.length > 0 && (
                                        <div className="space-y-3 animate-in slide-in-from-top-2">
                                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">
                                                Active Reference State
                                            </Label>
                                            <Select
                                                value={cfg.baselineSnapshotId ? String(cfg.baselineSnapshotId) : "__primary__"}
                                                onValueChange={v => setCfg(prev => ({
                                                    ...prev,
                                                    baselineSnapshotId: v === "__primary__" ? undefined : parseInt(v),
                                                }))}
                                            >
                                                <SelectTrigger className="h-12 bg-foreground/[0.03] border-foreground/5 rounded-2xl text-[10px] font-black tracking-widest italic text-foreground uppercase px-4">
                                                    <SelectValue placeholder="USE_PRIMARY_SNAPSHOT" />
                                                </SelectTrigger>
                                                <SelectContent className="bg-background border-foreground/10">
                                                    <SelectItem value="__primary__" className="text-[10px] font-black uppercase tracking-widest italic">
                                                        PRIMARY GOLD SNAPSHOT
                                                    </SelectItem>
                                                    {snapshots.map((s: any) => (
                                                        <SelectItem key={s.id} value={String(s.id)} className="text-[10px] font-black uppercase tracking-widest italic">
                                                            {s.label || `SNAPSHOT_${s.id}`}
                                                            {s.isPrimary && <Badge className="ml-3 h-4 bg-primary/20 text-primary border-primary/20 text-[8px] italic">GOLD</Badge>}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    {/* Threshold slider */}
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">
                                                Significance Threshold
                                            </Label>
                                            <span className="text-[11px] font-black font-mono text-primary italic bg-primary/5 px-2 py-0.5 rounded border border-primary/10">
                                                {cfg.threshold != null ? `${Math.round(cfg.threshold * 100)}%_DRIFT` : "BINARY_CHANGE"}
                                            </span>
                                        </div>
                                        <Slider
                                            min={0}
                                            max={100}
                                            step={5}
                                            value={[cfg.threshold != null ? Math.round(cfg.threshold * 100) : 0]}
                                            onValueChange={([v]) => setCfg(prev => ({ ...prev, threshold: v === 0 ? undefined : v / 100 }))}
                                            className="w-full"
                                        />
                                        <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest italic">
                                            {cfg.threshold
                                                ? `EMIT SIGNAL ONLY WHEN MUTATION EXCEEDS ${Math.round(cfg.threshold * 100)}% OF STATE FRAGMENTS.`
                                                : "EMIT SIGNAL ON ANY DETECTED BITWISE STATE DISCREPANCY."}
                                        </p>
                                    </div>

                                    {/* Exclusions */}
                                    <div className="space-y-4">
                                        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 italic ml-1">
                                            Field Exclusions
                                        </Label>
                                        <IgnorePathsInput
                                            value={cfg.ignorePaths ?? []}
                                            onChange={v => setCfg(prev => ({ ...prev, ignorePaths: v }))}
                                        />
                                        {(cfg.ignorePaths ?? []).length === 0 && (
                                            <div className="flex flex-wrap gap-2 pt-2">
                                                {["UPDATED_AT", "CREATED_AT", "METADATA.HASH", "EXECUTION_TIME"].map(p => (
                                                    <button
                                                        key={p}
                                                        type="button"
                                                        className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border border-foreground/5 bg-foreground/[0.02] text-foreground/20 hover:border-primary/40 hover:text-primary transition-all italic"
                                                        onClick={() => setCfg(prev => ({
                                                            ...prev,
                                                            ignorePaths: [...(prev.ignorePaths ?? []), p.toLowerCase()],
                                                        }))}
                                                    >
                                                        + {p}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {!cfg.enabled && (
                                <div className="py-12 text-center space-y-4 border-2 border-dashed border-foreground/5 rounded-[2.5rem] bg-foreground/[0.01]">
                                    <div className="w-16 h-16 rounded-full bg-foreground/[0.02] flex items-center justify-center mx-auto border border-foreground/5 shadow-inner">
                                        <GitCompare className="w-8 h-8 text-foreground/10" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-foreground/20 italic">Governance Dormant</p>
                                        <p className="text-[9px] font-bold text-foreground/10 uppercase tracking-widest max-w-[240px] mx-auto italic">
                                            Activate drift detection to track meaningful state evolution and trigger downstream automation.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* ── Baseline Registry ── */}
                    <Card className="glass-panel-deep border-foreground/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
                        <CardHeader className="border-b border-foreground/5 bg-foreground/[0.01] py-6 px-8 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-amber-400 italic">
                                    <Camera className="w-4 h-4" /> Baseline Registry
                                </CardTitle>
                                <CardDescription className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mt-1 italic">
                                    Pinned reference states for cross-cycle consistency.
                                </CardDescription>
                            </div>
                            <Badge className="bg-amber-400/10 text-amber-400 border-amber-400/20 text-[10px] font-black italic h-6 px-3">{snapshots.length}</Badge>
                        </CardHeader>
                        <CardContent className="p-8 space-y-6">
                            {/* Quick Capture */}
                            <div className="p-6 rounded-[2rem] border border-dashed border-foreground/5 bg-foreground/[0.02] space-y-4">
                                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/30 italic ml-1">CAPTURE LATEST OUTPUT</span>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <Input
                                        placeholder="DESIGNATION (E.G., Q1_GOLD)"
                                        value={snapshotLabel}
                                        className="h-10 text-[10px] font-black uppercase tracking-widest bg-foreground/[0.03] border-foreground/10 italic"
                                        onChange={e => setSnapshotLabel(e.target.value)}
                                    />
                                    <Button
                                        variant="outline"
                                        className="h-10 text-[9px] font-black uppercase tracking-[0.2em] gap-3 italic rounded-xl border-amber-400/20 text-amber-400 hover:bg-amber-400/10"
                                        onClick={() => captureMutation.mutate()}
                                        disabled={captureMutation.isPending || successfulRuns.length === 0}
                                    >
                                        <Camera className="w-4 h-4" />
                                        {captureMutation.isPending ? "CAPTURING..." : "REGISTER_BASELINE"}
                                    </Button>
                                </div>
                            </div>

                            {/* Snapshot list */}
                            {snapsLoading ? (
                                <div className="py-12 text-center text-[10px] font-black text-foreground/20 uppercase tracking-[0.5em] animate-pulse">REGISTRY SCAN IN PROGRESS...</div>
                            ) : snapshots.length === 0 ? (
                                <div className="py-12 text-center space-y-4 opacity-20 italic">
                                    <Camera className="w-12 h-12 mx-auto text-foreground/30" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">ZERO SNAPSHOTS RECORDED</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {snapshots.map((snap: any) => (
                                        <div
                                            key={snap.id}
                                            className={cn(
                                                "group flex items-center gap-4 p-4 rounded-2xl border transition-all duration-500",
                                                cfg.baselineSnapshotId === snap.id || (snap.isPrimary && !cfg.baselineSnapshotId)
                                                    ? "border-amber-400/30 bg-amber-400/5 shadow-[0_0_20px_rgba(251,191,36,0.05)]"
                                                    : "border-foreground/5 bg-foreground/[0.01] hover:bg-foreground/[0.03]"
                                            )}
                                        >
                                            <div className="flex-1 min-w-0 space-y-1.5">
                                                <div className="flex items-center gap-3">
                                                    <span className={cn(
                                                        "text-[11px] font-black uppercase tracking-widest truncate italic",
                                                        (cfg.baselineSnapshotId === snap.id || snap.isPrimary) ? "text-amber-400" : "text-foreground/60"
                                                    )}>
                                                        {snap.label || `STATE_FRAGMENT_${snap.id}`}
                                                    </span>
                                                    {snap.isPrimary && (
                                                        <Badge className="text-[8px] font-black italic h-4 px-1.5 bg-amber-400 text-background border-none">
                                                            GOLD
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-4 text-[9px] font-bold text-foreground/20 uppercase tracking-widest italic">
                                                    <span className="flex items-center gap-1.5">
                                                        <Clock className="w-3 h-3" />
                                                        {formatDistanceToNow(new Date(snap.createdAt), { addSuffix: true })}
                                                    </span>
                                                    <span className="flex items-center gap-1.5 font-mono">
                                                        <Hash className="w-3 h-3" />
                                                        {snap.hash?.slice(0, 12)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {!snap.isPrimary && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-9 w-9 text-foreground/20 hover:text-amber-400 hover:bg-amber-400/10 rounded-xl"
                                                        onClick={() => setPrimaryMutation.mutate(snap.id)}
                                                        disabled={setPrimaryMutation.isPending}
                                                    >
                                                        <Star className="w-4 h-4" />
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-9 w-9 text-foreground/20 hover:text-red-400 hover:bg-red-400/10 rounded-xl"
                                                    onClick={() => deleteMutation.mutate(snap.id)}
                                                    disabled={deleteMutation.isPending}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* ── Right: Live Delta Analysis ── */}
                <div className="space-y-6">
                    <Card className="glass-panel-deep border-foreground/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
                        <CardHeader className="border-b border-foreground/5 bg-foreground/[0.01] py-6 px-8 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-purple-400 italic">
                                    <ArrowRightLeft className="w-4 h-4" /> Delta Introspection
                                </CardTitle>
                                <CardDescription className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest mt-1 italic">
                                    Real-time comparison between recent execution cycles.
                                </CardDescription>
                            </div>
                            <Button
                                variant="outline"
                                className="h-10 px-6 text-[9px] font-black uppercase tracking-[0.2em] gap-3 italic rounded-xl border-purple-400/20 text-purple-400 hover:bg-purple-400/10 transition-all shadow-[0_0_15px_rgba(168,85,247,0.1)]"
                                onClick={loadLivePreview}
                                disabled={previewLoading || successfulRuns.length < 2}
                            >
                                <GitCompare className="w-4 h-4" />
                                {previewLoading ? "ANALYZING..." : "COMPUTE_DELTA"}
                            </Button>
                        </CardHeader>
                        <CardContent className="p-8">
                            {successfulRuns.length < 2 ? (
                                <div className="py-16 text-center space-y-5 opacity-20 italic bg-foreground/[0.01] rounded-[2rem] border border-dashed border-foreground/5">
                                    <AlertTriangle className="w-12 h-12 mx-auto text-foreground/30" />
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest">Insufficient Telemetry</p>
                                        <p className="text-[8px] font-bold uppercase tracking-widest">
                                            {successfulRuns.length === 0 ? "ZERO_CYCLES_RECORDED" : "SINGLE_CYCLE_ISOLATED"}
                                        </p>
                                    </div>
                                </div>
                            ) : !livePreview ? (
                                <div className="py-16 text-center space-y-5 italic bg-foreground/[0.01] rounded-[2rem] border border-dashed border-foreground/5 group hover:bg-foreground/[0.03] transition-colors cursor-pointer" onClick={loadLivePreview}>
                                    <ArrowRightLeft className="w-12 h-12 mx-auto text-foreground/10 group-hover:text-primary/40 group-hover:scale-110 transition-all duration-500" />
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-foreground/20">Awaiting Command</p>
                                        <p className="text-[8px] font-bold uppercase tracking-widest text-foreground/10">
                                            {successfulRuns.length} VALID CYCLES DETECTED IN STREAM
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="animate-in zoom-in-95 duration-500">
                                    <DiffResultPanel diff={livePreview} title="DELTA_LAST_N_CYCLES" />
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Operational Schematic */}
                    <Card className="glass-panel-deep border-foreground/5 rounded-[2.5rem] overflow-hidden shadow-2xl bg-primary/5">
                        <CardHeader className="border-b border-foreground/5 py-6 px-8">
                            <CardTitle className="text-[11px] font-black uppercase tracking-[0.4em] text-primary italic">OPERATIONAL SCHEMATIC</CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 space-y-6">
                            <div className="space-y-6">
                                {[
                                    {
                                        step: "01",
                                        title: "CYCLE_TERMINATION",
                                        desc: "Success triggers bitwise comparison against active baseline using RFC 6902 semantics.",
                                        color: "text-blue-400 bg-blue-400/10 border-blue-400/20",
                                    },
                                    {
                                        step: "02",
                                        title: "DELTA_SYNTHESIS",
                                        desc: "Mutation paths identified. Exclusions filtered. Semantic weight calculated.",
                                        color: "text-violet-400 bg-violet-400/10 border-violet-400/20",
                                    },
                                    {
                                        step: "03",
                                        title: "SIGNAL_EMISSION",
                                        desc: "If drift > threshold, a 'job.changed' CloudEvent is broadcast to all subscribers.",
                                        color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
                                    },
                                ].map(s => (
                                    <div key={s.step} className="flex gap-5 group">
                                        <span className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-xl border text-[10px] font-black italic transition-transform group-hover:scale-110 ${s.color}`}>
                                            {s.step}
                                        </span>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/80 italic">{s.title}</p>
                                            <p className="text-[10px] font-bold text-foreground/30 leading-relaxed italic uppercase tracking-wider">{s.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-6 border-t border-foreground/5 space-y-3">
                                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-foreground/20 italic ml-1">
                                    EVENT SCHEMA V1
                                </p>
                                <pre className="text-[9px] font-mono bg-background/60 border border-foreground/5 p-5 rounded-2xl overflow-x-auto text-primary/70 leading-relaxed shadow-inner">
{`{
  "type": "job.changed",
  "source": "job:${jobId}",
  "data": {
    "entityId": ${jobId},
    "diff": {
      "hasChanges": true,
      "changeCount": Σ,
      "summary": { "A": +, "R": -, "M": ~ }
    }
  }
}`}
                                </pre>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
