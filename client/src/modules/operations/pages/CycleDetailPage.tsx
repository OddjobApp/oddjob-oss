import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
    LayoutDashboard, Play, Pause, Settings, History,
    ShieldAlert, ArrowLeft, CheckCircle2, Clock, Zap, Database,
    Network, AlertTriangle, Target, ShieldCheck, XCircle, DollarSign,
    RefreshCcw, Loader2, GitBranch, Milestone, Package, ScrollText,
    ChevronDown, ChevronRight, Ban, FileDiff, TriangleAlert, Activity,
    Settings2, Inbox
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { SentinelMonitor } from "../components/SentinelMonitor";
import { GovernancePanel } from "../components/GovernancePanel";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { DependencyGraph } from "../components/DependencyGraph";
import { KnowledgeGraphVisualizer } from "../../agents/components";
import { BlueprintBuilder } from "../components/BlueprintBuilder";
import { CycleEditPanel } from "../components/CycleEditPanel";
import { CycleGanttChart, type ActualRun } from "../components/CycleGanttChart";
import { StrategicSentinelCommand } from "../components/StrategicSentinelCommand";
import { HypothesisExplorer } from "../components/HypothesisExplorer";
import type { Blueprint } from "../data/cycle-templates";
import type { Blueprint as ManagedBlueprint } from "../components/CycleManagementInterface/types";
// Cycle Management Interface imports
import {
    CycleHeader,
    AppNavigationPanel,
    AppDetailPanel,
    DependencyContextPanel,
    useCycleData,
    useRealTimeUpdates,
    useCycleActions,
    useAppActions,
    useCycleStore
} from "../components/CycleManagementInterface";
import { AppsDropdown, type MissionAppBinding } from "../components/CycleManagementInterface/AppsDropdown";
import { WorkbenchModal } from "../components/CycleManagementInterface/WorkbenchModal";
import { normalizeCycleInputRequirements } from "@shared/cycle-inputs";
import { normalizeCycleSchedule } from "@shared/cycle-scheduling";
import { ExecutionExplorer, type ExecutionGroup } from "@/components/execution/ExecutionExplorer";
import { apiRequest } from "@/lib/queryClient";

import {
    type CycleDetail,
    type CycleRun,
    type BlueprintHistoryEntry,
} from "../components/cycle-detail/cycle-detail-types";
import {
    platformIcons,
    parseTriggerDescription,
    STATUS_CONFIG,
    ATTENTION_STATUSES,
    COMPLETE_STATUSES,
    getAppStatus,
    getAppProgress,
    getNextAction,
    getCriticalPathApps,
    getGateItems,
    getEvidenceItems,
    RUN_STATUS_CONFIG,
    safeDate,
    safeTime,
} from "../components/cycle-detail/cycle-detail-helpers";
import { CycleCommandBrief } from "../components/cycle-detail/CycleCommandBrief";
import { CriticalPathLane } from "../components/cycle-detail/CriticalPathLane";
import { SelectedMissionIntelligence } from "../components/cycle-detail/SelectedMissionIntelligence";
import { CycleHistoryEntry as HistoryEntry } from "../components/cycle-detail/CycleHistoryEntry";
import { ExecutionFlowToggle } from "../components/cycle-detail/ExecutionFlowToggle";

// ── Main Component ────────────────────────────────────────────────────────────

