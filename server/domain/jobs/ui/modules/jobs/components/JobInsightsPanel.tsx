import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Coins, Gauge, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * What a job has actually been doing: its health score, what it has cost, and how its
 * requests have gone.
 *
 * The three services behind this — job-health, token-tracking and request-history — were
 * written, mounted under /api/jobs and documented as shipped, but nothing on screen ever
 * called them. This panel is that missing half: no new backend, just the endpoints that
 * were already there, read where someone is looking at the job.
 */

interface HealthResponse {
    overall?: number;
    successRate?: number;
    avgResponseTimeScore?: number;
    errorRateTrend?: number;
    recencyScore?: number;
    status?: string;
    errorCategories?: Record<string, number>;
    performance?: { avgExecutionTimeMs?: number; p50ExecutionTimeMs?: number; p95ExecutionTimeMs?: number };
}

interface TokenResponse {
    totalRequests?: number;
    totalTokens?: number;
    totalCost?: number;
    avgCostPerRequest?: number;
    avgLatency?: number;
    byModel?: Record<string, { tokens: number; cost: number; requests: number }>;
}

interface StatsResponse {
    totalRequests?: number;
    successfulRequests?: number;
    failedRequests?: number;
    successRate?: number;
    responseTime?: { avg?: number; min?: number; max?: number };
}

const fetchJson = async <T,>(url: string): Promise<T> => {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res.json() as Promise<T>;
};

/** Green above 75, amber above 40, red below — the same bands the service scores to. */
function healthTone(score: number | undefined): string {
    if (score === undefined) return "text-muted-foreground";
    if (score >= 75) return "text-emerald-500";
    if (score >= 40) return "text-amber-500";
    return "text-rose-500";
}

const money = (n: number | undefined) => (n === undefined ? "—" : `$${n.toFixed(2)}`);
const ms = (n: number | undefined) => (n === undefined ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
const count = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString());

function Stat({ label, value, tone, Icon }: { label: string; value: string; tone?: string; Icon: typeof Gauge }) {
    return (
        <div className="grid gap-1 rounded-xl border border-foreground/5 bg-foreground/[0.02] p-4">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <Icon className="h-3 w-3" aria-hidden />{label}
            </span>
            <span className={cn("text-xl font-semibold tabular-nums", tone ?? "text-foreground")}>{value}</span>
        </div>
    );
}

export function JobInsightsPanel({ jobId }: { jobId: number }) {
    const enabled = Number.isInteger(jobId) && jobId > 0;
    const health = useQuery<HealthResponse>({
        queryKey: [`/api/jobs/${jobId}/health`],
        queryFn: () => fetchJson<HealthResponse>(`/api/jobs/${jobId}/health`),
        enabled,
    });
    const tokens = useQuery<TokenResponse>({
        queryKey: [`/api/jobs/${jobId}/tokens`],
        queryFn: () => fetchJson<TokenResponse>(`/api/jobs/${jobId}/tokens`),
        enabled,
    });
    const stats = useQuery<StatsResponse>({
        queryKey: [`/api/jobs/${jobId}/history/stats`],
        queryFn: () => fetchJson<StatsResponse>(`/api/jobs/${jobId}/history/stats`),
        enabled,
    });

    // Each panel says its own "nothing yet" rather than one blanket empty state: a job
    // can be healthy with no AI spend, or costly with no recorded requests, and saying
    // "no data" over all three would hide which.
    const nothingRecorded = (stats.data?.totalRequests ?? 0) === 0 && (tokens.data?.totalRequests ?? 0) === 0;

    return (
        <div className="grid gap-4" data-testid="job-insights">
            {(health.error || tokens.error || stats.error) && (
                <p role="alert" className="text-xs text-destructive" data-testid="job-insights-error">
                    Some of this could not be loaded: {[health.error, tokens.error, stats.error].filter(Boolean).map((e) => (e as Error).message).join("; ")}
                </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                    label="Health"
                    Icon={Gauge}
                    tone={healthTone(health.data?.overall)}
                    value={health.data?.overall === undefined ? "—" : `${Math.round(health.data.overall)}`}
                />
                <Stat label="Requests" Icon={Activity} value={count(stats.data?.totalRequests ?? tokens.data?.totalRequests)} />
                <Stat label="Spend" Icon={Coins} value={money(tokens.data?.totalCost)} />
                <Stat label="Typical latency" Icon={Timer} value={ms(stats.data?.responseTime?.avg ?? tokens.data?.avgLatency)} />
            </div>

            {nothingRecorded && !health.isLoading && (
                <p className="text-xs text-muted-foreground" data-testid="job-insights-empty">
                    This job has not recorded a request yet. Health is scored from its runs, and spend from AI calls it makes.
                </p>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-foreground/5">
                    <CardHeader className="py-4">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">How the score is made</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 pb-4 text-xs">
                        {health.isLoading ? (
                            <span className="text-muted-foreground">Scoring…</span>
                        ) : (
                            [
                                ["Success rate", health.data?.successRate],
                                ["Response time", health.data?.avgResponseTimeScore],
                                ["Error trend", health.data?.errorRateTrend],
                                ["Recency", health.data?.recencyScore],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground">{label}</span>
                                    <span className={cn("tabular-nums", healthTone(value as number | undefined))}>
                                        {value === undefined ? "—" : Math.round(value as number)}
                                    </span>
                                </div>
                            ))
                        )}
                        {health.data?.performance?.p95ExecutionTimeMs !== undefined && (
                            <div className="mt-1 flex items-center justify-between gap-3 border-t border-foreground/5 pt-2">
                                <span className="text-muted-foreground">p95 execution</span>
                                <span className="tabular-nums text-foreground">{ms(health.data.performance.p95ExecutionTimeMs)}</span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="border-foreground/5">
                    <CardHeader className="py-4">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Where the money went</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 pb-4 text-xs">
                        {tokens.isLoading ? (
                            <span className="text-muted-foreground">Adding it up…</span>
                        ) : Object.keys(tokens.data?.byModel ?? {}).length === 0 ? (
                            <span className="text-muted-foreground">No AI calls recorded for this job.</span>
                        ) : (
                            Object.entries(tokens.data?.byModel ?? {}).map(([model, usage]) => (
                                <div key={model} className="flex items-center justify-between gap-3">
                                    <span className="truncate text-muted-foreground" title={model}>{model}</span>
                                    <span className="shrink-0 tabular-nums text-foreground">
                                        {money(usage.cost)} · {count(usage.tokens)} tokens
                                    </span>
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            </div>

            {Object.keys(health.data?.errorCategories ?? {}).length > 0 && (
                <Card className="border-foreground/5">
                    <CardHeader className="py-4">
                        <CardTitle className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                            <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden />What has been going wrong
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2 pb-4">
                        {Object.entries(health.data?.errorCategories ?? {}).map(([category, n]) => (
                            <Badge key={category} variant="outline" className="text-[10px]">
                                {category.replace(/_/g, " ")} · {n}
                            </Badge>
                        ))}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export default JobInsightsPanel;
