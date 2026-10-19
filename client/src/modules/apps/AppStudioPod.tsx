import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    BarChart3,
    Blocks,
    Bot,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Circle,
    CircuitBoard,
    Cpu,
    Database,
    ExternalLink,
    FileText,
    GitBranch,
    Hammer,
    Layers,
    LayoutDashboard,
    Loader2,
    Maximize2,
    Minimize2,
    Rocket,
    RotateCcw,
    ShieldCheck,
    Sparkles,
    X,
    Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
    FORGE_STAGE_COUNT,
    FORGE_STAGES,
    forgeStageAt,
    forgeStageHeading,
} from "@shared/forge-stages";
import {
    initialForgeStudioState,
    reduceForgeStudioAll,
    toStudioEvents,
    type ForgeStudioState,
} from "@shared/forge-studio-events";
import { AppInteractiveBuilderTab } from "@domain-ui/apps/ui/modules/apps/components/tabs/AppInteractiveBuilderTab";
import { ForgeArtifactTabs, type ForgeTabId } from "./ForgeArtifactTabs";
import type { AppStudioSelection, AppStudioChangeRecord } from "@shared/app-studio-context";

/**
 * App Studio — the Forge and Builder surfaces mounted beside a CREW room.
 *
 * One pod with two modes, because they are two phases of one job rather than
 * two products: Forge takes a request to a running application, Builder evolves
 * that application. When a forge run reaches an app id, this component switches
 * itself into Builder over the same mount rather than sending the author to
 * another page — which is the whole point of mounting it here.
 *
 * The header stays deliberately thin. A build in progress needs its step, its
 * status and its latest event; a masthead explaining what App Forge is helps
 * nobody who is already watching it run.
 */

export type AppStudioMode = "forge" | "builder";
export type AppStudioView = "preview" | "api" | "diagnostics" | "publish";

export interface ArchitectureArchetype {
    slug: string;
    name: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    category: string;
    complexity?: "Simple" | "Medium" | "Advanced";
    estimatedTime?: string;
}

export const ARCHITECTURE_ARCHETYPES: readonly ArchitectureArchetype[] = [
    {
        slug: "analytics-dashboard",
        name: "Analytics Dashboard",
        description: "Real-time metrics, StatCard KPIs, trend charts, and multi-chart comparisons.",
        icon: BarChart3,
        category: "Analytics",
        complexity: "Simple",
        estimatedTime: "~45s",
    },
    {
        slug: "industrial-dashboard",
        name: "AI Workforce Dashboard",
        description: "Industrial monitoring, hero stats, agent task dispatch, and telemetry flux.",
        icon: Zap,
        category: "Operations",
        complexity: "Medium",
        estimatedTime: "~1.5m",
    },
    {
        slug: "chat-assistant",
        name: "Chat Assistant",
        description: "Conversational streaming agent with suggested prompts, memory, and platform API.",
        icon: Bot,
        category: "Communication",
        complexity: "Simple",
        estimatedTime: "~30s",
    },
    {
        slug: "crud-app",
        name: "Data Workbench / CRUD",
        description: "Sortable DataTables, search/filters, modal forms, and dataset integration.",
        icon: Database,
        category: "Productivity",
        complexity: "Medium",
        estimatedTime: "~1m",
    },
    {
        slug: "operations-console",
        name: "Operations Console",
        description: "Task pipelines, queue management, process dispatch, and system health.",
        icon: LayoutDashboard,
        category: "Operations",
        complexity: "Advanced",
        estimatedTime: "~2.5m",
    },
    {
        slug: "workflow-wizard",
        name: "Workflow Wizard",
        description: "Multi-step guided procedures, conditional branches, and stateful form submission.",
        icon: GitBranch,
        category: "Productivity",
        complexity: "Medium",
        estimatedTime: "~1m",
    },
] as const;

export interface ScaffoldPack {
    id: string;
    name: string;
    description: string;
}

export const SCAFFOLD_PACKS: readonly ScaffoldPack[] = [
    {
        id: "core-node-express",
        name: "Node Express Host",
        description: "Node.js Express container runtime with REST route handling",
    },
    {
        id: "ui-oddjob-design-system",
        name: "Oddjob Design System",
        description: "Accessible UI components, dark mode theme & responsive layout",
    },
    {
        id: "data-postgres-drizzle",
        name: "Postgres + Drizzle",
        description: "Durable relational database models, schema & migrations",
    },
    {
        id: "auth-jwt",
        name: "JWT Authentication",
        description: "Role-based token authentication & route protection",
    },
] as const;

export const ARCHETYPE_PROMPT_SUGGESTIONS: Record<string, string[]> = {
    "analytics-dashboard": ["+ KPI StatCards", "+ Time-series trends", "+ CSV Export", "+ Date range filter"],
    "industrial-dashboard": ["+ Agent squad telemetry", "+ Dispatch queue", "+ Worker status matrix", "+ SLA alerts"],
    "chat-assistant": ["+ Streaming chat", "+ Memory retention", "+ Prompt suggestions", "+ API tool calling"],
    "crud-app": ["+ Sortable DataTable", "+ Search & facets", "+ Add/Edit dialog", "+ Batch operations"],
    "operations-console": ["+ Pipeline monitor", "+ Worker node health", "+ Incident banner", "+ Retry controls"],
    "workflow-wizard": ["+ Multi-step sequence", "+ Form validation", "+ Conditional branches", "+ Submission review"],
};

