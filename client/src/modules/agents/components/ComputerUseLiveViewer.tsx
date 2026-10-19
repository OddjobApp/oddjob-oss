import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Monitor, RefreshCcw, Play, Pause, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LiveSession {
    id: string;
    os: string;
    status: string;
    actionCount: number;
    provider: string;
    expiresAt: string;
}

interface PendingTask {
    task: {
        id: string;
        task: string;
        status: string;
        stepCount: number;
        result: Record<string, unknown>;
        error?: string;
    };
    steps: any[];
}

interface ObservationData {
    observation: {
        accessibility?: {
            available: boolean;
            source: string;
            nodes?: unknown[];
            error?: string;
        };
        ui?: {
            source: string;
            confidence: number;
            activeApp?: { name: string; confidence?: number };
            visibleText?: string[];
            clickableRegions?: Array<{ label?: string; bounds?: Record<string, number>; confidence?: number; evidence?: string[] }>;
            textInputs?: Array<{ label?: string; bounds?: Record<string, number>; confidence?: number; evidence?: string[] }>;
            warnings?: string[];
        };
        limitations?: string[];
    };
}

// ── Screenshot Panel ──────────────────────────────────────────────────────────

function ScreenshotPanel({
    sessionId,
    autoRefresh,
    terminated = false,
}: {
    sessionId: string;
    autoRefresh: boolean;
    /** A finished session has no screen. Asking for one only produces an error. */
    terminated?: boolean;
}) {
    const { data, error, isFetching: loading, refetch, dataUpdatedAt } = useQuery<{ screenshot: string }>({
        queryKey: [`/api/integrations/trycua/sessions/${sessionId}/screenshot`],
        queryFn: async ({ signal }) => (await apiRequest("GET", `/api/integrations/trycua/sessions/${sessionId}/screenshot`, undefined, undefined, signal)).json(),
        refetchInterval: autoRefresh ? 5000 : false,
        enabled: !terminated,
    });
    const screenshot = data?.screenshot;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Screen {dataUpdatedAt ? `· updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}</p>
                {!terminated && (
                    <Button size="sm" variant="ghost" aria-label="Refresh screenshot" onClick={() => refetch()} disabled={loading} className="text-muted-foreground h-6 px-2">
                        <RefreshCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                )}
            </div>
            {/* A terminated session having no screen is expected, not a failure. */}
            {error && !terminated && <p role="alert" className="text-xs text-destructive">Screen refresh failed. {screenshot ? "Showing the last captured image. " : ""}{error.message}</p>}
            {screenshot ? (
                <img
                    src={screenshot}
                    alt="Live screen view"
                    className="w-full rounded border border-border object-contain max-h-96"
                />
            ) : (
                <div className="w-full h-48 bg-muted rounded border border-border flex items-center justify-center text-muted-foreground text-sm">
                    {terminated ? "This session has ended, so there is no screen to show." : loading ? "Loading screen..." : "No screenshot available"}
                </div>
            )}
        </div>
    );
}

function ObservationQualityPanel({ observation, terminated = false }: { observation?: ObservationData["observation"]; terminated?: boolean }) {
    if (!observation) {
        return (
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground">
                {/* Nothing is loading for a session that has ended; it never arrives. */}
                {terminated ? "This session has ended. Start a new desktop to observe one." : "Observation intelligence is loading."}
            </div>
        );
    }

    const ui = observation.ui;
    const accessibility = observation.accessibility;
    const clickableCount = ui?.clickableRegions?.length ?? 0;
    const inputCount = ui?.textInputs?.length ?? 0;
    const visibleTextCount = ui?.visibleText?.length ?? 0;
    const axCount = accessibility?.nodes?.length ?? 0;

    return (
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-sky-500/30 text-sky-700 dark:text-sky-300">
                    {ui?.source ?? "unknown"} observation
                </Badge>
                <Badge variant="outline" className={accessibility?.available ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-yellow-500/30 text-yellow-700 dark:text-yellow-300"}>
                    AX {accessibility?.available ? `${accessibility.source} - ${axCount} nodes` : "unavailable"}
                </Badge>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-foreground/5 p-2">
                    <div className="text-sm font-semibold text-foreground">{clickableCount}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Targets</div>
                </div>
                <div className="rounded-lg bg-foreground/5 p-2">
                    <div className="text-sm font-semibold text-foreground">{inputCount}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Inputs</div>
                </div>
                <div className="rounded-lg bg-foreground/5 p-2">
                    <div className="text-sm font-semibold text-foreground">{visibleTextCount}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Text</div>
                </div>
            </div>

            {ui?.activeApp?.name && (
                <p className="text-xs text-muted-foreground">
                    Active app: <span className="text-foreground">{ui.activeApp.name}</span>
                </p>
            )}

            {(ui?.warnings?.length || observation.limitations?.length) ? (
                <div className="space-y-1">
                    {[...(ui?.warnings ?? []), ...(observation.limitations ?? [])].slice(0, 3).map((warning, index) => (
                        <div key={`${warning}-${index}`} className="flex gap-2 text-xs text-yellow-700 dark:text-yellow-300">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{warning}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// ── Confirmation Panel ────────────────────────────────────────────────────────

export function ConfirmationPanel({
    task,
    onConfirm,
}: {
    task: PendingTask;
    onConfirm: () => void;
}) {
    const [confirmText, setConfirmText] = useState("");
    const queryClient = useQueryClient();

    const confirmMutation = useMutation({
        mutationFn: async (allow: boolean) => {
            const res = await apiRequest("POST", `/api/integrations/trycua/computer-use/tasks/${task.task.id}/confirm`, {
                allow,
                text: confirmText || undefined,
                includeVerificationObservation: true,
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/integrations/trycua/computer-use/tasks/${task.task.id}/replay`] });
            onConfirm();
        },
    });

    const plan = (task.steps?.[task.steps.length - 1]?.plan as any) ?? {};
    const grounding = plan.grounding as any;
    const riskFlags = Array.isArray(plan.riskFlags) ? plan.riskFlags : [];
    const requiredReview = Array.isArray(plan.requiredReview) ? plan.requiredReview : [];
    const pending = task.task.result?.pending as { kind?: string; explanation?: string } | undefined;
    const isTakeover = pending?.kind === "yield";

    return (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-yellow-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-medium text-sm">{isTakeover ? "The agent needs your help" : "Action requires your approval"}</span>
            </div>

            <div className="text-sm text-foreground">{task.task.task}</div>
            {pending?.explanation && <p className="text-sm text-foreground">{pending.explanation}</p>}
            {isTakeover && <p className="text-xs text-muted-foreground">Complete the requested step in the desktop, then resume the agent.</p>}
            {confirmMutation.error && <p role="alert" className="text-sm text-destructive">{confirmMutation.error.message}</p>}

            {plan.proposedAction && (
                <div className="text-xs text-muted-foreground bg-black/40 p-2 rounded font-mono">
                    <span className="text-yellow-400">{plan.proposedAction.action}</span>
                    {" "}
                    {JSON.stringify(plan.proposedAction.params ?? {})}
                </div>
            )}

            {grounding && (
                <div className={`rounded-lg border p-3 text-xs ${
                    grounding.resolved
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                        : "border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-200"
                }`}>
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                            {grounding.resolved ? "Target grounded" : "Target needs grounding"}
                        </span>
                        <Badge variant="outline" className="border-current text-current">
                            {grounding.method ?? "none"} {Math.round((grounding.confidence ?? 0) * 100)}%
                        </Badge>
                    </div>
                    {grounding.rationale && <p className="mt-1 opacity-80">{grounding.rationale}</p>}
                </div>
            )}

            {plan.rationale && (
                <p className="text-xs text-muted-foreground italic">{plan.rationale}</p>
            )}

            {requiredReview.length > 0 && (
                <div className="rounded-lg border border-yellow-500/20 bg-black/30 p-2 text-xs text-yellow-100">
                    <div className="font-medium text-yellow-700 dark:text-yellow-300 mb-1">Review requirements</div>
                    <ul className="space-y-1">
                        {requiredReview.slice(0, 4).map((item: string, index: number) => (
                            <li key={`${item}-${index}`}>{item}</li>
                        ))}
                    </ul>
                </div>
            )}

            {riskFlags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {riskFlags.slice(0, 5).map((flag: any, index: number) => (
                        <Badge key={`${flag.code ?? "risk"}-${index}`} variant="outline" className="border-red-500/30 text-red-700 dark:text-red-300">
                            {flag.level ?? "risk"}: {flag.code ?? "policy"}
                        </Badge>
                    ))}
                </div>
            )}

            <Textarea
                value={confirmText}
                aria-label={isTakeover ? "Reply to the agent" : "Text for the approved action"}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={isTakeover ? "Optional: tell the agent what you completed…" : "Optional: override text to type..."}
                className="bg-black/40 border-white/10 text-foreground text-xs h-16 resize-none"
            />

            <div className="flex gap-2">
                <Button
                    size="sm"
                    onClick={() => confirmMutation.mutate(true)}
                    disabled={confirmMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-foreground flex-1"
                >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {confirmMutation.isPending ? "Sending…" : isTakeover ? "Done — resume agent" : "Approve"}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => confirmMutation.mutate(false)}
                    disabled={confirmMutation.isPending}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10 flex-1"
                >
                    <XCircle className="w-3 h-3 mr-1" />
                    {isTakeover ? "Cancel task" : "Reject"}
                </Button>
            </div>
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface ComputerUseLiveViewerProps {
    sessionId: string;
    organizationId?: number;
    activeTaskId?: string;
    /** Inside Computer Use Studio, whose dock shows the task and its approvals. */
    embedded?: boolean;
}