export default function CycleDetailPage() {
    // useParams (not a hardcoded useRoute pattern) so this page works under every
    // route it is mounted at — both the flat /operations/cycles/:id and the
    // project-namespaced /projects/:key/cycles/:id.
    const params = useParams();
    const cycleId = params?.id ? parseInt(params.id) : undefined;
    const { toast } = useToast();

    const [cycle, setCycle] = useState<CycleDetail | null>(null);
    const [runs, setRuns] = useState<CycleRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [mutating, setMutating] = useState<string | null>(null);
    const [managementHydrationEnabled, setManagementHydrationEnabled] = useState(false);

    // Fetch templates to resolve template name for configured follow-up cycles
    const { data: templates } = useQuery<{ id: number; name: string }[]>({
        queryKey: ["/api/cycle-collaboration/templates"],
        queryFn: async () => {
            const res = await fetch("/api/cycle-collaboration/templates", { credentials: "include" });
            if (!res.ok) throw new Error("Failed to load templates");
            return res.json();
        },
    });
    
    // Cycle Management Interface state
    const { activeAppIndex, setActiveAppIndex } = useCycleStore();
    const [openSections, setOpenSections] = useState<string[]>(["mission-workbench", "cycle-manager", "gantt"]);

    // Mission Workbench (mission-first SDLC apps) state
    const [workbenchModal, setWorkbenchModal] = useState<{
        open: boolean;
        binding: MissionAppBinding | null;
        missionId: number;
        missionName: string;
    }>({ open: false, binding: null, missionId: 0, missionName: '' });
    const [missionBindings, setMissionBindings] = useState<Array<{
        missionId: number;
        missionName: string;
        bindings: MissionAppBinding[];
    }>>([]);
    const [bindingsLoading, setBindingsLoading] = useState(false);

    // Fetch mission bindings when the cycle id is known
    useEffect(() => {
        if (!cycleId) return;
        let cancelled = false;
        setBindingsLoading(true);
        apiRequest("GET", `/api/cycles/${cycleId}/mission-bindings`, undefined, 15_000)
            .then(r => r.ok ? r.json() : { items: [] })
            .then(data => { if (!cancelled) setMissionBindings(data.items ?? []); })
            .catch(() => { if (!cancelled) setMissionBindings([]); })
            .finally(() => { if (!cancelled) setBindingsLoading(false); });
        return () => { cancelled = true; };
    }, [cycleId]);

    const handleOpenWorkbench = useCallback((missionId: number, missionName: string, binding: MissionAppBinding) => {
        setWorkbenchModal({ open: true, binding, missionId, missionName });
    }, []);
    
    // Auto-detect if cycle has UI metadata and expand cycle management interface
    // Only expand if cycle is active/running (apps become relevant after cycle starts)
    useEffect(() => {
        const metadata = cycle?.metadata as any;
        const hasUIMetadata = metadata?.uiMetadata || metadata?.blueprints?.some((bp: any) => bp.uiMetadata);
        const isActive = cycle?.status === 'active' || cycle?.status === 'running';
        
        if (hasUIMetadata && isActive) {
            setOpenSections(prev => prev.includes("cycle-manager") ? prev : [...prev, "cycle-manager"]);
        }
    }, [cycle]);
    
    // Cycle Management Interface hooks
    useEffect(() => {
        if (!cycle) {
            setManagementHydrationEnabled(false);
            return;
        }
        const id = window.setTimeout(() => setManagementHydrationEnabled(true), 250);
        return () => window.clearTimeout(id);
    }, [cycle?.id]);

    const { cycle: cmCycle, apps, isLoading: cmLoading, isHydrated: cmHydrated, error: cmError, refetch: refetchCycleManagement } = useCycleData(cycleId || 0, {
        enabled: managementHydrationEnabled,
        initialCycle: cycle as any,
    });
    // Two EventSource streams can occupy enough HTTP/1.1 connections to starve
    // the app hydration request (especially under React StrictMode's double
    // effects). Open live updates only after the finite /apps request completes.
    const { connected } = useRealTimeUpdates(cmHydrated ? (cycleId || 0) : 0);
    const { pauseCycle, resumeCycle, abortCycle, isMutating: cmMutating } = useCycleActions(cycleId || 0);
    const { pauseApp, resumeApp, skipApp, retryApp, completeApp } = useAppActions(cycleId || 0, apps[activeAppIndex]?.name || '');

    useEffect(() => {
        if (apps.length > 0 && activeAppIndex >= apps.length) {
            setActiveAppIndex(0);
        }
    }, [activeAppIndex, apps.length, setActiveAppIndex]);

    // Edit panel
    const [showEditPanel, setShowEditPanel] = useState(false);
    const [panelSaving, setPanelSaving] = useState(false);

    // Dialogs
    const [showConfigure, setShowConfigure] = useState(false);
    const [showAbortConfirm, setShowAbortConfirm] = useState(false);
    const [showMilestoneApprove, setShowMilestoneApprove] = useState(false);
    const [showBlueprintEditor, setShowBlueprintEditor] = useState(false);
    const [showBlueprintLiveWarning, setShowBlueprintLiveWarning] = useState(false);
    const [showBlueprintHistory, setShowBlueprintHistory] = useState(false);

    // Edit state
    const [editName, setEditName] = useState("");
    const [editObjective, setEditObjective] = useState("");
    const [editBudget, setEditBudget] = useState("");
    const [editPriority, setEditPriority] = useState("5");
    const [editBlueprints, setEditBlueprints] = useState<Blueprint[]>([]);
    const [blueprintChangeReason, setBlueprintChangeReason] = useState("");
    const [milestoneResourceAnswers, setMilestoneResourceAnswers] = useState<Record<string, Record<string, string>>>({});
    const [blueprintValidation, setBlueprintValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);

    const fetchData = useCallback(async () => {
        if (!cycleId) return;
        try {
            setLoadError(null);
            const res = await apiRequest("GET", `/api/cycles/${cycleId}`);
            const data = await res.json();
            const c: CycleDetail = data.cycle ?? data;
            setCycle(c);
            setRuns(data.runs ?? []);
            setEditName(c.name ?? "");
            setEditObjective(c.objective ?? "");
            setEditBudget(String(c.budgetLimitUsd ?? "100"));
            setEditPriority(String(c.priority ?? 5));
            setEditBlueprints(c.metadata?.blueprints ?? []);
        } catch (e: any) {
            setLoadError(e?.name === "AbortError" ? "Request timed out while loading this cycle." : (e?.message ?? "Failed to load cycle"));
            toast({ title: "Failed to load cycle", description: e?.message ?? "Request failed", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [cycleId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Poll while active/paused
    useEffect(() => {
        if (!cycle || !["active", "running", "paused"].includes(cycle.status)) return;
        const timer = setInterval(fetchData, 15000);
        return () => clearInterval(timer);
    }, [cycle?.status, fetchData]);

    const apiAction = async (method: string, path: string, body?: object) => {
        const res = await apiRequest(method, `/api/cycles/${cycleId}${path}`, body);
        return res.json();
    };

    /**
     * Approve and Trigger are both gated on cycle integrations, and the 422 body
     * names exactly which ones are unresolved. Reporting only "Cycle integrations
     * are not ready" threw that away and left no way to tell whether one secret or
     * all four were missing, or which. Pull the list back out for the toast.
     */
    const describeActionError = (e: any): string => {
        const details = e?.details?.details ?? e?.details;
        const missing = details?.missingIntegrations;
        if (!Array.isArray(missing) || missing.length === 0) return e?.message ?? "Request failed";

        const names = missing
            .map((m: any) => (m?.envVarName ? `${m.integrationName} (${m.envVarName})` : m?.integrationName))
            .filter(Boolean)
            .join(", ");
        return names ? `${e.message}. Missing: ${names}` : e.message;
    };

    const doAction = async (label: string, fn: () => Promise<void>) => {
        setMutating(label);
        try {
            await fn();
            await fetchData();
        } catch (e: any) {
            toast({ title: `${label} failed`, description: describeActionError(e), variant: "destructive" });
        } finally {
            setMutating(null);
        }
    };

    const handleApprove = () => doAction("Approve", async () => {
        await apiAction("POST", "/approve", { force: true });
        toast({ title: "Cycle Approved", description: "The autonomous program has been released." });
    });

    const handlePauseResume = () => doAction(cycle?.status === "active" ? "Pause" : "Resume", async () => {
        await apiAction("POST", cycle!.status === "active" ? "/pause" : "/resume");
        toast({ title: cycle!.status === "active" ? "Cycle Paused" : "Cycle Resumed" });
    });

    const handleTrigger = () => doAction("Trigger Run", async () => {
        await apiAction("POST", "/trigger", { force: true });
        toast({ title: "Cycle Triggered", description: "Manual run has been initiated successfully." });
    });

    const handleAbort = () => doAction("Abort", async () => {
        await apiAction("POST", "/abort");
        setShowAbortConfirm(false);
        toast({ title: "Cycle Aborted", description: "All active missions terminated." });
    });

    const handleSaveConfig = () => doAction("Save", async () => {
        await apiAction("PATCH", "", { name: editName, objective: editObjective, budgetLimitUsd: editBudget, priority: parseInt(editPriority) });
        setShowConfigure(false);
        toast({ title: "Configuration saved" });
    });

    const isLiveCycle = cycle ? ["active", "running", "paused"].includes(cycle.status) : false;

    const openBlueprintEditor = () => {
        setEditBlueprints(cycle?.metadata?.blueprints ?? []);
        setBlueprintChangeReason("");
        if (isLiveCycle) {
            setShowBlueprintLiveWarning(true);
        } else {
            setShowBlueprintEditor(true);
        }
    };

    const confirmBlueprintEdit = () => {
        setShowBlueprintLiveWarning(false);
        setShowBlueprintEditor(true);
    };

    const handleSaveBlueprints = () => doAction("Save blueprints", async () => {
        await apiAction("PATCH", "/blueprints", {
            blueprints: editBlueprints,
            ...(blueprintChangeReason.trim() ? { reason: blueprintChangeReason.trim() } : {}),
        });
        setShowBlueprintEditor(false);
        setBlueprintChangeReason("");
        const history = cycle?.metadata?.blueprint_history ?? [];
        toast({
            title: "Blueprint saved",
            description: isLiveCycle
                ? `Change recorded. ${history.length + 1} plan revision(s) stored.`
                : "Blueprint updated.",
        });
    });

    const handleMilestoneApprove = () => doAction("Approve milestone", async () => {
        const hasAnswers = Object.keys(milestoneResourceAnswers).length > 0;
        await apiAction("POST", "/milestone/approve", {
            ...(hasAnswers ? { resourceAnswers: milestoneResourceAnswers } : {}),
        });
        setShowMilestoneApprove(false);
        setMilestoneResourceAnswers({});
        toast({ title: "Milestone Approved", description: "Cycle resumed." });
    });

    // Unified save from the edit panel
    const handlePanelSave = async (patch: Parameters<React.ComponentProps<typeof CycleEditPanel>["onSave"]>[0]) => {
        setPanelSaving(true);
        try {
            const { blueprints: newBlueprints, resourceAnswers, blueprintChangeReason: reason, metadata, ...general } = patch;

            // 1. Update scalar fields via general PATCH
            const hasGeneralChange = Object.values(general).some(v => v !== undefined);
            if (hasGeneralChange) {
                await apiAction("PATCH", "", {
                    ...general,
                    metadata: metadata || resourceAnswers
                        ? { ...(metadata ?? {}), ...(resourceAnswers ? { resource_answers: resourceAnswers } : {}) }
                        : undefined,
                });
            } else if (resourceAnswers) {
                await apiAction("PATCH", "", {
                    metadata: { ...(cycle?.metadata ?? {}), resource_answers: resourceAnswers },
                });
            }

            // 2. Update blueprints via dedicated endpoint (records history if live)
            if (newBlueprints) {
                await apiAction("PATCH", "/blueprints", {
                    blueprints: newBlueprints,
                    ...(reason ? { reason } : {}),
                });
            }

            await fetchData();
            setShowEditPanel(false);
            toast({ title: "Cycle updated" });
        } catch (e: any) {
            toast({ title: "Save failed", description: e.message, variant: "destructive" });
        } finally {
            setPanelSaving(false);
        }
    };

    const handleExportLog = () => {
        let logContent = cycle?.outcomeMetrics?.auditLog;

        if (!logContent) {
            // Fallback: Combine dynamic traces from all runs in this cycle
            const allTraces = runs
                .filter(r => r.dynamicTrace && Array.isArray(r.dynamicTrace))
                .flatMap(r => (r.dynamicTrace as any[]).map(t => ({ ...t, runId: r.id })))
                .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            if (allTraces.length > 0) {
                logContent = `STRATEGIC OPERATIONAL LOG: ${cycle?.name}\n`;
                logContent += `OBJECTIVE: ${cycle?.objective}\n`;
                logContent += `GENERATED: ${new Date().toISOString()}\n`;
                logContent += `================================================================================\n\n`;
                
                allTraces.forEach(t => {
                    const ts = new Date(t.timestamp).toLocaleTimeString();
                    logContent += `[${ts}] [Run #${t.runId}] [${t.type?.toUpperCase()}] ${t.event || t.note || ''}\n`;
                    if (t.tool) logContent += `      TOOL: ${t.tool}\n`;
                    if (t.score) logContent += `      SCORE: ${t.score}\n`;
                    if (t.error) logContent += `      ERROR: ${t.error}\n`;
                    logContent += `\n`;
                });
            }
        }

        if (!logContent) {
            toast({ title: "No log available", description: "The strategic audit log is empty and no mission traces found.", variant: "default" });
            return;
        }

        const blob = new Blob([logContent], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cycle-${cycle?.id}-strategic-log.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ title: "Log Exported", description: "Strategic log downloaded successfully." });
    };

    // Blueprints that have resource requirements not yet answered (or needing refresh)
    // Find the first blueprint with a trigger config
    const initialTrigger = useMemo(() => {
        const blueprints = cycle?.metadata?.blueprints;
        if (Array.isArray(blueprints)) {
            const firstWithTrigger = blueprints.find(bp => bp.trigger);
            if (firstWithTrigger) {
                return {
                    appName: firstWithTrigger.name,
                    trigger: firstWithTrigger.trigger,
                };
            }
        }
        if (Array.isArray(apps)) {
            const firstWithTrigger = apps.find(app => app.trigger);
            if (firstWithTrigger) {
                return {
                    appName: firstWithTrigger.name,
                    trigger: firstWithTrigger.trigger,
                };
            }
        }
        return null;
    }, [cycle?.metadata?.blueprints, apps]);

    const pendingResourceBlueprints = (cycle?.metadata?.blueprints ?? []).filter(
        bp => normalizeCycleInputRequirements(bp).length > 0
    );

    // ── Derived metrics ───────────────────────────────────────────────────────

    const totalRunCost = runs.reduce((s, r) => s + (r.metadata?.total_cost ?? 0), 0);
    const totalRunTokens = runs.reduce((s, r) => s + (r.metadata?.totalTokens ?? 0), 0);
    const budgetNum = parseFloat(String(cycle?.budgetLimitUsd ?? 0)) || 0;
    const tokenLimitNum = cycle?.tokenLimit ?? 0;
    const budgetPct = budgetNum > 0 ? Math.min((totalRunCost / budgetNum) * 100, 100) : 0;
    const tokenPct = tokenLimitNum > 0 ? Math.min(((cycle?.outcomeMetrics?.totalTokens ?? totalRunTokens) / tokenLimitNum) * 100, 100) : 0;
    const budgetWarning = budgetPct >= 80;
    const tokenWarning = tokenPct >= 80;
    const completedRuns = runs.filter(r => r.status === "completed").length;
    const failedRuns = runs.filter(r => r.status === "failed").length;
    const activeRuns = runs.filter(r => ["active", "running"].includes(r.status)).length;
    // Derive client-side while cycle is live; use server value only after closure (avoids denominator mismatch)
    const isClosed = ["closed", "cancelled", "failed"].includes(cycle?.status ?? "");
    const successRate = isClosed && cycle?.outcomeMetrics?.successRate != null
        ? cycle.outcomeMetrics.successRate
        : (runs.length > 0 ? Math.round((completedRuns / runs.length) * 100) : 0);

    const cycleExecutionGroups: ExecutionGroup[] = [
        ...apps.map((app, index) => {
            const status = getAppStatus(app);
            const startedAt = (app as any).startedAt || (app as any).createdAt || cycle?.startDate || cycle?.createdAt;
            const completedAt = (app as any).completedAt || (app as any).finishedAt || undefined;
            return {
                id: `cycle-app-${app.name || index}`,
                title: app.name || `Mission app ${index + 1}`,
                subtitle: app.objective || (app as any).description || getNextAction(app),
                category: (app as any).type || "cycle app",
                status: status === "active" ? "running" : status === "blocked" ? "waiting" : status as any,
                startedAt,
                completedAt,
                durationMs: startedAt && completedAt ? new Date(completedAt).getTime() - new Date(startedAt).getTime() : undefined,
                progress: getAppProgress(app),
                isCritical: ATTENTION_STATUSES.has(status),
                metadata: {
                    status,
                    currentStep: app.currentStep,
                    totalSteps: app.totalSteps,
                    workbenchApps: app.workbenchApps,
                    trigger: (app as any).trigger,
                    config: app.config,
                },
                events: [
                    {
                        id: `cycle-app-${app.name || index}-state`,
                        timestamp: startedAt,
                        type: "cycle.app.state",
                        title: `${app.name || `Mission app ${index + 1}`} is ${status}`,
                        description: getNextAction(app),
                        status: status as any,
                        metadata: app as any,
                    },
                ],
            } satisfies ExecutionGroup;
        }),
        ...(cycle?.metadata?.blueprints ?? []).map((blueprint: Blueprint, index) => ({
            id: `cycle-blueprint-${index}-${blueprint.name}`,
            title: blueprint.name,
            subtitle: blueprint.objective,
            category: blueprint.type || "blueprint",
            status: (blueprint as any).status || "pending",
            startedAt: cycle?.startDate || cycle?.createdAt,
            completedAt: (blueprint as any).completedAt,
            progress: (blueprint as any).status === "completed" ? 100 : 0,
            metadata: blueprint as any,
            events: [{
                id: `cycle-blueprint-${index}-planned`,
                timestamp: cycle?.createdAt,
                type: "cycle.blueprint.planned",
                title: `${blueprint.name} planned`,
                description: blueprint.objective,
                status: (blueprint as any).status || "pending",
                metadata: blueprint as any,
            }],
        } satisfies ExecutionGroup)),
        ...runs.map((run) => ({
            id: `cycle-run-${run.id}`,
            title: run.name || `Cycle run #${run.id}`,
            subtitle: `Run #${run.id}`,
            category: "cycle run",
            status: run.status as any,
            startedAt: run.createdAt,
            completedAt: run.updatedAt,
            isChild: true,
            progress: run.status === "completed" ? 100 : run.status === "failed" ? 100 : ["active", "running"].includes(run.status) ? 50 : 0,
            metadata: {
                runId: run.id,
                cycleId: run.cycleId,
                cost: run.metadata?.total_cost,
                tokens: run.metadata?.totalTokens,
                dynamicTrace: run.dynamicTrace,
            },
            events: [{
                id: `cycle-run-${run.id}-state`,
                timestamp: run.updatedAt || run.createdAt,
                type: `cycle.run.${run.status}`,
                title: `${run.name || `Run #${run.id}`} ${run.status}`,
                status: run.status as any,
                metadata: run as any,
            }],
        } satisfies ExecutionGroup)),
        ...(cycle?.metadata?.blueprint_history ?? []).slice(0, 10).map((entry, index) => ({
            id: `cycle-blueprint-history-${index}`,
            title: `Blueprint revision ${index + 1}`,
            subtitle: entry.reason || "Plan changed",
            category: "blueprint history",
            status: "completed",
            startedAt: entry.changedAt,
            completedAt: entry.changedAt,
            metadata: entry as unknown as Record<string, unknown>,
            events: [{
                id: `cycle-blueprint-history-${index}-changed`,
                timestamp: entry.changedAt,
                type: "cycle.blueprint.changed",
                title: entry.reason || "Blueprint changed",
                actor: String(entry.changedBy),
                status: "completed",
                metadata: entry as unknown as Record<string, unknown>,
            }],
        } satisfies ExecutionGroup)),
    ].sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());

    if (loading) return (
        <div className="flex items-center justify-center h-full min-h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
    );

    if (loadError) return (
        <div className="p-8 text-center space-y-4">
            <ShieldAlert className="w-12 h-12 mx-auto text-destructive" />
            <div className="space-y-1">
                <h2 className="text-2xl font-bold">Cycle failed to load</h2>
                <p className="text-sm text-muted-foreground">{loadError}</p>
            </div>
            <div className="flex items-center justify-center gap-2">
                <Button variant="outline" onClick={() => { setLoading(true); void fetchData(); }}>
                    <RefreshCcw className="w-4 h-4 mr-2" /> Retry
                </Button>
                <Link href="/operations/cycles">
                    <Button variant="ghost"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard</Button>
                </Link>
            </div>
        </div>
    );

    if (!cycle) return (
        <div className="p-8 text-center space-y-4">
            <ShieldAlert className="w-12 h-12 mx-auto text-destructive" />
            <h2 className="text-2xl font-bold">Cycle Not Found</h2>
            <Link href="/operations/cycles">
                <Button variant="outline"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard</Button>
            </Link>
        </div>
    );

    const statusCfg = STATUS_CONFIG[cycle.status] ?? { label: cycle.status.toUpperCase(), cls: "bg-muted text-muted-foreground" };
    const isTerminated = ["closed", "cancelled", "failed"].includes(cycle.status);
    const isMilestoneGate = cycle.status === "paused";
    const cycleSchedule = normalizeCycleSchedule(cycle.metadata, cycle.recurrence, cycle.timezone);
    const ganttStartDate = cycleSchedule.mode === "on_complete" && (cycle.metadata as any)?.scheduling?.ganttResetAt
        ? new Date((cycle.metadata as any).scheduling.ganttResetAt)
        : (cycle.startDate ? new Date(cycle.startDate) : (cycle.createdAt ? new Date(cycle.createdAt) : undefined));

    return (
        <div className="p-2 space-y-4 w-full max-w-full">
            <AnimatePresence mode="wait">
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="space-y-6"
                >

            {/* ── Milestone Approval Banner ─────────────────────────────────── */}
            {isMilestoneGate && (
                <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10">
                    <div className="flex items-start gap-3">
                        <Milestone className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold text-amber-700 dark:text-amber-300">Strategic Milestone Gate</p>
                            <p className="text-xs text-amber-700 dark:text-amber-200/70 mt-0.5">This cycle is paused at a milestone checkpoint awaiting your approval before the fleet can continue.</p>
                        </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <Button size="sm" className="bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-full"
                            onClick={() => setShowMilestoneApprove(true)}>
                            <ShieldCheck className="w-4 h-4 mr-1.5" /> Approve & Continue
                        </Button>
                        <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-full"
                            onClick={() => setShowAbortConfirm(true)}>
                            <Ban className="w-4 h-4 mr-1.5" /> Abort
                        </Button>
                    </div>
                </div>
            )}

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4">
                {/* Original Header */}
                <div className="flex items-start justify-between bg-background/20 p-5 rounded-2xl border border-foreground/5 flex-1">
                    <div className="flex items-start gap-3 min-w-0">
                        <Link href="/operations/cycles">
                            <Button variant="ghost" size="icon" className="shrink-0 hover:bg-primary/10 rounded-full mt-0.5">
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                        </Link>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-3xl">{cycle.icon ?? "🌀"}</span>
                                <h1 className="text-2xl font-black tracking-tight truncate">{cycle.name}</h1>
                                <Badge variant="outline" className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 ${statusCfg.cls}`}>
                                    {statusCfg.label}
                                </Badge>
                                {mutating && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                            </div>
                            {cycle.description && cycle.description !== cycle.objective && (
                                <p className="text-xs text-muted-foreground/70 mt-0.5 max-w-xl italic">{cycle.description}</p>
                            )}
                            <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed line-clamp-2">
                                {cycle.objective}
                            </p>
                            {initialTrigger && (() => {
                                const info = parseTriggerDescription(initialTrigger.trigger);
                                const IconComp = platformIcons[info.source] || Zap;
                                return (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs bg-foreground/[0.02] border border-foreground/5 rounded-xl px-3 py-2 w-fit">
                                        <span className="text-muted-foreground font-black uppercase tracking-widest text-[9px]">Initial Trigger:</span>
                                        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary flex items-center gap-1.5 px-2 py-0.5 rounded-full font-bold text-[10px] uppercase tracking-wider">
                                            <IconComp className="w-3.5 h-3.5" />
                                            <span>{info.label}</span>
                                        </Badge>
                                        <span className="text-foreground/95 font-semibold">{info.details}</span>
                                    </div>
                                );
                            })()}
                            {/* Metadata strip */}
                            <div className="flex flex-wrap gap-3 mt-2 items-center">
                                {cycleSchedule.enabled && cycleSchedule.mode !== "once" && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> {cycleSchedule.mode.replace("_", " ")} ({cycleSchedule.timezone})
                                        {cycle.nextRunAt ? ` next ${safeDate(cycle.nextRunAt)}` : ""}
                                    </span>
                                )}
                                {cycle.startDate && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                        <Target className="w-3 h-3" /> Started {safeDate(cycle.startDate)}
                                    </span>
                                )}
                                {cycle.endDate && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" /> Due {safeDate(cycle.endDate)}
                                    </span>
                                )}
                                {(() => {
                                    const metadata = (cycle.metadata as any) || {};
                                    return (
                                        <>
                                            {metadata.parent_cycle_id && (
                                                <Link href={`/operations/cycles/${metadata.parent_cycle_id}`}>
                                                    <Badge variant="outline" className="cursor-pointer bg-primary/10 text-primary border-primary/20 text-[10px] hover:bg-primary/20 transition-colors flex items-center gap-1">
                                                        <GitBranch className="w-3 h-3 rotate-180" /> Parent Cycle #{metadata.parent_cycle_id}
                                                    </Badge>
                                                </Link>
                                            )}
                                            {metadata.follow_up_cycle_id && (
                                                <Link href={`/operations/cycles/${metadata.follow_up_cycle_id}`}>
                                                    <Badge variant="outline" className="cursor-pointer bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] hover:bg-emerald-500/20 transition-colors flex items-center gap-1">
                                                        <GitBranch className="w-3 h-3" /> Follow-up Cycle #{metadata.follow_up_cycle_id}
                                                    </Badge>
                                                </Link>
                                            )}
                                            {!metadata.follow_up_cycle_id && metadata.follow_up_cycle_template_id && (
                                                <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] flex items-center gap-1">
                                                    <Clock className="w-3 h-3" /> Follows up with: {templates?.find(t => t.id === Number(metadata.follow_up_cycle_template_id))?.name || `Template #${metadata.follow_up_cycle_template_id}`}
                                                </Badge>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2 shrink-0 ml-4">
                        {!isTerminated && (
                            <>
                                <Link href={`/operations/cycles/${cycle.id}/edit`}>
                                    <Button variant="outline" size="sm" className="rounded-full border-foreground/10 hover:bg-foreground/5">
                                        <Settings className="w-4 h-4 mr-1.5" /> Edit in Builder
                                    </Button>
                                </Link>
                                {cycle.status === "pending_approval" && (
                                    <Button variant="default" size="sm"
                                        className="rounded-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
                                        onClick={handleApprove} disabled={mutating !== null}>
                                        {mutating === "Approve" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1.5" />}
                                        Approve & Launch
                                    </Button>
                                )}
                                {cycle.status === "active" ? (
                                    <>
                                        <Button variant="secondary" size="sm"
                                            className="rounded-full bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20"
                                            onClick={handlePauseResume} disabled={mutating !== null}>
                                            <Pause className="w-4 h-4 mr-1.5" /> Pause
                                        </Button>
                                        <Button variant="default" size="sm"
                                            className="rounded-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
                                            onClick={handleTrigger} disabled={mutating !== null}>
                                            {mutating === "Trigger Run" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Play className="w-4 h-4 mr-1.5 fill-current" />}
                                            Trigger Run
                                        </Button>
                                    </>
                                ) : cycle.status === "paused" ? (
                                    <Button variant="default" size="sm"
                                        className="rounded-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
                                        onClick={handlePauseResume} disabled={mutating !== null}>
                                        <Play className="w-4 h-4 mr-1.5" /> Resume
                                    </Button>
                                ) : null}
                                <Button variant="ghost" size="sm"
                                    className="rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300"
                                    onClick={() => setShowAbortConfirm(true)}>
                                    <Ban className="w-4 h-4 mr-1.5" /> Abort
                                </Button>
                            </>
                        )}
                        <Button variant="ghost" size="icon" className="rounded-full" onClick={fetchData}>
                            <RefreshCcw className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </div>

            {/* ── Dashboard Modules Accordion ────────────────────────────────── */}
            <ExecutionExplorer
                title="Cycle Execution Explorer"
                description="Grouped cycle activity across app work, blueprints, child runs, and plan revisions."
                status={cycle.status}
                groups={cycleExecutionGroups}
                relationships={[
                    ...((cycle.metadata as any)?.parent_cycle_id ? [{
                        id: `parent-cycle-${(cycle.metadata as any).parent_cycle_id}`,
                        label: "Parent cycle",
                        value: `Cycle #${(cycle.metadata as any).parent_cycle_id}`,
                        type: "parent" as const,
                        href: `/operations/cycles/${(cycle.metadata as any).parent_cycle_id}`,
                        status: "completed",
                    }] : []),
                    ...((cycle.metadata as any)?.follow_up_cycle_id ? [{
                        id: `follow-up-cycle-${(cycle.metadata as any).follow_up_cycle_id}`,
                        label: "Follow-up cycle",
                        value: `Cycle #${(cycle.metadata as any).follow_up_cycle_id}`,
                        type: "next" as const,
                        href: `/operations/cycles/${(cycle.metadata as any).follow_up_cycle_id}`,
                        status: "pending",
                    }] : []),
                    ...runs.map(run => ({
                        id: `cycle-run-rel-${run.id}`,
                        label: "Child run",
                        value: run.name || `Run #${run.id}`,
                        type: "child" as const,
                        href: `/operations/cycles/${cycle.id}`,
                        status: run.status,
                    })),
                ]}
                metadata={[
                    { label: "Cycle ID", value: cycle.id },
                    { label: "Priority", value: cycle.priority ?? "None" },
                    { label: "Budget", value: budgetNum ? `$${budgetNum.toLocaleString()}` : "None" },
                    { label: "Budget Used", value: `$${totalRunCost.toFixed(2)}` },
                    { label: "Token Limit", value: tokenLimitNum || "None" },
                    { label: "Tokens Used", value: cycle.outcomeMetrics?.totalTokens ?? totalRunTokens },
                    { label: "Success Rate", value: `${successRate}%` },
                    { label: "Live Channel", value: connected ? "Connected" : "Polling" },
                ]}
                lastUpdatedAt={cycle.updatedAt || cycle.createdAt}
                isLive={!isTerminated}
                defaultView="compact"
                renderGroupDetail={(group) => (
                    <div className="space-y-3 text-xs">
                        {Object.entries(group.metadata || {}).map(([key, value]) => (
                            <div key={key} className="grid grid-cols-[9rem_1fr] gap-3 border-b border-border/50 pb-2 last:border-0">
                                <span className="font-semibold text-muted-foreground">{key}</span>
                                <span className="min-w-0 break-words">
                                    {typeof value === "object" && value !== null
                                        ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">{JSON.stringify(value, null, 2)}</pre>
                                        : String(value ?? "None")}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            />

            <div className="space-y-4">
                {/* Expand / Collapse All Toolbar */}
                <div className="flex justify-between items-center gap-4">
                    <div className="flex gap-2">
                        {cycleId && (
                            <>
                                <Link href={`/operations/workbenches/universal-studio/${cycleId}`}>
                                    <Button variant="outline" size="sm" className="rounded-full border-primary/20 text-primary bg-primary/10 hover:bg-primary/20">
                                        <Database className="w-4 h-4 mr-1.5" /> Universal Studio
                                    </Button>
                                </Link>
                                <Link href={`/operations/workbenches/decision-control/${cycleId}`}>
                                    <Button variant="outline" size="sm" className="rounded-full border-amber-500/20 text-amber-500 bg-amber-500/10 hover:bg-amber-500/20">
                                        <Inbox className="w-4 h-4 mr-1.5" /> Decision Control
                                    </Button>
                                </Link>
                            </>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-[10px] uppercase font-black tracking-widest rounded-full border-foreground/10 hover:bg-foreground/5 h-8"
                            onClick={() => setOpenSections(["objective", "governance", "gantt", "architecture", "logs", "hypothesis"])}
                        >
                            Expand All Modules
                        </Button>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-[10px] uppercase font-black tracking-widest rounded-full border-foreground/10 hover:bg-foreground/5 h-8"
                            onClick={() => setOpenSections([])}
                        >
                            Collapse All
                        </Button>
                    </div>
                </div>

                <Accordion 
                    type="multiple" 
                    value={openSections} 
                    onValueChange={setOpenSections} 
                    className="space-y-6"
                >
                    {/* ── SECTION 7: Cycle App Manager ───────────────────────────── */}
                    <AccordionItem
                        value="cycle-manager"
                        className="bg-background/30 border border-foreground/10 rounded-2xl overflow-hidden px-4 transition-all data-[state=open]:border-primary/30"
                    >
                        <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between text-foreground">
                            <div className="flex flex-wrap items-center gap-3 text-left">
                                <Package className="w-5 h-5 text-primary" />
                                <div>
                                    <span className="text-sm font-black uppercase tracking-widest">Cycle App Manager</span>
                                    <span className="hidden md:inline-block text-[10px] text-muted-foreground ml-3 uppercase tracking-wider font-bold">
                                        Agent Workbench • App Steps & Config
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mr-4">
                                <Badge variant="outline" className={`text-[9px] font-black uppercase ${
                                    connected ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-amber-500/15 text-amber-400 border-amber-500/20"
                                }`}>
                                    {connected ? "Live Update Channel" : "Polling Mode"}
                                </Badge>
                                <Badge variant="outline" className="text-[9px] font-black border-foreground/10 text-muted-foreground bg-foreground/5">
                                    {apps.length} APP{apps.length === 1 ? "" : "S"} MAPPED
                                </Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-2">
                            {cmLoading ? (
                                <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground bg-background/20 rounded-xl border border-foreground/5">
                                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                    Loading cycle manager
                                </div>
                            ) : cmError ? (
                                <Card className="bg-red-500/10 border-red-500/20 shadow-xl">
                                    <CardContent className="flex items-start gap-3 py-6 text-sm text-red-700 dark:text-red-200">
                                        <AlertTriangle className="w-5 h-5 shrink-0 text-red-700 dark:text-red-300" />
                                        <div>
                                            <p className="font-bold">Cycle manager could not load.</p>
                                            <p className="text-xs text-red-700 dark:text-red-200/70 mt-1">{cmError}</p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="mt-4 rounded-full border-red-400/30 text-red-100 hover:bg-red-500/10"
                                                onClick={refetchCycleManagement}
                                            >
                                                <RefreshCcw className="w-3.5 h-3.5 mr-2" /> Retry
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ) : cmCycle ? (
                                <div className="space-y-6">
                                    <CycleHeader
                                        cycle={cmCycle}
                                        onPause={async () => { await pauseCycle(); await Promise.all([fetchData(), refetchCycleManagement()]); }}
                                        onResume={async () => { await resumeCycle(); await Promise.all([fetchData(), refetchCycleManagement()]); }}
                                        onAbort={async () => { await abortCycle(); await Promise.all([fetchData(), refetchCycleManagement()]); }}
                                        onRefresh={async () => { await Promise.all([fetchData(), refetchCycleManagement()]); }}
                                        isMutating={cmMutating}
                                    />

                                    {apps.length === 0 ? (
                                        <div className="py-12 text-center bg-background/20 rounded-xl border border-foreground/5">
                                            <Package className="w-8 h-8 mx-auto text-muted-foreground/50" />
                                            <p className="mt-3 text-sm font-bold">No app blueprints mapped yet</p>
                                            <p className="mt-1 text-xs text-muted-foreground">This cycle can still run as missions, but the app manager has no blueprint rows to inspect.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-5">
                                            <CycleCommandBrief
                                                cycle={cycle}
                                                apps={apps}
                                                activeApp={apps[activeAppIndex]}
                                                activeAppIndex={activeAppIndex}
                                                connected={connected}
                                                onOpenWorkbench={() => {
                                                    setOpenSections(prev => prev.includes("cycle-manager") ? prev : [...prev, "cycle-manager"]);
                                                    setTimeout(() => document.getElementById("cycle-app-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                                                }}
                                            />

                                            <CriticalPathLane
                                                apps={apps}
                                                activeIndex={activeAppIndex}
                                                onSelect={setActiveAppIndex}
                                            />

                                            <SelectedMissionIntelligence app={apps[activeAppIndex]} />

                                            <div className="flex flex-col-reverse lg:flex-row gap-6 items-start justify-start w-full">
                                                <div className="w-full lg:flex-1 self-start">
                                                    <AppNavigationPanel
                                                        apps={apps}
                                                        activeIndex={activeAppIndex}
                                                        onAppSelect={setActiveAppIndex}
                                                    />
                                                </div>

                                                <div id="cycle-app-detail" className="w-full lg:flex-[2] self-start scroll-mt-24">
                                                    {apps[activeAppIndex] && (
                                                        <AppDetailPanel
                                                            app={apps[activeAppIndex]}
                                                            cycleId={cycleId || 0}
                                                            onPause={async () => { await pauseApp(); await refetchCycleManagement(); }}
                                                            onResume={async () => { await resumeApp(); await refetchCycleManagement(); }}
                                                            onSkip={async () => { await skipApp(); await refetchCycleManagement(); }}
                                                            onRetry={async () => { await retryApp(); await refetchCycleManagement(); }}
                                                            onComplete={async () => { await completeApp(); await refetchCycleManagement(); }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-start gap-3 py-6 text-sm text-muted-foreground bg-background/20 rounded-xl border border-foreground/5 px-4">
                                    <AlertTriangle className="w-5 h-5 shrink-0 text-amber-700 dark:text-amber-300" />
                                    <div>
                                        <p className="font-bold text-foreground">Cycle manager is waiting for cycle data.</p>
                                        <p className="text-xs mt-1">Refresh the manager to retry the detail fetch.</p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-4 rounded-full border-foreground/10 hover:bg-foreground/5"
                                            onClick={refetchCycleManagement}
                                        >
                                            <RefreshCcw className="w-3.5 h-3.5 mr-2" /> Refresh Manager
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── SECTION: Mission Workbench (mission-first apps) ──────────── */}
                    {/* Placed after Cycle App Manager: workbenches are mission-scoped */}
                    {/* and only meaningful in the context of an active cycle's mission set. */}
                    {(missionBindings.length > 0 || bindingsLoading) && (
                        <AccordionItem
                            value="mission-workbench"
                            className="bg-background/30 border border-foreground/10 rounded-2xl overflow-hidden px-4 transition-all data-[state=open]:border-primary/30"
                        >
                            <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between text-foreground">
                                <div className="flex flex-wrap items-center gap-3 text-left">
                                    <Package className="w-5 h-5 text-primary" />
                                    <div>
                                        <span className="text-sm font-black uppercase tracking-widest">Mission Workbench</span>
                                        <span className="hidden md:inline-block text-[10px] text-muted-foreground ml-3 uppercase tracking-wider font-bold">
                                            Per-mission contextual SDLC apps
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mr-4">
                                    <Badge variant="outline" className="text-[9px] font-black border-foreground/10 text-muted-foreground bg-foreground/5">
                                        {missionBindings.length} MISSION{missionBindings.length === 1 ? "" : "S"}
                                    </Badge>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pb-6 pt-2">
                                {bindingsLoading ? (
                                    <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground bg-background/20 rounded-xl border border-foreground/5">
                                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                        Loading mission bindings
                                    </div>
                                ) : missionBindings.length === 0 ? (
                                    <div className="py-8 text-center bg-background/20 rounded-xl border border-foreground/5">
                                        <Package className="w-8 h-8 mx-auto text-muted-foreground/50" />
                                        <p className="mt-3 text-sm font-bold">No mission bindings configured</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Apps with <code className="px-1 py-0.5 rounded bg-foreground/5 text-[10px]">bindings: [missionName]</code> in the cycle YAML will appear here per mission row.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-1 bg-background/20 rounded-xl border border-foreground/5 divide-y divide-white/5">
                                        {missionBindings.map(row => (
                                            <div key={row.missionId} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-foreground/[0.02]">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-medium text-foreground truncate">{row.missionName}</div>
                                                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">mission #{row.missionId}</div>
                                                </div>
                                                <AppsDropdown
                                                    missionId={row.missionId}
                                                    bindings={row.bindings}
                                                    onOpenModal={(binding) => handleOpenWorkbench(row.missionId, row.missionName, binding)}
                                                    canEditBuilder={true}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    )}

                    {/* ── SECTION 3: Advanced GANT Timeline ────────────────────────── */}
                    <AccordionItem 
                        value="gantt" 
                        className="bg-background/30 border border-foreground/10 rounded-2xl overflow-hidden px-4 transition-all data-[state=open]:border-primary/30"
                    >
                        <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between text-foreground">
                            <div className="flex flex-wrap items-center gap-3 text-left">
                                <Clock className="w-5 h-5 text-primary" />
                                <div>
                                    <span className="text-sm font-black uppercase tracking-widest">GANTT Schedule Timeline</span>
                                    <span className="hidden md:inline-block text-[10px] text-muted-foreground ml-3 uppercase tracking-wider font-bold">
                                        CPM Scheduling Engine
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mr-4">
                                <Badge variant="outline" className="text-[9px] font-black border-primary/20 text-primary bg-primary/5">
                                    {cycle.metadata?.blueprints?.length ?? 0} PHASES
                                </Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-2">
                            <Card className="bg-background/20 border-foreground/5 shadow-xl overflow-hidden">
                                <CardHeader className="border-b border-foreground/5 pb-5 flex flex-row items-center justify-between bg-foreground/[0.01]">
                                    <div className="space-y-1">
                                        <CardTitle className="text-lg font-black tracking-tighter uppercase flex items-center gap-2">
                                            <Clock className="w-5 h-5 text-primary" /> Advanced <span className="text-primary">GANT</span> Management
                                        </CardTitle>
                                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                                            Strategic Timeline • Drag to Reschedule • Critical Path Method Engine
                                        </CardDescription>
                                    </div>
                                    {!isTerminated && (
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="sm" className="rounded-full border-foreground/10 text-[10px] uppercase font-black tracking-widest bg-background/40 hover:bg-primary/10"
                                                onClick={openBlueprintEditor}>
                                                <GitBranch className="w-3 h-3 mr-1.5 text-primary" /> {isLiveCycle ? "Modify Live Plan" : "Draft Blueprints"}
                                            </Button>
                                            <Button variant="ghost" size="sm" className="rounded-full h-8 px-3 text-[10px] font-bold" onClick={fetchData}>
                                                <RefreshCcw className="w-3 h-3 mr-1.5" /> Refresh
                                            </Button>
                                        </div>
                                    )}
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="p-4 bg-background/20">
                                        <CycleGanttChart
                                            blueprints={cycle.metadata?.blueprints ?? []}
                                            startDate={ganttStartDate}
                                            timeUnit={(cycle.metadata as any)?.timeUnit}
                                            excludeWeekends={(cycle.metadata as any)?.excludeWeekends || (cycle.metadata as any)?.exclude_weekends}
                                            runs={runs.map((r): ActualRun => ({
                                                name: r.name,
                                                status: r.status,
                                                startedAt: r.createdAt,
                                                finishedAt: r.status === "completed" || r.status === "failed" ? r.updatedAt : undefined,
                                            }))}
                                            onChange={isTerminated ? undefined : async (updatedBlueprints) => {
                                                try {
                                                    await apiAction("PATCH", "/blueprints", {
                                                        blueprints: updatedBlueprints,
                                                        reason: "Schedule adjusted via Gantt drag",
                                                    });
                                                    await fetchData();
                                                    toast({ title: "Schedule saved", description: "CPM offsets recalculated." });
                                                } catch (e: any) {
                                                    toast({ title: "Save failed", description: e.message, variant: "destructive" });
                                                }
                                            }}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── SECTION 1: Strategic Command & Objective ────────────────── */}
                    <AccordionItem 
                        value="objective" 
                        className="bg-background/30 border border-foreground/10 rounded-2xl overflow-hidden px-4 transition-all data-[state=open]:border-primary/30"
                    >
                        <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between text-foreground">
                            <div className="flex flex-wrap items-center gap-3 text-left">
                                <Target className="w-5 h-5 text-primary" />
                                <div>
                                    <span className="text-sm font-black uppercase tracking-widest">Strategic Direction</span>
                                    <span className="hidden md:inline-block text-[10px] text-muted-foreground ml-3 uppercase tracking-wider font-bold">
                                        Objective • Sentinel Audit
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mr-4">
                                <Badge variant="outline" className="text-[9px] font-black border-primary/20 text-primary bg-primary/5">
                                    ALIGNMENT: {cycle?.outcomeMetrics?.alignmentScore ?? 100}%
                                </Badge>
                                <Badge variant="outline" className={`text-[9px] font-black ${
                                    (cycle?.outcomeMetrics?.alignmentScore ?? 100) >= 75 ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" : "text-red-400 border-red-500/20 bg-red-500/5"
                                }`}>
                                    STATUS: {(cycle?.outcomeMetrics?.alignmentScore ?? 100) >= 50 ? "STABLE" : "DRIFT"}
                                </Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-2">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <Card className="lg:col-span-2 bg-background/20 border-foreground/5 shadow-xl">
                                    <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-foreground/5 bg-foreground/[0.01]">
                                        <div>
                                            <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground">Strategic Objective</CardTitle>
                                            <CardDescription className="text-[9px]">Primary mission goal and autonomous directive.</CardDescription>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="pt-4 pb-6">
                                        <p className="text-lg font-medium leading-relaxed text-foreground/90">
                                            {cycle.objective}
                                        </p>
                                        {cycle.description && cycle.description !== cycle.objective && (
                                            <p className="text-xs text-muted-foreground mt-3 italic border-l-2 border-primary/20 pl-4 py-1 bg-primary/5 rounded-r-lg">
                                                {cycle.description}
                                            </p>
                                        )}
                                        {initialTrigger && (() => {
                                            const info = parseTriggerDescription(initialTrigger.trigger);
                                            const IconComp = platformIcons[info.source] || Zap;
                                            return (
                                                <div className="mt-6 border-t border-foreground/5 pt-4">
                                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Initial Trigger Condition</h4>
                                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-foreground/5 bg-foreground/[0.01]">
                                                        <div className="flex items-center gap-3">
                                                            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                                                                <IconComp className="w-5 h-5" />
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-bold text-foreground uppercase tracking-wider">{info.label}</p>
                                                                <p className="text-xs text-muted-foreground mt-0.5">{info.details}</p>
                                                            </div>
                                                        </div>
                                                        {typeof initialTrigger.trigger === 'object' && initialTrigger.trigger.condition && (
                                                            <div className="self-start sm:self-center">
                                                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">CEL Expression</div>
                                                                <code className="text-[11px] font-mono bg-background/40 border border-foreground/5 text-amber-700 dark:text-amber-300 px-2 py-1 rounded">
                                                                    {initialTrigger.trigger.condition}
                                                                </code>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </CardContent>
                                </Card>

                                <SentinelMonitor 
                                    alignmentScore={cycle?.outcomeMetrics?.alignmentScore ?? 100}
                                    isCriticalDrift={(cycle?.outcomeMetrics?.alignmentScore ?? 100) < 50}
                                    lastAuditAt={cycle?.outcomeMetrics?.lastAuditAt}
                                    auditLog={cycle?.outcomeMetrics?.auditLog ?? undefined}
                                />
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── SECTION 2: Governance & Finance ─────────────────────────── */}
                    <AccordionItem 
                        value="governance" 
                        className="bg-background/30 border border-foreground/10 rounded-2xl overflow-hidden px-4 transition-all data-[state=open]:border-primary/30"
                    >
                        <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between text-foreground">
                            <div className="flex flex-wrap items-center gap-3 text-left">
                                <DollarSign className="w-5 h-5 text-emerald-400" />
                                <div>
                                    <span className="text-sm font-black uppercase tracking-widest">Governance & Finance</span>
                                    <span className="hidden md:inline-block text-[10px] text-muted-foreground ml-3 uppercase tracking-wider font-bold">
                                        Strategic Guardrails • Spend Telemetry
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mr-4">
                                <Badge variant="outline" className="text-[9px] font-black border-emerald-500/20 text-emerald-400 bg-emerald-500/5">
                                    SPENT: ${(cycle.outcomeMetrics?.totalSpend ?? totalRunCost).toFixed(2)}
                                </Badge>
                                <Badge variant="outline" className="text-[9px] font-black border-foreground/10 text-muted-foreground bg-foreground/5">
                                    BUDGET CAP: ${budgetNum.toFixed(2)}
                                </Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-2">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-1">
                                    <GovernancePanel 
                                        priority={cycle.priority ?? 5}
                                        budgetLimitUsd={String(cycle.budgetLimitUsd ?? "100")}
                                        tokenLimit={cycle.tokenLimit ?? 1000}
                                        isPaused={cycle.status === "paused"}
                                        onUpdate={(patch) => handlePanelSave(patch)}
                                        onRequestEdit={() => setShowEditPanel(true)}
                                    />
                                </div>

                                <Card className="lg:col-span-1 bg-background/20 border-foreground/5 shadow-xl">
                                    <CardHeader className="pb-3 border-b border-foreground/5 bg-foreground/[0.01]">
                                        <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                            <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Fiscal Pulse
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-5 pt-4">
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-[10px] font-bold">
                                                <span className="text-muted-foreground">Budget Utilization</span>
                                                <span className={budgetWarning ? "text-red-400" : "text-foreground"}>{budgetPct.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={budgetPct} className={`h-1.5 ${budgetWarning ? "bg-red-500/20" : "bg-foreground/5"}`} 
                                                indicatorClassName={budgetWarning ? "bg-red-500" : "bg-primary"} />
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex justify-between text-[10px] font-bold">
                                                <span className="text-muted-foreground">Token Reservoir</span>
                                                <span className={tokenWarning ? "text-amber-400" : "text-foreground"}>{tokenPct.toFixed(1)}%</span>
                                            </div>
                                            <Progress value={tokenPct} className="h-1.5 bg-foreground/5" 
                                                indicatorClassName={tokenWarning ? "bg-amber-500" : "bg-blue-500"} />
                                        </div>

                                        <div className="pt-4 border-t border-foreground/5 grid grid-cols-2 gap-4 text-center">
                                            <div>
                                                <p className="text-[9px] font-black text-muted-foreground uppercase">Total Spend</p>
                                                <p className="text-lg font-black text-emerald-400">${(cycle.outcomeMetrics?.totalSpend ?? totalRunCost).toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[9px] font-black text-muted-foreground uppercase">Burn Rate</p>
                                                <p className={`text-lg font-black ${budgetPct > 90 ? "text-red-400" : budgetPct > 50 ? "text-amber-400" : "text-foreground"}`}>
                                                    {budgetPct > 90 ? "Critical" : budgetPct > 50 ? "Elevated" : "Nominal"}
                                                </p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Quick Fleet Metrics */}
                                <div className="lg:col-span-1 space-y-3">
                                    {[
                                        { label: "Fleet Status", value: statusCfg.label, icon: Activity, color: statusCfg.cls.includes("emerald") ? "text-emerald-400" : "text-amber-400" },
                                        { label: "Active Runs", value: activeRuns, icon: Zap, color: "text-primary" },
                                        { label: "Success Rate", value: `${successRate}%`, icon: ShieldCheck, color: "text-emerald-400" },
                                    ].map((m, i) => (
                                        <div key={i} className="bg-background/20 border border-foreground/5 rounded-2xl p-4 flex items-center gap-4 hover:bg-background/40 transition-all">
                                            <div className={`p-2 rounded-xl bg-foreground/5 ${m.color}`}>
                                                <m.icon className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">{m.label}</p>
                                                <p className={`text-sm font-black tracking-tight ${m.color}`}>{m.value}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── SECTION 4: Architecture & Unit Monitoring ────────────────── */}
                    <AccordionItem 
                        value="architecture" 
                        className="bg-background/30 border border-foreground/10 rounded-2xl overflow-hidden px-4 transition-all data-[state=open]:border-primary/30"
                    >
                        <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between text-foreground">
                            <div className="flex flex-wrap items-center gap-3 text-left">
                                <GitBranch className="w-5 h-5 text-primary" />
                                <div>
                                    <span className="text-sm font-black uppercase tracking-widest">System Architecture & Monitoring</span>
                                    <span className="hidden md:inline-block text-[10px] text-muted-foreground ml-3 uppercase tracking-wider font-bold">
                                        Logic & Knowledge Graphs • Phase Progress
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mr-4">
                                <Badge variant="outline" className="text-[9px] font-black border-primary/20 text-primary bg-primary/5">
                                    ACTIVE MAP
                                </Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-2">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Dependency Architecture */}
                                <Card className="bg-background/20 border-foreground/5 shadow-xl">
                                    <Tabs defaultValue="logic" className="w-full">
                                        <CardHeader className="pb-3 border-b border-foreground/5 flex flex-row items-center justify-between bg-foreground/[0.01]">
                                            <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                                <GitBranch className="w-3.5 h-3.5 text-primary" /> Architecture
                                            </CardTitle>
                                            <TabsList className="bg-background/20 border border-foreground/10 h-8">
                                                <TabsTrigger value="logic" className="text-[10px] uppercase font-black px-3 data-[state=active]:bg-primary/20">Logic</TabsTrigger>
                                                <TabsTrigger value="knowledge" className="text-[10px] uppercase font-black px-3 data-[state=active]:bg-primary/20">Knowledge</TabsTrigger>
                                            </TabsList>
                                        </CardHeader>
                                        <CardContent className="p-0">
                                            <TabsContent value="logic" className="m-0">
                                                <div className="h-[300px] w-full">
                                                    {cycle.metadata?.blueprints ? (
                                                        <DependencyGraph blueprints={cycle.metadata.blueprints} />
                                                    ) : (
                                                        <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground italic">
                                                            No architecture defined.
                                                        </div>
                                                    )}
                                                </div>
                                            </TabsContent>
                                            <TabsContent value="knowledge" className="m-0">
                                                <div className="h-[300px] w-full">
                                                    <KnowledgeGraphVisualizer cycleId={cycle.id} />
                                                </div>
                                            </TabsContent>
                                        </CardContent>
                                    </Tabs>
                                </Card>

                                {/* Operational Phases */}
                                <Card className="bg-background/20 border-foreground/5 shadow-xl">
                                    <CardHeader className="pb-3 border-b border-foreground/5 flex flex-row items-center justify-between bg-foreground/[0.01]">
                                        <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                            <Milestone className="w-3.5 h-3.5 text-primary" /> Unit Monitoring
                                        </CardTitle>
                                        <Badge variant="outline" className="text-[9px] font-black border-primary/20 text-primary">
                                            {cycle.metadata?.blueprints?.length ?? 0} PHASES
                                        </Badge>
                                    </CardHeader>
                                    <CardContent className="p-6">
                                        <div className="space-y-4">
                                            {cycle.metadata?.blueprints?.map((bp, i) => (
                                                <div key={i} className="flex items-center gap-3 group">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-all shadow-[0_0_8px_rgba(var(--primary),0.4)]" />
                                                    <div className="flex-1">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-[11px] font-black uppercase tracking-widest text-foreground/80 group-hover:text-foreground transition-colors">{bp.name}</span>
                                                            <span className="text-[9px] font-bold text-muted-foreground">{bp.estimatedDays}D</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )) || (
                                                <div className="py-12 text-center text-[10px] text-muted-foreground italic uppercase tracking-widest opacity-30">
                                                    Grid Empty
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── SECTION 5: Telemetry & Mission Transcript ────────────────── */}
                    <AccordionItem 
                        value="logs" 
                        className="bg-background/30 border border-foreground/10 rounded-2xl overflow-hidden px-4 transition-all data-[state=open]:border-primary/30"
                    >
                        <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between text-foreground">
                            <div className="flex flex-wrap items-center gap-3 text-left">
                                <ScrollText className="w-5 h-5 text-primary" />
                                <div>
                                    <span className="text-sm font-black uppercase tracking-widest">Telemetry & Logs</span>
                                    <span className="hidden md:inline-block text-[10px] text-muted-foreground ml-3 uppercase tracking-wider font-bold">
                                        Live Stream • System State • Strategic Logs
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mr-4">
                                <Badge variant="outline" className="text-[9px] bg-primary/5 text-primary border-primary/20">
                                    {activeRuns} ACTIVE RUNS
                                </Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-2">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Live Telemetry */}
                                <Card className="bg-background/20 border-foreground/5 shadow-xl">
                                    <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-foreground/5 bg-foreground/[0.01]">
                                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                            <Zap className="w-3.5 h-3.5 text-primary" /> Live Telemetry
                                        </CardTitle>
                                        <Badge variant="outline" className="text-[9px] bg-primary/5">{activeRuns} Active</Badge>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                        <div className="max-h-[300px] overflow-y-auto px-4 pb-4 pt-4 space-y-2">
                                            {runs.slice(0, 10).map((run) => (
                                                <div key={run.id} className="flex items-center justify-between p-2.5 rounded-lg bg-foreground/[0.02] border border-foreground/5">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-1.5 rounded-md ${RUN_STATUS_CONFIG[run.status]?.cls ?? "text-muted-foreground"} bg-foreground/5`}>
                                                            {RUN_STATUS_CONFIG[run.status]?.icon ?? <Clock className="w-3 h-3" />}
                                                        </div>
                                                        <div>
                                                            <p className="text-[11px] font-bold">{run.name}</p>
                                                            <p className="text-[9px] text-muted-foreground">{safeTime(run.createdAt)}</p>
                                                        </div>
                                                    </div>
                                                    <Link to={`/operations/runs/${run.id}`}>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <ChevronRight className="w-4 h-4" />
                                                        </Button>
                                                    </Link>
                                                </div>
                                            ))}
                                            {runs.length === 0 && (
                                                <div className="py-12 text-center text-[10px] text-muted-foreground/40 italic">
                                                    Awaiting first autonomous trigger...
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* System State */}
                                <Card className="bg-background/20 border-foreground/5 shadow-xl">
                                    <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-foreground/5 bg-foreground/[0.01]">
                                        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                            <Database className="w-3.5 h-3.5 text-blue-400" /> System State
                                        </CardTitle>
                                        <Button variant="ghost" size="sm" className="h-6 text-[9px] uppercase font-black" onClick={() => setShowEditPanel(true)}>
                                            <Settings2 className="w-3 h-3 mr-1" /> Config
                                        </Button>
                                    </CardHeader>
                                    <CardContent className="space-y-4 pt-4">
                                        <div className="space-y-3">
                                            <div className="p-3 rounded-xl bg-foreground/[0.02] border border-foreground/5 space-y-1">
                                                <p className="text-[9px] font-black text-muted-foreground uppercase">Triggers</p>
                                                <p className="text-xs font-mono">{cycle.recurrence ?? "Manual"}</p>
                                            </div>
                                        </div>
                                        {cycle.successCriteria && (
                                            <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/15 space-y-1">
                                                <p className="text-[9px] font-black text-blue-400 uppercase flex items-center gap-1">
                                                    <ShieldCheck className="w-2.5 h-2.5" /> Auto-Halt Guard
                                                </p>
                                                <p className="text-[10px] text-foreground/80 leading-tight">
                                                    Stop on <span className="font-mono text-blue-700 dark:text-blue-300">{cycle.successCriteria.stop_on ?? "N/A"}</span>
                                                </p>
                                            </div>
                                        )}
                                        <div className="pt-2">
                                            <Button 
                                                variant="ghost" 
                                                className="w-full h-8 text-[9px] uppercase font-black tracking-widest border border-foreground/5 hover:bg-foreground/5"
                                                onClick={handleExportLog}
                                            >
                                                <FileDiff className="w-3 h-3 mr-2" /> Export Strategic Log
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Mission Transcript */}
                                <Card className="bg-background/20 border-foreground/5 shadow-xl max-h-[350px] flex flex-col">
                                    <CardHeader className="pb-3 border-b border-foreground/5 bg-foreground/[0.01]">
                                        <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                            <ScrollText className="w-3.5 h-3.5 text-primary" /> Mission Transcript
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-0 overflow-y-auto flex-1 custom-scrollbar">
                                        <div className="p-4 space-y-4">
                                            {cycle.outcomeMetrics?.auditLog ? (
                                                cycle.outcomeMetrics.auditLog.split('\n').map((line: string, i: number) => (
                                                    <div key={i} className="flex gap-3 text-[10px] group">
                                                        <span className="text-muted-foreground/30 font-mono shrink-0 pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                                                        <p className="text-foreground/70 leading-relaxed group-hover:text-foreground transition-colors">{line}</p>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="py-12 text-center text-[10px] text-muted-foreground/30 italic">
                                                    No entries in strategic log yet.
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </AccordionContent>
                    </AccordionItem>

                    {/* ── SECTION 6: Simulations & Hypotheses ─────────────────────── */}
                    <AccordionItem 
                        value="hypothesis" 
                        className="bg-background/30 border border-foreground/10 rounded-2xl overflow-hidden px-4 transition-all data-[state=open]:border-primary/30"
                    >
                        <AccordionTrigger className="hover:no-underline py-4 flex items-center justify-between text-foreground">
                            <div className="flex flex-wrap items-center gap-3 text-left">
                                <Activity className="w-5 h-5 text-primary" />
                                <div>
                                    <span className="text-sm font-black uppercase tracking-widest">Simulations & Predictive Analytics</span>
                                    <span className="hidden md:inline-block text-[10px] text-muted-foreground ml-3 uppercase tracking-wider font-bold">
                                        What-If Branch Explorer • Execution Flow
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mr-4">
                                <Badge variant="outline" className="text-[9px] border-primary/20 text-primary">
                                    SIMULATOR ACTIVE
                                </Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-2">
                            <div className="space-y-6">
                                <HypothesisExplorer contextId={`cycle-${cycle.id}`} />
                                <ExecutionFlowToggle cycleId={cycle.id} />
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>


            {/* ── Mission Workbench iframe modal (Modal mode for app bindings) ─ */}
            <WorkbenchModal
                open={workbenchModal.open}
                onOpenChange={(open) => setWorkbenchModal(s => ({ ...s, open }))}
                binding={workbenchModal.binding}
                missionId={workbenchModal.missionId}
                missionName={workbenchModal.missionName}
                cycleId={cycleId}
            />

            {/* ── Unified Edit Panel ────────────────────────────────────────── */}
            {cycle && (
                <CycleEditPanel
                    open={showEditPanel}
                    onClose={() => setShowEditPanel(false)}
                    cycle={cycle}
                    onSave={handlePanelSave}
                    saving={panelSaving}
                />
            )}

            {/* ── Configure Dialog (legacy — kept for backward compat) ──────── */}
            <Dialog open={showConfigure} onOpenChange={setShowConfigure}>
                <DialogContent className="bg-background border-foreground/10 text-foreground sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black">Cycle Configuration</DialogTitle>
                        <DialogDescription>Adjust tactical guardrails and strategic objectives.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Cycle Name</Label>
                            <Input value={editName} onChange={e => setEditName(e.target.value)} className="bg-background/40 border-foreground/10" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Strategic Objective</Label>
                            <Textarea value={editObjective} onChange={e => setEditObjective(e.target.value)}
                                rows={3} className="bg-background/40 border-foreground/10 resize-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Budget (USD)</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
                                    <Input value={editBudget} onChange={e => setEditBudget(e.target.value)} type="number" className="pl-6 bg-background/40 border-foreground/10" />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Priority</Label>
                                <Input value={editPriority} onChange={e => setEditPriority(e.target.value)} type="number" min={1} max={10} className="bg-background/40 border-foreground/10" />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowConfigure(false)}>Cancel</Button>
                        <Button onClick={handleSaveConfig} disabled={mutating !== null} className="bg-primary hover:bg-primary/90">
                            {mutating === "Save" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Live Plan Edit Warning Dialog ─────────────────────────────── */}
            <Dialog open={showBlueprintLiveWarning} onOpenChange={setShowBlueprintLiveWarning}>
                <DialogContent className="bg-background border-amber-500/20 text-foreground sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black flex items-center gap-2 text-amber-700 dark:text-amber-300">
                            <TriangleAlert className="w-5 h-5" /> Editing a Live Plan
                        </DialogTitle>
                        <DialogDescription className="text-amber-700 dark:text-amber-200/60">
                            This cycle is currently <strong className="text-amber-700 dark:text-amber-300">{cycle?.status}</strong>. Editing its blueprints while missions are running may conflict with active executions. The previous plan will be saved to revision history before your changes are applied.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-1">
                        <Label className="text-xs font-semibold text-muted-foreground">Reason for change <span className="font-normal">(recommended)</span></Label>
                        <Textarea
                            value={blueprintChangeReason}
                            onChange={e => setBlueprintChangeReason(e.target.value)}
                            placeholder="e.g. Added extra validation phase after Discovery failed…"
                            rows={2}
                            className="bg-background/40 border-amber-500/20 resize-none text-sm focus:border-amber-500/40"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowBlueprintLiveWarning(false)}>Cancel</Button>
                        <Button onClick={confirmBlueprintEdit}
                            className="bg-amber-500 hover:bg-amber-400 text-black font-bold">
                            I understand — edit plan
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Blueprint Editor Dialog ───────────────────────────────────── */}
            <Dialog open={showBlueprintEditor} onOpenChange={setShowBlueprintEditor}>
                <DialogContent className="bg-background border-foreground/10 text-foreground max-w-3xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <DialogTitle className="text-xl font-black">Edit Mission Blueprints</DialogTitle>
                                <DialogDescription>Modify the mission sequence, dependencies, and configuration.</DialogDescription>
                            </div>
                            {isLiveCycle && (
                                <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 shrink-0 mt-1">
                                    <TriangleAlert className="w-3 h-3 mr-1" /> Live cycle
                                </Badge>
                            )}
                        </div>
                        {isLiveCycle && blueprintChangeReason && (
                            <p className="text-xs text-amber-700 dark:text-amber-300/70 mt-1 italic">"{blueprintChangeReason}"</p>
                        )}
                    </DialogHeader>
                    <div className="py-2">
                        <BlueprintBuilder
                            blueprints={editBlueprints}
                            onChange={bp => { setEditBlueprints(bp); setBlueprintValidation(null); }}
                            cycleId={cycleId}
                            onValidation={r => setBlueprintValidation(r)}
                        />
                    </div>
                    {!isLiveCycle && (
                        <div className="space-y-1.5 pt-2 border-t border-foreground/5">
                            <Label className="text-xs text-muted-foreground">Change note <span className="font-normal">(optional)</span></Label>
                            <Textarea
                                value={blueprintChangeReason}
                                onChange={e => setBlueprintChangeReason(e.target.value)}
                                placeholder="Why are you changing this plan?"
                                rows={2}
                                className="bg-background/40 border-foreground/10 resize-none text-sm"
                            />
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowBlueprintEditor(false)}>Cancel</Button>
                        <Button
                            onClick={handleSaveBlueprints}
                            disabled={mutating !== null || (blueprintValidation !== null && !blueprintValidation.valid && (blueprintValidation.errors?.length ?? 0) > 0)}
                            className="bg-primary hover:bg-primary/90"
                            title={blueprintValidation && !blueprintValidation.valid ? "Fix validation errors before saving" : undefined}
                        >
                            {mutating === "Save blueprints" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            {isLiveCycle ? "Save & Record Change" : "Save Blueprints"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Blueprint History Drawer ──────────────────────────────────── */}
            <Dialog open={showBlueprintHistory} onOpenChange={setShowBlueprintHistory}>
                <DialogContent className="bg-background border-foreground/10 text-foreground max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black flex items-center gap-2">
                            <FileDiff className="w-5 h-5 text-primary" /> Plan Revision History
                        </DialogTitle>
                        <DialogDescription>
                            {cycle?.metadata?.blueprint_history?.length ?? 0} recorded change{(cycle?.metadata?.blueprint_history?.length ?? 0) !== 1 ? "s" : ""} to this cycle's blueprints while live.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {(cycle?.metadata?.blueprint_history ?? []).map((entry, i) => (
                            <HistoryEntry key={i} entry={entry} index={i}
                                currentBlueprints={i === 0 ? (cycle?.metadata?.blueprints ?? []) : (cycle?.metadata?.blueprint_history?.[i - 1]?.blueprints ?? [])} />
                        ))}
                        {(cycle?.metadata?.blueprint_history?.length ?? 0) === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-8 italic">No plan changes recorded yet.</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowBlueprintHistory(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Milestone Approve Dialog — structured resource form ───────── */}
            <Dialog open={showMilestoneApprove} onOpenChange={v => { setShowMilestoneApprove(v); if (!v) setMilestoneResourceAnswers({}); }}>
                <DialogContent className="bg-background border-amber-500/20 text-foreground max-w-lg max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-amber-400" /> Approve Milestone Gate
                        </DialogTitle>
                        <DialogDescription className="text-amber-700 dark:text-amber-200/60">
                            Confirm this strategic checkpoint and provide any fresh resources the next phase requires.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5 py-2">
                        {pendingResourceBlueprints.length === 0 ? (
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-sm">
                                <ShieldCheck className="w-4 h-4 shrink-0" />
                                No resource inputs required — approve to resume the fleet.
                            </div>
                        ) : (
                            pendingResourceBlueprints.map(bp => (
                                <div key={bp.name} className="space-y-3">
                                    <p className="text-xs font-black uppercase tracking-widest text-amber-400/80">{bp.name}</p>
                                    {normalizeCycleInputRequirements(bp).map(res => {
                                        const existing = cycle?.metadata?.resource_answers?.[bp.name]?.[res.id] ?? "";
                                        return (
                                            <div key={res.id} className="space-y-1.5">
                                                <Label className="text-xs font-semibold flex items-center gap-1.5">
                                                    {res.type === "url_list" && <span className="text-primary">🔗</span>}
                                                    {res.type === "credential" && <span className="text-primary">🔑</span>}
                                                    {res.type === "dataset" && <span className="text-primary">🗄</span>}
                                                    {res.type === "number" && <span className="text-primary">#</span>}
                                                    {res.type === "text" && <span className="text-primary">📄</span>}
                                                    {res.label}
                                                    {!res.required && <span className="text-muted-foreground font-normal">(optional)</span>}
                                                </Label>
                                                <p className="text-[10px] text-muted-foreground">{res.description}</p>
                                                {res.type === "url_list" ? (
                                                    <Textarea
                                                        defaultValue={existing}
                                                        onChange={e => setMilestoneResourceAnswers(p => ({
                                                            ...p,
                                                            [bp.name]: { ...(p[bp.name] ?? {}), [res.id]: e.target.value },
                                                        }))}
                                                        placeholder={res.placeholder ?? "One URL per line…"}
                                                        rows={3}
                                                        className="bg-background/40 border-foreground/10 font-mono text-xs resize-none"
                                                    />
                                                ) : (
                                                    <Input
                                                        defaultValue={existing}
                                                        onChange={e => setMilestoneResourceAnswers(p => ({
                                                            ...p,
                                                            [bp.name]: { ...(p[bp.name] ?? {}), [res.id]: e.target.value },
                                                        }))}
                                                        placeholder={res.placeholder ?? `Enter ${res.label}…`}
                                                        className="bg-background/40 border-foreground/10 h-10 text-sm"
                                                    />
                                                )}
                                                {existing && (
                                                    <p className="text-[9px] text-muted-foreground/50 italic">Current: {existing.length > 60 ? existing.slice(0, 59) + "…" : existing}</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowMilestoneApprove(false)}>Cancel</Button>
                        <Button onClick={handleMilestoneApprove} disabled={mutating !== null}
                            className="bg-amber-500 hover:bg-amber-400 text-black font-bold">
                            {mutating === "Approve milestone" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                            Approve & Continue Fleet
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Abort Confirm Dialog ──────────────────────────────────────── */}
            <Dialog open={showAbortConfirm} onOpenChange={setShowAbortConfirm}>
                <DialogContent className="bg-background border-foreground/10 text-foreground sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black text-red-400">Abort Cycle</DialogTitle>
                        <DialogDescription>
                            This will immediately terminate all active mission runs and mark the cycle as cancelled. This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowAbortConfirm(false)}>Cancel</Button>
                        <Button onClick={handleAbort} disabled={mutating !== null}
                            className="bg-red-500 hover:bg-red-600 text-foreground font-bold">
                            {mutating === "Abort" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ban className="w-4 h-4 mr-2" />}
                            Yes, Abort Cycle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            </motion.div>
            </AnimatePresence>
        </div>
    );
}