export interface AppStudioPodProps {
    mode: AppStudioMode;
    view?: AppStudioView;
    /** Builder mode: the app to open. */
    appId?: number;
    appName?: string;
    appSlug?: string;
    publicSlug?: string | null;
    status?: string | null;
    /** Forge mode: the run to attach to, and what it was asked to build. */
    jobId?: string | null;
    jobStatus?: string | null;
    title?: string;
    requirements?: string | null;
    /** Outcome of the change the room just applied, when there was one. */
    lastChange?: AppStudioChange | null;
    changes?: AppStudioChangeRecord[];
    onFocusInChat?: (selection: AppStudioSelection) => void;
    onShowTurn?: (turnId: number | string) => void;
    isFocusMode?: boolean;
    onToggleFocusMode?: () => void;
    onClose?: () => void;
    className?: string;
}

export interface AppStudioChange {
    status: "applying" | "applied" | "no_changes" | "answered" | "build_failed" | "failed" | "reverted";
    summary: string;
    instruction?: string;
    filesWritten?: number;
    canRevert?: boolean;
    /** Identifies one dispatch, so a repeated instruction still reloads. */
    appliedAt?: string;
}

interface InstalledRow {
    deployment: { id: number; publicSlug?: string | null; status?: string | null };
    app: { id: number; name: string; slug: string; status?: string | null };
}

const TERMINAL_FAILURE = new Set(["failed", "error"]);

