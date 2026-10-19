import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Play, ShieldAlert, Wrench } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import type { MissionReadinessRequest, MissionReadinessResponse } from "@shared/mission-readiness";

interface MissionReadinessLabProps {
    request: Omit<MissionReadinessRequest, "sampleInput" | "expectedCriteria">;
    onReadinessChange: (readiness: MissionReadinessResponse | null) => void;
}

export function MissionReadinessLab({ request, onReadinessChange }: MissionReadinessLabProps) {
    const [sampleInput, setSampleInput] = useState("");
    const [expectedCriteria, setExpectedCriteria] = useState("");
    const requestFingerprint = useMemo(() => JSON.stringify(request), [request]);

    const mutation = useMutation<MissionReadinessResponse>({
        mutationFn: async () => {
            const response = await apiRequest("POST", "/api/missions/preflight", {
                ...request,
                sampleInput,
                expectedCriteria,
            });
            if (!response.ok) throw new Error("Mission preflight failed");
            return response.json();
        },
        onSuccess: onReadinessChange,
        onError: () => onReadinessChange(null),
    });

    useEffect(() => {
        onReadinessChange(null);
        mutation.reset();
        // The serialized request intentionally invalidates stale evidence.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestFingerprint, sampleInput, expectedCriteria]);

    const result = mutation.data;

    return (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-primary" />
                        <h4 className="text-xs font-black uppercase tracking-widest text-primary">Readiness & Evaluation Lab</h4>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Plan-only dry run. No tools execute and no external systems are changed.
                    </p>
                </div>
                {result && (
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("uppercase", result.ready ? "border-emerald-400/30 text-emerald-700 dark:text-emerald-300" : "border-rose-400/30 text-rose-700 dark:text-rose-300")}>
                            {result.score}% ready
                        </Badge>
                        <Badge variant="outline" className="uppercase">{result.promotionState.replace(/_/g, " ")}</Badge>
                    </div>
                )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                    <label htmlFor="readiness-sample" className="text-xs font-bold text-foreground">Representative sample input</label>
                    <Textarea id="readiness-sample" value={sampleInput} onChange={(event) => setSampleInput(event.target.value)} placeholder="Paste a safe example of the work this mission should process." className="min-h-24 bg-background" />
                </div>
                <div className="space-y-2">
                    <label htmlFor="readiness-criteria" className="text-xs font-bold text-foreground">Expected output criteria</label>
                    <Textarea id="readiness-criteria" value={expectedCriteria} onChange={(event) => setExpectedCriteria(event.target.value)} placeholder="Describe what a passing result must contain or avoid." className="min-h-24 bg-background" />
                </div>
            </div>

            <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="gap-2">
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run plan-only preflight
            </Button>

            {mutation.isError && (
                <div role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
                    Readiness could not be evaluated. Launch remains disabled.
                </div>
            )}

            {result && (
                <div className="space-y-4" aria-live="polite">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Metric label="Estimated runtime" value={`~${result.estimatedMinutes}m`} />
                        <Metric label="Estimated cost" value={`$${result.estimatedCostUsd.toFixed(2)}`} />
                        <Metric label="Risk" value={result.riskLevel} />
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {result.checks.map((check) => {
                            const Icon = check.status === "pass" ? CheckCircle2 : check.status === "block" ? ShieldAlert : AlertTriangle;
                            return (
                                <div key={check.id} className={cn(
                                    "rounded-lg border p-3",
                                    check.status === "pass" ? "border-emerald-400/20 bg-emerald-500/5" : check.status === "block" ? "border-rose-400/25 bg-rose-500/10" : "border-amber-400/20 bg-amber-500/5",
                                )}>
                                    <div className="flex items-center gap-2">
                                        <Icon className={cn("h-4 w-4", check.status === "pass" ? "text-emerald-400" : check.status === "block" ? "text-rose-400" : "text-amber-700 dark:text-amber-300")} />
                                        <p className="text-xs font-bold text-foreground">{check.label}</p>
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{check.detail}</p>
                                </div>
                            );
                        })}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground"><Wrench className="h-3.5 w-3.5" />Permission preview</div>
                            <div className="space-y-2">
                                {result.permissions.map((permission) => (
                                    <div key={`${permission.capability}-${permission.scope}`} className="rounded-lg border border-border bg-background/60 p-2 text-xs">
                                        <span className="font-bold text-foreground">{permission.capability}</span>
                                        <span className="ml-2 uppercase text-muted-foreground">{permission.scope} · {permission.access}</span>
                                        {permission.requiresApproval && <Badge variant="outline" className="ml-2 border-amber-400/30 text-[9px] text-amber-700 dark:text-amber-300">approval</Badge>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="mb-2 text-xs font-bold uppercase text-muted-foreground">Dry-run sequence</div>
                            <ol className="space-y-2">
                                {result.dryRunPlan.map((step) => (
                                    <li key={step.sequence} className="flex gap-2 text-xs text-muted-foreground">
                                        <span className="font-mono text-primary">{step.sequence}.</span><span>{step.label}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-border bg-background/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-black capitalize text-foreground">{value}</p>
        </div>
    );
}
