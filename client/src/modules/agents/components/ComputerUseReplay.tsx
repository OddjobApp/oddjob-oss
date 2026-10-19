import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Monitor, CheckCircle2, XCircle, Clock, AlertTriangle, Eye } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TaskStep {
    id: string;
    stepNumber: number;
    phase: string;
    status: string;
    decision?: string;
    action?: string;
    observation: Record<string, unknown>;
    plan: Record<string, unknown>;
    result: Record<string, unknown>;
    error?: string;
    createdAt: string;
}

interface ComputerUseTask {
    id: string;
    task: string;
    status: string;
    stepCount: number;
    maxSteps: number;
    requireConfirmation: boolean;
    result: Record<string, unknown>;
    error?: string;
    createdAt: string;
    completedAt?: string;
}

interface ReplayData {
    task: ComputerUseTask;
    steps: TaskStep[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: string) {
    if (status === "succeeded") return "text-emerald-400";
    if (status === "failed" || status === "blocked") return "text-red-400";
    if (status === "needs_confirmation") return "text-yellow-400";
    if (status === "running") return "text-blue-400";
    return "text-muted-foreground";
}

function statusIcon(status: string) {
    if (status === "succeeded") return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    if (status === "failed" || status === "blocked") return <XCircle className="w-4 h-4 text-red-400" />;
    if (status === "needs_confirmation") return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    if (status === "running") return <Clock className="w-4 h-4 text-blue-400 animate-spin" />;
    return <Eye className="w-4 h-4 text-muted-foreground" />;
}

function phaseLabel(phase: string) {
    const labels: Record<string, string> = {
        plan: "Plan",
        action: "Execute",
        confirmation_execution: "Confirmed Exec",
        cancel: "Cancelled",
        loop_error: "Error",
        observation: "Observe",
    };
    return labels[phase] ?? phase;
}

// ── Step Detail ───────────────────────────────────────────────────────────────

function StepDetail({ step }: { step: TaskStep }) {
    const obs = step.observation as any;
    const plan = step.plan as any;
    const result = step.result as any;
    const screenshot = obs?.screenshot?.dataUrl as string | undefined;
    const grounding = plan?.grounding as any | undefined;
    const accessibility = obs?.accessibility as any | undefined;
    const riskFlags = Array.isArray(plan?.riskFlags) ? plan.riskFlags : [];

    return (
        <div className="space-y-4 p-4 bg-black/30 rounded-xl border border-white/5">
            <div className="flex items-center gap-3">
                {statusIcon(step.status)}
                <span className="text-foreground font-semibold">Step {step.stepNumber} - {phaseLabel(step.phase)}</span>
                <Badge variant="outline" className="text-muted-foreground border-white/20 text-xs">{step.action ?? "no action"}</Badge>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(step.createdAt).toLocaleTimeString()}</span>
            </div>

            {plan?.rationale && (
                <div className="text-sm text-foreground">
                    <span className="text-purple-400 font-medium">Rationale: </span>
                    {plan.rationale}
                </div>
            )}

            {step.error && (
                <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20">
                    {step.error}
                </div>
            )}

            {plan?.proposedAction && (
                <div className="text-xs text-muted-foreground font-mono bg-black/40 p-2 rounded">
                    {JSON.stringify(plan.proposedAction, null, 2)}
                </div>
            )}

            {grounding && (
                <div className={`rounded-lg border p-3 text-xs ${
                    grounding.resolved
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                        : "border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-200"
                }`}>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                            {grounding.resolved ? "Grounded target" : "Ungrounded target"}
                        </span>
                        <Badge variant="outline" className="border-current text-current">
                            {grounding.method ?? "none"} {Math.round((grounding.confidence ?? 0) * 100)}%
                        </Badge>
                        {grounding.target?.label && <span className="opacity-80">{grounding.target.label}</span>}
                    </div>
                    {grounding.rationale && <p className="mt-1 opacity-80">{grounding.rationale}</p>}
                </div>
            )}

            {accessibility && (
                <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline" className={accessibility.available ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-yellow-500/30 text-yellow-700 dark:text-yellow-300"}>
                        AX {accessibility.available ? `${accessibility.source} - ${accessibility.nodes?.length ?? 0} nodes` : "unavailable"}
                    </Badge>
                    {obs?.ui?.source && (
                        <Badge variant="outline" className="border-sky-500/30 text-sky-700 dark:text-sky-300">
                            {obs.ui.source} observation
                        </Badge>
                    )}
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

            {screenshot && (
                <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Screen State</p>
                    <img
                        src={screenshot}
                        alt={`Step ${step.stepNumber} screenshot`}
                        className="rounded border border-white/10 max-h-64 w-auto object-contain"
                    />
                </div>
            )}

            {obs?.ui?.visibleText?.length > 0 && (
                <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Visible Text</p>
                    <div className="text-xs text-foreground bg-black/40 p-2 rounded max-h-24 overflow-y-auto">
                        {(obs.ui.visibleText as string[]).join(" - ")}
                    </div>
                </div>
            )}

            {obs?.diff?.changed && (
                <div className="text-xs text-emerald-400 bg-emerald-500/10 p-2 rounded border border-emerald-500/20">
                    <span className="font-medium">What changed: </span>{obs.diff.summary}
                </div>
            )}

            {result?.actionResult && (
                <div className="text-xs text-muted-foreground font-mono bg-black/40 p-2 rounded overflow-x-auto max-h-20">
                    {JSON.stringify(result.actionResult)}
                </div>
            )}
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ComputerUseReplay({ taskId }: { taskId: string; organizationId?: number }) {
    const [currentStep, setCurrentStep] = useState(0);

    const { data, isLoading, error } = useQuery<ReplayData>({
        queryKey: [`/api/integrations/trycua/computer-use/tasks/${taskId}/replay`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/integrations/trycua/computer-use/tasks/${taskId}/replay`);
            return res.json();
        },
        refetchInterval: (query) => {
            return query.state.data?.task?.status === "running" ? 3000 : false;
        },
    });

    if (isLoading) return (
        <div className="flex items-center gap-2 text-muted-foreground p-4">
            <Clock className="w-4 h-4 animate-spin" />
            Loading replay...
        </div>
    );

    if (error || !data) return (
        <div className="text-red-400 p-4 text-sm">Failed to load replay data.</div>
    );

    const { task, steps } = data;
    const step = steps[currentStep];

    return (
        <Card className="border-white/10 bg-black/20 backdrop-blur-xl">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Monitor className="w-5 h-5 text-sky-400" />
                        Task Replay
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        {statusIcon(task.status)}
                        <span className={`text-sm font-medium ${statusColor(task.status)}`}>{task.status}</span>
                    </div>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{task.task}</p>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Step progress bar */}
                <div className="flex items-center gap-1 flex-wrap">
                    {steps.map((s, i) => (
                        <button
                            key={s.id}
                            onClick={() => setCurrentStep(i)}
                            title={`Step ${s.stepNumber}: ${phaseLabel(s.phase)}`}
                            className={`h-2 rounded-full transition-all ${i === currentStep ? "w-6 bg-purple-400" : "w-2"} ${
                                s.status === "succeeded" ? "bg-emerald-500" :
                                s.status === "failed" ? "bg-red-500" :
                                s.status === "needs_confirmation" ? "bg-yellow-500" : "bg-gray-600"
                            }`}
                        />
                    ))}
                    <span className="text-xs text-muted-foreground ml-2">{steps.length} / {task.maxSteps} steps</span>
                </div>

                {/* Navigation */}
                <div className="flex items-center gap-3">
                    <Button
                        size="sm" variant="outline"
                        onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                        disabled={currentStep === 0}
                        className="border-white/20 text-foreground"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm text-foreground">Step {currentStep + 1} of {steps.length}</span>
                    <Button
                        size="sm" variant="outline"
                        onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
                        disabled={currentStep >= steps.length - 1}
                        className="border-white/20 text-foreground"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                        size="sm" variant="ghost"
                        onClick={() => setCurrentStep(steps.length - 1)}
                        className="text-muted-foreground ml-auto"
                    >
                        Latest
                    </Button>
                </div>

                {/* Step detail */}
                {step ? <StepDetail step={step} /> : (
                    <div className="text-muted-foreground text-sm text-center py-6">No steps recorded yet.</div>
                )}

                {/* Final result */}
                {(task.status === "succeeded" || task.status === "failed" || task.status === "blocked") && (
                    <div className={`p-3 rounded-lg border text-sm ${
                        task.status === "succeeded"
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                            : "bg-red-500/10 border-red-500/20 text-red-400"
                    }`}>
                        <span className="font-medium">
                            {task.status === "succeeded" ? "Task completed successfully" : `Task ${task.status}`}
                        </span>
                        {task.error && <p className="mt-1 text-xs opacity-80">{task.error}</p>}
                        {task.completedAt && (
                            <p className="text-xs opacity-60 mt-1">
                                Completed {new Date(task.completedAt).toLocaleString()}
                            </p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