export default function AppStudioPod({
    mode: initialMode,
    view = "preview",
    appId: initialAppId,
    appName,
    appSlug,
    publicSlug,
    status,
    jobId: initialJobId,
    jobStatus,
    title = "New Application",
    requirements,
    lastChange,
    changes = [],
    onFocusInChat,
    onShowTurn,
    isFocusMode = false,
    onToggleFocusMode,
    onClose,
    className,
}: AppStudioPodProps) {
    const queryClient = useQueryClient();

    const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);
    useEffect(() => {
        setJobId(initialJobId ?? null);
    }, [initialJobId]);

    const [selectedBlueprint, setSelectedBlueprint] = useState<string>("analytics-dashboard");
    const [customAppName, setCustomAppName] = useState<string>(title || "New Application");
    const [customSlug, setCustomSlug] = useState<string>(appSlug || "");
    const [customRequirements, setCustomRequirements] = useState<string>(requirements || "");
    const [apiInstructions, setApiInstructions] = useState<string>("");
    const [selectedScaffoldPacks, setSelectedScaffoldPacks] = useState<string[]>([
        "core-node-express",
        "ui-oddjob-design-system",
        "data-postgres-drizzle",
    ]);
    const [walkthroughStep, setWalkthroughStep] = useState<"architecture" | "specs" | "review">("architecture");
    const [forgeView, setForgeView] = useState<"walkthrough" | "live-build">(initialJobId ? "live-build" : "walkthrough");

    useEffect(() => {
        if (title) setCustomAppName(title);
    }, [title]);
    useEffect(() => {
        if (requirements) setCustomRequirements(requirements);
    }, [requirements]);
    useEffect(() => {
        if (appSlug) setCustomSlug(appSlug);
    }, [appSlug]);

    // Listen for agent chat "Add to App Requirements" event
    useEffect(() => {
        const handleAddRequirement = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.text) {
                const authorHeader = detail.agentName
                    ? `\n\n### [Specification from @${detail.agentName}]\n`
                    : `\n\n### [Specification from Crew Chat]\n`;
                const toAppend = `${authorHeader}${detail.text.trim()}`;
                setCustomRequirements((prev) => (prev ? `${prev}${toAppend}` : toAppend.trimStart()));
                // Switch to specs step if in walkthrough mode so user sees their requirement immediately
                setWalkthroughStep("specs");
            }
        };
        window.addEventListener("forge:add-requirement", handleAddRequirement);
        return () => window.removeEventListener("forge:add-requirement", handleAddRequirement);
    }, []);

    const [isStartingBuild, setIsStartingBuild] = useState(false);
    const handleStartBuild = useCallback(async () => {
        setIsStartingBuild(true);
        try {
            const finalName = customAppName || title || "New Application";
            const derivedSlug = (finalName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-app";
            const finalSlug = customSlug || appSlug || derivedSlug;
            const finalReqs = customRequirements || requirements || "New Application";

            const res = await apiRequest("POST", "/api/apps/forge", {
                name: finalName,
                slug: finalSlug,
                description: finalReqs,
                blueprint: selectedBlueprint,
                apiInstructions: apiInstructions || undefined,
                scaffoldPacks: selectedScaffoldPacks,
            });
            const data = await res.json();
            if (data?.jobId) {
                setJobId(data.jobId);
                setForgeView("live-build");
                try {
                    localStorage.setItem("oddjob.appForge.lastJobId.v1", data.jobId);
                } catch {}
            }
        } catch (err) {
            console.error("Failed to start forge run", err);
        } finally {
            setIsStartingBuild(false);
        }
    }, [customAppName, customSlug, customRequirements, title, appSlug, requirements, selectedBlueprint, apiInstructions, selectedScaffoldPacks]);

    const handleResetBuild = useCallback(() => {
        setJobId(null);
        setForgeView("walkthrough");
        setWalkthroughStep("architecture");
        try {
            localStorage.removeItem("oddjob.appForge.lastJobId.v1");
        } catch {}
    }, []);

    /*
     * Mode is state, not a prop read straight through: a forge run that reaches
     * an app id promotes this mount into Builder in place. The prop still wins
     * whenever the room mounts the studio again, so a later explicit Forge
     * request is not swallowed by a promotion from an earlier one.
     */
    const [mode, setMode] = useState<AppStudioMode>(initialMode);
    const [resolvedAppId, setResolvedAppId] = useState<number | undefined>(initialAppId);
    useEffect(() => {
        setMode(initialMode);
        setResolvedAppId(initialAppId);
    }, [initialMode, initialAppId]);

    useEffect(() => {
        // Only recover a saved job ID if no specific new application was requested
        const isFreshNewApp = Boolean(requirements || (title && title !== "New Application"));
        if (!initialJobId && mode === "forge" && !isFreshNewApp) {
            try {
                const saved = localStorage.getItem("oddjob.appForge.lastJobId.v1");
                if (saved) {
                    setJobId(saved);
                }
            } catch {}
        }
    }, [initialJobId, mode, requirements, title]);

    /*
     * One reducer, not a handful of setStates. Every frame the forge sends is a
     * whole snapshot, and reconnects redeliver them — folding through
     * reduceForgeStudio is what stops a replayed frame walking the progress row
     * backwards or reviving a finished run in front of the author.
     */
    const [studio, setStudio] = useState<ForgeStudioState>(initialForgeStudioState);

    const stageIndex = studio.stage;
    const stage = forgeStageAt(stageIndex);
    const buildStatus =
        studio.phase === "completed" ? "completed"
        : studio.phase === "failed" ? "failed"
        : jobStatus ?? "running";
    const buildError = studio.error?.message ?? null;
    const percent = studio.progress;

    /* ── Forge telemetry ──────────────────────────────────────────────────── */

    // Read by the reconnect timer, which must not re-subscribe after the run
    // ends or the pod unmounts.
    const statusRef = useRef(buildStatus);
    statusRef.current = buildStatus;

    useEffect(() => {
        if (mode !== "forge" || !jobId) return;
        if (buildStatus === "completed" || TERMINAL_FAILURE.has(buildStatus)) return;

        let source: EventSource | null = null;
        let reconnect: ReturnType<typeof setTimeout> | null = null;
        let disposed = false;

        const connect = () => {
            source?.close();
            source = new EventSource(`/api/apps/forge/stream/${jobId}`);

            source.onmessage = (event) => {
                let data: any;
                try {
                    data = JSON.parse(event.data);
                } catch {
                    // A malformed frame is not worth tearing the studio down for.
                    return;
                }

                // Translate the snapshot into what CHANGED, then fold. The
                // reducer owns every ordering rule, so this handler no longer
                // has to reason about replays at all.
                const events = toStudioEvents(data);
                if (events.length > 0) {
                    setStudio((prev) => reduceForgeStudioAll(prev, events));
                    setForgeView("live-build");
                }

                // The app id is what makes the transition possible, and it can
                // arrive before the completion frame does.
                if (typeof data.appId === "number") setResolvedAppId(data.appId);

                if (data.status === "completed") {
                    queryClient.invalidateQueries({ queryKey: ["/api/apps/installed"] });
                    source?.close();
                } else if (data.level === "error" || data.status === "failed") {
                    source?.close();
                }
            };

            source.onerror = () => {
                source?.close();
                reconnect = setTimeout(() => {
                    if (!disposed && !TERMINAL_FAILURE.has(statusRef.current) && statusRef.current !== "completed") {
                        connect();
                    }
                }, 10_000);
            };
        };

        connect();
        return () => {
            disposed = true;
            source?.close();
            if (reconnect) clearTimeout(reconnect);
        };
    }, [mode, jobId, buildStatus, queryClient]);

    /*
     * Forge → Builder, in place. Both conditions are required: an app id alone
     * can arrive mid-run while the container is still being built, and promoting
     * then would hand the author a Builder pointed at an app that cannot serve a
     * preview yet.
     */
    useEffect(() => {
        if (mode === "forge" && buildStatus === "completed" && resolvedAppId) {
            setMode("builder");
        }
    }, [mode, buildStatus, resolvedAppId]);

    /* ── Builder app record ───────────────────────────────────────────────── */

    const { data: installed, isLoading: isLoadingApps } = useQuery<InstalledRow[]>({
        queryKey: ["/api/apps/installed"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/apps/installed");
            if (!res.ok) throw new Error("Failed to load installed apps");
            return res.json();
        },
        enabled: mode === "builder",
    });

    const row = useMemo(
        () => (resolvedAppId ? installed?.find((r) => r.app?.id === resolvedAppId) : installed?.[0]) ?? null,
        [installed, resolvedAppId],
    );

    const onAppUpdated = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/apps/installed"] });
        queryClient.invalidateQueries({ queryKey: ["/api/apps/fleet"] });
    }, [queryClient]);

    const displayName = row?.app?.name ?? appName ?? title;
    const openHref = row?.deployment?.publicSlug
        ? `/app/${row.deployment.publicSlug}`
        : publicSlug
          ? `/app/${publicSlug}`
          : null;
    const liveStatus = row?.deployment?.status ?? status ?? null;
    const visibleChanges = changes.filter(change => change.appId === row?.app.id);

    return (
        <div
            className={cn(
                "flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-border bg-card",
                className,
            )}
            data-testid="app-studio-pod"
            data-mode={mode}
        >
            {/* ── Compact header ──────────────────────────────────────────── */}
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    {mode === "forge" ? (
                        <Hammer className="h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                        <Blocks className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span className="truncate text-sm font-semibold" title={displayName}>
                        {displayName}
                    </span>
                    <Badge variant={mode === "forge" ? "secondary" : "default"} className="shrink-0 text-[10px] uppercase" data-testid="app-studio-mode">
                        {mode}
                    </Badge>
                    {liveStatus && (
                        <Badge variant="outline" className="shrink-0 text-[10px]" data-testid="app-studio-status">
                            {liveStatus}
                        </Badge>
                    )}
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-1">
                    {openHref && (
                        <Button asChild variant="ghost" size="sm" data-testid="app-studio-open">
                            <a href={openHref} target="_blank" rel="noreferrer">
                                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                Open App
                            </a>
                        </Button>
                    )}
                    {mode === "forge" && jobId && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleResetBuild}
                            className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                            title="Start a new build"
                            data-testid="forge-header-reset-build"
                        >
                            <RotateCcw className="h-3 w-3" />
                            <span>New Build</span>
                        </Button>
                    )}
                    {onToggleFocusMode && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onToggleFocusMode}
                            title={isFocusMode ? "Show the conversation" : "Focus the studio"}
                            data-testid="app-studio-focus"
                        >
                            {isFocusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        </Button>
                    )}
                    {onClose && (
                        <Button variant="ghost" size="sm" onClick={onClose} title="Close studio" data-testid="app-studio-close">
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </header>

            {/* ── Body ────────────────────────────────────────────────────── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {mode === "forge" ? (
                    <ForgeProgress
                        jobId={jobId ?? null}
                        heading={forgeStageHeading(stageIndex)}
                        description={stage?.description ?? null}
                        stageIndex={stageIndex}
                        percent={percent}
                        buildStatus={buildStatus}
                        buildError={buildError}
                        studio={studio}
                        requirements={requirements ?? null}
                        previewUrl={studio.slug ? `/forged/${studio.slug}` : null}
                        initialTab={view === "api" ? "api" : view === "diagnostics" ? "diagnostics" : "preview"}
                        selectedBlueprint={selectedBlueprint}
                        onSelectBlueprint={setSelectedBlueprint}
                        appName={customAppName}
                        onAppNameChange={setCustomAppName}
                        appSlug={customSlug}
                        onAppSlugChange={setCustomSlug}
                        appRequirements={customRequirements}
                        onRequirementsChange={setCustomRequirements}
                        apiInstructions={apiInstructions}
                        onApiInstructionsChange={setApiInstructions}
                        scaffoldPacks={selectedScaffoldPacks}
                        onToggleScaffoldPack={(id) => {
                            setSelectedScaffoldPacks((prev) =>
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                            );
                        }}
                        walkthroughStep={walkthroughStep}
                        onWalkthroughStepChange={setWalkthroughStep}
                        forgeView={forgeView}
                        onForgeViewChange={setForgeView}
                        onStartBuild={handleStartBuild}
                        onResetBuild={handleResetBuild}
                        isStartingBuild={isStartingBuild}
                    />
                ) : isLoadingApps ? (
                    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading the application…
                    </div>
                ) : row ? (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-initial-view={view}>
                        {lastChange && <ChangeBanner change={lastChange} />}
                        {visibleChanges.length > 0 && <details className="shrink-0 border-b px-3 py-2" data-testid="app-studio-history">
                            <summary className="cursor-pointer text-sm font-medium">Change history ({visibleChanges.length})</summary>
                            <p className="mt-1 text-xs text-muted-foreground">Changes recorded in this conversation. Discuss an older change before attempting to undo it.</p>
                            <ol className="mt-2 max-h-56 space-y-2 overflow-auto">
                                {visibleChanges.map(change => <li key={change.id} className="rounded border p-2 text-sm">
                                    <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{change.status.replace(/_/g, " ")}</Badge>
                                        {change.filesWritten !== undefined && <span>{change.filesWritten} files</span>}
                                    </div>
                                    {change.instruction && <p className="mt-1 break-words font-medium">{change.instruction}</p>}
                                    <p className="break-words">{change.summary}</p>
                                    <div className="mt-1 flex flex-wrap gap-2">
                                        {change.turnId !== undefined && onShowTurn && <Button type="button" variant="ghost" size="sm" onClick={() => onShowTurn(change.turnId!)}>Show conversation</Button>}
                                        {onFocusInChat && <Button type="button" variant="ghost" size="sm" onClick={() => onFocusInChat({ appId: row.app.id, appName: row.app.name, kind: "change", label: change.summary, changeId: change.id })}>Discuss change</Button>}
                                    </div>
                                </li>)}
                            </ol>
                        </details>}
                        {/*
                          * Keyed on the dispatch, so a change applied from the
                          * conversation reloads the workspace it just rewrote.
                          * Without this the file tree and preview keep serving
                          * the state from before the edit.
                          */}
                        <AppInteractiveBuilderTab
                            key={lastChange?.status === "applying" ? "applying" : (lastChange?.appliedAt ?? "initial")}
                            appId={row.app.id}
                            app={row.app as any}
                            onAppUpdated={onAppUpdated}
                            initialView={view}
                            onFocusInChat={onFocusInChat ? selection => onFocusInChat({ ...selection, appId: row.app.id, appName: row.app.name, changeId: lastChange?.appliedAt }) : undefined}
                        />
                    </div>
                ) : (
                    /*
                     * Say which app could not be opened. "No app selected" sends
                     * the author back to the room to guess; naming the id they
                     * asked for tells them whether the mount or the app is wrong.
                     */
                    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                        {resolvedAppId
                            ? `App #${resolvedAppId}${appSlug ? ` (${appSlug})` : ""} is not installed in this organization.`
                            : "No application was resolved for this studio."}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Outcome of the change the room just applied.
 *
 * Four outcomes, shown as four different things. "Applied to 3 files" and
 * "nothing matched that request" are both successes as far as the builder
 * service is concerned, and rendering them identically is how an author comes
 * away believing an edit landed when no file was touched.
 */
function ChangeBanner({ change }: { change: AppStudioChange }) {
    const tone =
        change.status === "applying"
            ? "border-border bg-muted/40 text-muted-foreground"
            : change.status === "applied" || change.status === "reverted"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : change.status === "build_failed" || change.status === "failed"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted/40 text-muted-foreground";

    return (
        <div
            className={cn("shrink-0 border-b px-3 py-2 text-xs", tone)}
            data-testid="app-studio-change"
            aria-live="polite"
            aria-busy={change.status === "applying"}
            data-status={change.status}
        >
            {change.status === "applying" && (
                <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin align-[-2px]" />
            )}
            <span className="font-medium">{change.summary}</span>
            {change.canRevert && (
                <span className="ml-1 opacity-80">Say &ldquo;undo that&rdquo; to put it back.</span>
            )}
        </div>
    );
}

function ForgeProgress({
    jobId,
    heading,
    description,
    stageIndex,
    percent,
    buildStatus,
    buildError,
    studio,
    requirements,
    previewUrl,
    initialTab,
    selectedBlueprint,
    onSelectBlueprint,
    appName,
    onAppNameChange,
    appSlug,
    onAppSlugChange,
    appRequirements,
    onRequirementsChange,
    apiInstructions,
    onApiInstructionsChange,
    scaffoldPacks,
    onToggleScaffoldPack,
    walkthroughStep,
    onWalkthroughStepChange,
    forgeView,
    onForgeViewChange,
    onStartBuild,
    onResetBuild,
    isStartingBuild,
}: {
    jobId: string | null;
    heading: string;
    description: string | null;
    stageIndex: number | null;
    percent: number;
    buildStatus: string;
    buildError: string | null;
    studio: ForgeStudioState;
    requirements: string | null;
    previewUrl?: string | null;
    initialTab: ForgeTabId;
    selectedBlueprint: string;
    onSelectBlueprint: (slug: string) => void;
    appName: string;
    onAppNameChange: (name: string) => void;
    appSlug: string;
    onAppSlugChange: (slug: string) => void;
    appRequirements: string;
    onRequirementsChange: (req: string) => void;
    apiInstructions: string;
    onApiInstructionsChange: (api: string) => void;
    scaffoldPacks: string[];
    onToggleScaffoldPack: (id: string) => void;
    walkthroughStep: "architecture" | "specs" | "review";
    onWalkthroughStepChange: (step: "architecture" | "specs" | "review") => void;
    forgeView: "walkthrough" | "live-build";
    onForgeViewChange: (view: "walkthrough" | "live-build") => void;
    onStartBuild?: () => void;
    onResetBuild?: () => void;
    isStartingBuild?: boolean;
}) {
    const failed = TERMINAL_FAILURE.has(buildStatus);
    const activeArchetype = ARCHITECTURE_ARCHETYPES.find((a) => a.slug === selectedBlueprint) || ARCHITECTURE_ARCHETYPES[0];
    const suggestions = ARCHETYPE_PROMPT_SUGGESTIONS[selectedBlueprint] || [];
    const effectiveSlug = appSlug || (appName || "new-app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-app";

    return (
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
            {/* View Switcher Subheader */}
            <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5 bg-muted/20 text-xs shrink-0">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onForgeViewChange("walkthrough")}
                        className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer",
                            forgeView === "walkthrough"
                                ? "bg-background text-foreground shadow-sm border border-border/60"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                        data-testid="forge-view-walkthrough"
                    >
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        <span>Architecture & Specs</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onForgeViewChange("live-build")}
                        className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer",
                            forgeView === "live-build"
                                ? "bg-background text-foreground shadow-sm border border-border/60"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                        data-testid="forge-view-live-build"
                    >
                        <Rocket className="h-3.5 w-3.5 text-amber-500" />
                        <span>Live Assembly & Preview</span>
                        {percent > 0 && (
                            <Badge variant="outline" className="ml-1 h-4 text-[9px] px-1 font-mono">
                                {percent}%
                            </Badge>
                        )}
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {jobId && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                onResetBuild?.();
                                onForgeViewChange("walkthrough");
                                onWalkthroughStepChange("architecture");
                            }}
                            className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground px-2"
                            data-testid="forge-header-reset-build"
                        >
                            <RotateCcw className="h-3 w-3" />
                            <span>New Build</span>
                        </Button>
                    )}
                </div>
            </div>

            {forgeView === "walkthrough" ? (
                /* ── Walkthrough Surface ────────────────────────────────────────── */
                <div className="flex flex-1 flex-col overflow-hidden">
                    {/* Stepper Navigation */}
                    <div className="flex items-center justify-center gap-2 border-b border-border/30 py-2 px-4 bg-muted/10 shrink-0">
                        <button
                            type="button"
                            onClick={() => onWalkthroughStepChange("architecture")}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer",
                                walkthroughStep === "architecture"
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground bg-muted/30"
                            )}
                        >
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px]">1</span>
                            <span>Architecture & Steps</span>
                        </button>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                        <button
                            type="button"
                            onClick={() => onWalkthroughStepChange("specs")}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer",
                                walkthroughStep === "specs"
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground bg-muted/30"
                            )}
                        >
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px]">2</span>
                            <span>Specs & Requirements</span>
                        </button>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                        <button
                            type="button"
                            onClick={() => onWalkthroughStepChange("review")}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer",
                                walkthroughStep === "review"
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground bg-muted/30"
                            )}
                        >
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px]">3</span>
                            <span>Pre-Flight & Ignition</span>
                        </button>
                    </div>

                    {/* Step 1: Target Architecture Selection */}
                    {walkthroughStep === "architecture" && (
                        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/40 pb-3">
                                <div>
                                    <h3 className="text-base font-semibold">Forge Studio Launchpad</h3>
                                    <p className="text-xs text-muted-foreground">
                                        Select an architectural archetype to seed the container scaffolding, layout geometry, and agent workflows.
                                    </p>
                                </div>
                                <Badge variant="outline" className="text-xs font-medium border-primary/40 text-primary self-start">
                                    {activeArchetype.name}
                                </Badge>
                            </div>

                            {requirements && (
                                <div className="w-full rounded-lg border border-border/60 bg-muted/30 p-2.5 text-left text-xs">
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Specifications</div>
                                    <p className="mt-0.5 text-foreground/90 font-mono line-clamp-2">{requirements}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="forge-archetype-selection">
                                {ARCHITECTURE_ARCHETYPES.map((archetype) => {
                                    const isSelected = selectedBlueprint === archetype.slug;
                                    const Icon = archetype.icon;
                                    return (
                                        <button
                                            key={archetype.slug}
                                            type="button"
                                            onClick={() => onSelectBlueprint(archetype.slug)}
                                            data-testid={`archetype-${archetype.slug}`}
                                            className={cn(
                                                "flex flex-col items-start p-3.5 rounded-xl border text-left transition-all relative group cursor-pointer",
                                                isSelected
                                                    ? "border-primary bg-primary/10 shadow-md ring-1 ring-primary"
                                                    : "border-border/60 bg-card hover:bg-muted/40 hover:border-border"
                                            )}
                                        >
                                            <div className="flex items-center justify-between w-full mb-2">
                                                <div
                                                    className={cn(
                                                        "p-1.5 rounded-lg",
                                                        isSelected
                                                            ? "bg-primary text-primary-foreground"
                                                            : "bg-muted text-muted-foreground group-hover:text-foreground"
                                                    )}
                                                >
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {archetype.complexity && (
                                                        <span className={cn(
                                                            "text-[9px] px-1.5 py-0.5 rounded font-mono font-medium",
                                                            archetype.complexity === "Simple" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" :
                                                            archetype.complexity === "Medium" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20" :
                                                            "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                                                        )}>
                                                            {archetype.complexity} · {archetype.estimatedTime}
                                                        </span>
                                                    )}
                                                    {isSelected ? (
                                                        <CheckCircle2 className="h-4 w-4 text-primary" />
                                                    ) : (
                                                        <span className="text-[10px] text-muted-foreground font-mono">{archetype.category}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="text-sm font-semibold leading-tight text-foreground">
                                                {archetype.name}
                                            </span>
                                            <span className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-snug">
                                                {archetype.description}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Pipeline Assembly Roadmap */}
                            <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                                        <span>7-Stage Assembly Pipeline Roadmap</span>
                                    </span>
                                    <span className="text-[10px] text-muted-foreground font-mono">Ignites after Pre-Flight</span>
                                </div>
                                <div className="flex items-center gap-1 overflow-x-auto py-1 text-[11px]">
                                    {FORGE_STAGES.map((stg, idx) => (
                                        <div key={stg.key} className="flex items-center gap-1 shrink-0">
                                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary">
                                                {idx + 1}
                                            </span>
                                            <span className="font-medium text-foreground/80">{stg.label}</span>
                                            {idx < FORGE_STAGES.length - 1 && (
                                                <ChevronRight className="h-3 w-3 text-muted-foreground/40 mx-0.5" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-end pt-4 border-t border-border/40 mt-auto">
                                <Button
                                    type="button"
                                    onClick={() => onWalkthroughStepChange("specs")}
                                    className="gap-2 text-xs font-semibold"
                                    data-testid="forge-continue-to-specs"
                                >
                                    <span>Continue to Specs & Requirements</span>
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Specs & Requirements */}
                    {walkthroughStep === "specs" && (
                        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6 max-w-3xl mx-auto w-full">
                            <div className="border-b border-border/40 pb-3">
                                <h3 className="text-base font-semibold">Phase II: Logic & Specifications Walkthrough</h3>
                                <p className="text-xs text-muted-foreground">
                                    Configure application parameters, user stories, API endpoints, and scaffold runtime capabilities.
                                </p>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">App Name</label>
                                        <Input
                                            value={appName}
                                            onChange={(e) => onAppNameChange(e.target.value)}
                                            placeholder="e.g. Finance Intelligence Bot"
                                            className="text-xs font-medium"
                                            data-testid="forge-input-app-name"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">URL Slug</label>
                                        <Input
                                            value={appSlug}
                                            onChange={(e) => onAppSlugChange(e.target.value)}
                                            placeholder={effectiveSlug}
                                            className="text-xs font-mono"
                                            data-testid="forge-input-app-slug"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Specifications & User Stories</label>
                                        <span className="text-[10px] text-muted-foreground font-mono">{appRequirements.length} chars</span>
                                    </div>
                                    <Textarea
                                        rows={4}
                                        value={appRequirements}
                                        onChange={(e) => onRequirementsChange(e.target.value)}
                                        placeholder="Describe the application features, user interactions, key metrics, and workflows..."
                                        className="text-xs resize-none"
                                        data-testid="forge-textarea-requirements"
                                    />

                                    {/* Suggested prompt chips */}
                                    {suggestions.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                            <span className="text-[10px] font-semibold text-primary uppercase">Suggestions:</span>
                                            {suggestions.map((sug) => (
                                                <button
                                                    key={sug}
                                                    type="button"
                                                    onClick={() => {
                                                        const cleanSug = sug.replace(/^\+\s*/, "");
                                                        onRequirementsChange(appRequirements ? `${appRequirements}, ${cleanSug}` : cleanSug);
                                                    }}
                                                    className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 hover:bg-primary/10 hover:border-primary/40 text-foreground transition-colors cursor-pointer"
                                                >
                                                    {sug}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Progressive Disclosure: Advanced Architecture & Runtime Settings */}
                                <details className="group rounded-xl border border-border/60 bg-muted/10 p-3 transition-all" data-testid="forge-advanced-settings">
                                    <summary className="flex items-center justify-between cursor-pointer list-none text-xs font-semibold text-foreground select-none">
                                        <div className="flex items-center gap-2">
                                            <CircuitBoard className="h-4 w-4 text-cyan-500" />
                                            <span>Advanced Architecture & Runtime Settings</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full border border-border/40">
                                                {scaffoldPacks.length} packs active{apiInstructions ? " · API proxy" : ""}
                                            </span>
                                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                                        </div>
                                    </summary>

                                    <div className="mt-4 space-y-4 pt-3 border-t border-border/30">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                <Zap className="h-3.5 w-3.5 text-amber-500" />
                                                <span>API Endpoints & Integration Specs (Optional)</span>
                                            </label>
                                            <Textarea
                                                rows={3}
                                                value={apiInstructions}
                                                onChange={(e) => onApiInstructionsChange(e.target.value)}
                                                placeholder="Paste external REST APIs, endpoints, or data services (e.g. POST /api/weather, GET /api/v1/metrics)..."
                                                className="text-xs font-mono resize-none"
                                                data-testid="forge-textarea-api"
                                            />
                                            <p className="text-[10px] text-muted-foreground">External APIs will be wired as server-side proxies in the Express container.</p>
                                        </div>

                                        <div className="space-y-2 pt-2 border-t border-border/30">
                                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                <CircuitBoard className="h-3.5 w-3.5 text-cyan-400" />
                                                <span>SAT Assembly & Scaffold Capabilities</span>
                                            </label>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {SCAFFOLD_PACKS.map((pack) => {
                                                    const isSelected = scaffoldPacks.includes(pack.id);
                                                    return (
                                                        <button
                                                            key={pack.id}
                                                            type="button"
                                                            onClick={() => onToggleScaffoldPack(pack.id)}
                                                            className={cn(
                                                                "flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-all cursor-pointer",
                                                                isSelected
                                                                    ? "border-primary/60 bg-primary/5 ring-1 ring-primary/40"
                                                                    : "border-border/60 bg-card hover:bg-muted/30"
                                                            )}
                                                        >
                                                            <div className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                                                                {isSelected && <Check className="h-3 w-3" />}
                                                            </div>
                                                            <div>
                                                                <div className="text-xs font-semibold text-foreground">{pack.name}</div>
                                                                <div className="text-[10px] text-muted-foreground">{pack.description}</div>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </details>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-border/40 mt-auto">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => onWalkthroughStepChange("architecture")}
                                    className="gap-2 text-xs font-semibold"
                                >
                                    <ArrowLeft className="h-3.5 w-3.5" />
                                    <span>Back to Architecture & Steps</span>
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => onWalkthroughStepChange("review")}
                                    className="gap-2 text-xs font-semibold"
                                >
                                    <span>Continue to Pre-Flight & Ignition</span>
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Review & Pre-Flight Check */}
                    {walkthroughStep === "review" && (
                        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
                            <div className="border-b border-border/40 pb-3">
                                <h3 className="text-base font-semibold">Phase III: Pre-Flight Review & Assembly Ignition</h3>
                                <p className="text-xs text-muted-foreground">
                                    Review the architectural specifications before the AI Architect generates code and mounts the container.
                                </p>
                            </div>

                            <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3.5 shadow-sm">
                                <div className="flex items-center justify-between border-b border-border/40 pb-3">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                            {React.createElement(activeArchetype.icon, { className: "h-4 w-4" })}
                                        </div>
                                        <div>
                                            <div className="text-sm font-semibold">{appName || "New Application"}</div>
                                            <div className="text-[11px] text-muted-foreground font-mono">/forged/{effectiveSlug}</div>
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="border-primary/40 text-primary text-xs">
                                        {activeArchetype.name}
                                    </Badge>
                                </div>

                                <div className="space-y-1">
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Specifications & User Stories</div>
                                    <p className="text-xs text-foreground/90 font-mono bg-muted/30 p-2.5 rounded-md line-clamp-4">
                                        {appRequirements || "Standard enterprise application composition with responsive layout and telemetry."}
                                    </p>
                                </div>

                                <div className="space-y-1">
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active Capabilities & Scaffold Packs</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {scaffoldPacks.map((packId) => {
                                            const p = SCAFFOLD_PACKS.find((x) => x.id === packId);
                                            return (
                                                <Badge key={packId} variant="secondary" className="text-[10px] font-medium">
                                                    <Check className="h-3 w-3 mr-1 text-emerald-500" />
                                                    {p?.name || packId}
                                                </Badge>
                                            );
                                        })}
                                    </div>
                                </div>

                                {apiInstructions && (
                                    <div className="space-y-1">
                                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custom API Integrations</div>
                                        <p className="text-xs text-foreground/90 font-mono bg-muted/30 p-2 rounded-md truncate">
                                            {apiInstructions}
                                        </p>
                                    </div>
                                )}

                                {/*
                                  A "Cost & Resource Transparency" pill sat here reading
                                  "Estimated Run Spend: ~$0.18" and "Soft-Cap: $2.50 · SMT
                                  Verified". All three were string literals — no cost, cap or
                                  verification data reaches this component. Removed: a figure
                                  labelled transparency that is not measured is the opposite of
                                  transparency. Restore it when the forge reports real spend.
                                */}

                                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
                                    <Sparkles className="h-4 w-4 text-primary shrink-0" />
                                    <span>The Backend Architect agent will lead stage execution through Discovery, Strategy, Architecture, Assembly, Hardening, Industrialization, and Ignition.</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-border/40 mt-auto">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => onWalkthroughStepChange("specs")}
                                    className="gap-2 text-xs font-semibold"
                                >
                                    <ArrowLeft className="h-3.5 w-3.5" />
                                    <span>Back to Specs & Requirements</span>
                                </Button>
                                <Button
                                    type="button"
                                    onClick={onStartBuild}
                                    disabled={isStartingBuild}
                                    className="gap-2 text-xs font-semibold shadow-md bg-primary text-primary-foreground"
                                    data-testid="forge-start-build"
                                >
                                    {isStartingBuild ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <span>Provisioning & Igniting…</span>
                                        </>
                                    ) : (
                                        <>
                                            <Hammer className="h-4 w-4" />
                                            <span>Build & Ignite Application</span>
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* ── Live Build & Assembly View ──────────────────────────────────── */
                <div
                    className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
                    data-testid="forge-progress"
                    aria-live="polite"
                    aria-busy={buildStatus !== "completed" && !failed}
                >
                    {/* Stage Subway Spine */}
                    <div className="flex items-center gap-1 overflow-x-auto py-1 px-1 rounded-lg bg-muted/20 border border-border/40 shrink-0">
                        {FORGE_STAGES.map((stg) => {
                            const isDone = typeof stageIndex === "number" ? stageIndex > stg.index || buildStatus === "completed" : buildStatus === "completed";
                            const isCurrent = stageIndex === stg.index && buildStatus !== "completed" && !failed;
                            return (
                                <div
                                    key={stg.key}
                                    className={cn(
                                        "flex items-center gap-1.5 px-2 py-1 rounded text-xs shrink-0 transition-all",
                                        isCurrent
                                            ? "bg-primary/15 text-primary font-semibold border border-primary/30"
                                            : isDone
                                            ? "text-emerald-500 font-medium"
                                            : "text-muted-foreground/60",
                                    )}
                                >
                                    {isDone ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                    ) : isCurrent ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                                    ) : (
                                        <Circle className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                    )}
                                    <span className="text-[11px] whitespace-nowrap">{stg.label}</span>
                                    {stg.index < FORGE_STAGE_COUNT - 1 && (
                                        <ChevronRight className="h-3 w-3 text-muted-foreground/30 ml-1 shrink-0" />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold" data-testid="forge-progress-heading">
                                {failed ? "Build failed" : heading}
                            </span>
                            <div className="flex items-center gap-2">
                                {/*
                                  A "Spend: ~$0.14 · 1.4k tokens" chip sat here, labelled live
                                  and hardcoded. Same reason as the pill above.
                                */}
                                <button
                                    type="button"
                                    onClick={() => {
                                        onForgeViewChange("walkthrough");
                                        onWalkthroughStepChange("specs");
                                    }}
                                    className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                                >
                                    Review Specs
                                </button>
                                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                    {percent}%
                                </span>
                            </div>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                                className={cn(
                                    "h-full transition-all duration-300",
                                    failed ? "bg-destructive" : "bg-primary",
                                )}
                                style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
                            />
                        </div>
                        {description && (
                            <p className="text-xs text-muted-foreground" data-testid="forge-stage-description">
                                {description}
                            </p>
                        )}
                        {(failed || buildError) && (
                            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs space-y-2.5" role="alert" data-testid="forge-build-error">
                                <div className="flex items-start gap-2.5">
                                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                        <span className="font-semibold text-destructive block">Build Interrupted</span>
                                        <p className="text-xs text-foreground/90 font-mono mt-0.5 break-words">
                                            {buildError || "Container assembly or SMT verification check failed during ignition."}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-destructive/20">
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-7 text-xs px-2.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold"
                                        onClick={() => onStartBuild && onStartBuild()}
                                        disabled={isStartingBuild}
                                    >
                                        <RotateCcw className="h-3 w-3 mr-1" />
                                        <span>1-Click Auto-Rescue & Retry</span>
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs px-2.5"
                                        onClick={() => {
                                            onForgeViewChange("walkthrough");
                                            onWalkthroughStepChange("specs");
                                        }}
                                    >
                                        Edit Requirements
                                    </Button>
                                </div>
                            </div>
                        )}
                        {studio.approval && !buildError && (
                            <p
                                className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
                                data-testid="forge-approval-required"
                            >
                                Waiting for your decision: {studio.approval.message}
                            </p>
                        )}
                        {studio.status && !buildError && (
                            <p
                                className={cn(
                                    "rounded-md border border-border bg-muted/40 p-2 text-xs",
                                    studio.statusLevel === "warn" && "text-amber-600 dark:text-amber-400",
                                    studio.statusLevel === "success" && "text-emerald-600 dark:text-emerald-400",
                                )}
                                data-testid="forge-latest-event"
                            >
                                {studio.status}
                            </p>
                        )}
                    </div>

                    {/* What the run has produced so far */}
                    {(studio.components.length > 0 || studio.files.length > 0) && (
                        <p className="text-[11px] text-muted-foreground" data-testid="forge-artifact-counts">
                            {studio.components.length > 0 && `${studio.components.length} gallery component${studio.components.length === 1 ? "" : "s"}`}
                            {studio.components.length > 0 && studio.files.length > 0 && " · "}
                            {studio.files.length > 0 && `${studio.files.length} file${studio.files.length === 1 ? "" : "s"}`}
                            {studio.apiContract ? " · API contract" : ""}
                        </p>
                    )}

                    {buildStatus === "completed" && (
                        <p className="text-xs text-muted-foreground">
                            Build complete — opening the Builder.
                        </p>
                    )}

                    {/* Forge Artifacts & Preview tabs */}
                    <div className="-mx-4 mt-1 flex min-h-[16rem] flex-1 flex-col border-t border-border">
                        <ForgeArtifactTabs
                            studio={studio}
                            previewUrl={previewUrl}
                            initialTab={initialTab}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