export function ComputerUseLiveViewer({ sessionId, activeTaskId, organizationId, embedded = false }: ComputerUseLiveViewerProps) {
    const queryClient = useQueryClient();
    const [autoRefresh, setAutoRefresh] = useState(true);

    const { data: sessionData, error: sessionError } = useQuery<{ session: LiveSession }>({
        queryKey: [`/api/integrations/trycua/sessions/${sessionId}`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/integrations/trycua/sessions/${sessionId}`);
            return res.json();
        },
        refetchInterval: 10_000,
    });

    const session = sessionData?.session;
    const isTerminated = session?.status === "terminated" || session?.status === "expired";
    const observationQueryKey = [`/api/integrations/trycua/sessions/${sessionId}/observe`];

    const { data: observationData } = useQuery<ObservationData>({
        queryKey: observationQueryKey,
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/integrations/trycua/sessions/${sessionId}/observe?includeScreenshot=false`);
            return res.json();
        },
        enabled: !!sessionId && !isTerminated,
        refetchInterval: autoRefresh && !isTerminated ? 10_000 : false,
    });

    const { data: taskData, error: taskError } = useQuery<PendingTask>({
        queryKey: [`/api/integrations/trycua/computer-use/tasks/${activeTaskId}/replay`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/integrations/trycua/computer-use/tasks/${activeTaskId}/replay`);
            return res.json();
        },
        enabled: !!activeTaskId,
        refetchInterval: 5000,
    });

    const terminateMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("DELETE", `/api/integrations/trycua/sessions/${sessionId}`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/integrations/trycua/sessions/${sessionId}`] });
        },
    });

    const task = taskData;
    const taskActive = !!task && ["queued", "running", "needs_confirmation"].includes(task.task.status);
    const cancelMutation = useMutation({
        mutationFn: async () => (await apiRequest("POST", `/api/integrations/trycua/computer-use/tasks/${activeTaskId}/cancel`, {})).json(),
        onSuccess: (data: PendingTask) => {
            queryClient.setQueryData([`/api/integrations/trycua/computer-use/tasks/${activeTaskId}/replay`], data);
            queryClient.invalidateQueries({ queryKey: ["/api/integrations/trycua", organizationId, "studio-tasks"] });
        },
    });
    const needsConfirmation = task?.task?.status === "needs_confirmation";
    const refreshObservation = () => {
        queryClient.invalidateQueries({ queryKey: observationQueryKey });
    };

    return (
        <Card className="min-w-0 border-border bg-card">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Monitor className="w-5 h-5 text-sky-400" />
                        Live Session
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        {session && (
                            <Badge variant="outline" className={`text-xs ${isTerminated ? "text-muted-foreground" : "text-emerald-400 border-emerald-500/30"}`}>
                                {session.status} - {session.os}
                            </Badge>
                        )}
                        <Button
                            size="sm" variant="ghost"
                            onClick={() => setAutoRefresh(v => !v)}
                            className={autoRefresh ? "text-blue-400" : "text-muted-foreground"}
                            title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
                            aria-label={autoRefresh ? "Pause screen refresh" : "Resume screen refresh"}
                        >
                            {autoRefresh ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </Button>
                        {!isTerminated && (
                            <Button
                                size="sm" variant="ghost"
                                onClick={() => terminateMutation.mutate()}
                                className="text-red-400 hover:text-red-700 dark:text-red-300"
                                title="Terminate session"
                                aria-label="Terminate session"
                                disabled={terminateMutation.isPending || taskActive}
                            >
                                <XCircle className="w-4 h-4" />
                            </Button>
                        )}
                    </div>
                </div>
                {session && (
                    <p className="text-xs text-muted-foreground">
                        {session.actionCount} actions - expires {new Date(session.expiresAt).toLocaleTimeString()}
                    </p>
                )}
            </CardHeader>

            <CardContent className="space-y-4">
                {(sessionError || taskError || cancelMutation.error || terminateMutation.error) && <p role="alert" className="text-sm text-destructive">{(sessionError || taskError || cancelMutation.error || terminateMutation.error)?.message}</p>}
                {task && !embedded && <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span role="status" className="text-sm font-medium">{task.task.status.replaceAll("_", " ")} · {task.task.stepCount} recorded steps</span>
                        {taskActive && <Button size="sm" variant="outline" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>{cancelMutation.isPending ? "Cancelling…" : "Cancel task"}</Button>}
                    </div>
                    <p className="text-sm">{task.task.task}</p>
                    {typeof task.task.result?.summary === "string" && <p className="text-sm text-muted-foreground">{task.task.result.summary}</p>}
                    {task.task.error && <p role="alert" className="text-sm text-destructive">{task.task.error}</p>}
                    {task.task.status === "needs_confirmation" && (task.task.result?.pending as { kind?: string } | undefined)?.kind === "yield" && <a className="inline-block text-sm text-primary underline" href={`/api/integrations/trycua/desktop/viewer${organizationId ? `?orgId=${organizationId}` : ""}`} target="_blank" rel="noopener noreferrer">Open desktop to take over</a>}
                </div>}
                <ScreenshotPanel
                    key={sessionId}
                    sessionId={sessionId}
                    autoRefresh={autoRefresh && !isTerminated}
                    terminated={isTerminated}
                />

                <ObservationQualityPanel observation={observationData?.observation} terminated={isTerminated} />

                {needsConfirmation && task && !embedded && (
                    <ConfirmationPanel
                        key={`${task.task.id}:${task.task.stepCount}`}
                        task={task}
                        onConfirm={() => {
                            queryClient.invalidateQueries({ queryKey: [`/api/integrations/trycua/computer-use/tasks/${activeTaskId}/replay`] });
                            refreshObservation();
                        }}
                    />
                )}

                {isTerminated && (
                    <div className="text-center text-muted-foreground text-sm py-4">
                        Session {session?.status}. Start a new session to continue.
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
