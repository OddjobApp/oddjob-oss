
import React from 'react';
import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/pages/public/PublicPages";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, Activity, ShieldCheck } from "lucide-react";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import { cn } from "@/lib/utils";

interface TrustMetrics {
    status: "operational" | "degraded" | "outage" | "unverified";
    uptime_90d: number | null;
    last_updated: string;
    metrics: {
        jobs_processed_24h: number;
        success_rate_24h: number | null;
        integration_success_rate_24h: number | null;
    };
    components: { name: string; status: string }[];
    modules?: {
        module: string;
        status: "operational" | "degraded" | "unverified";
        tests: number;
        behaviors: number;
        open_incidents: number;
        last_activity: string | null;
    }[];
    incidents: { date: string; status: string; message: string }[];
    assurance: {
        evidence_model: string;
        audit_bundle_schema: string;
        human_readable_report: string;
        report_attestation: string;
        integrity: string;
        payload_policy: string;
        evidence_levels: string[];
        production_30d: {
            sample_size: number;
            terminal_runs: number;
            completed_runs: number;
            failed_runs: number;
            outcome_measured_runs: number;
            successful_outcomes: number;
            technical_completion_rate: number | null;
            outcome_success_rate: number | null;
            claim_status: "insufficient_evidence" | "directional" | "reportable";
        };
    };
}

const displayPercent = (value: number | null) => value == null ? "Unverified" : `${value}%`;

const relativeTime = (iso: string | null) => {
    if (!iso) return "On change";
    const diffMs = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diffMs)) return "On change";
    const days = Math.floor(diffMs / 86_400_000);
    if (days > 0) return `${days}d ago`;
    const hours = Math.floor(diffMs / 3_600_000);
    if (hours > 0) return `${hours}h ago`;
    const mins = Math.floor(diffMs / 60_000);
    return mins > 0 ? `${mins}m ago` : "Just now";
};

// Helper for dynamic progress to avoid inline styles lint
const DynamicProgress = ({ rate, className }: { rate: string, className?: string }) => {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (ref.current) ref.current.style.width = rate;
    }, [rate]);
    return <div ref={ref} className={className} />;
};

export default function TrustPage() {
    const { data, isLoading, isError } = useQuery<TrustMetrics>({
        queryKey: ['public-trust-metrics'],
        queryFn: async () => {
            const res = await fetch('/api/public/trust');
            if (!res.ok) throw new Error('Network response was not ok');
            const data = await res.json();
            return data.data;
        },
        refetchInterval: 60000
    });

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'operational': return <CheckCircle2 className="w-8 h-8 shrink-0 text-green-500" />;
            case 'degraded': return <AlertTriangle className="w-8 h-8 shrink-0 text-yellow-500" />;
            case 'outage': return <XCircle className="w-8 h-8 shrink-0 text-red-500" />;
            case 'unverified': return <ShieldCheck className="w-8 h-8 shrink-0 text-muted-foreground" />;
            default: return <Activity className="w-8 h-8 shrink-0 text-muted-foreground" />;
        }
    };

    if (isLoading) {
        return (
            <Shell title="Trust Center" intro="System status, operational performance, and the evidence behind our reports.">
                <div className="max-w-4xl w-full p-8 space-y-8">
                    <Skeleton className="h-24 w-full rounded-xl" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Skeleton className="h-48" />
                        <Skeleton className="h-48" />
                    </div>
                </div>
            </Shell>
        );
    }

    if (isError || !data) {
        return (
            <Shell title="Trust Center" intro="System status, operational performance, and the evidence behind our reports."><section className="rounded-2xl border border-border bg-card p-8" role="alert">
                <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
                <h2 className="text-2xl font-semibold">Unable to load system status</h2>
                <p className="text-muted-foreground mt-2">Please check back later.</p>
                <Button className="mt-6" onClick={() => window.location.reload()}>Retry</Button>
            </section></Shell>
        );
    }

    return (
        <Shell title="Trust Center" intro="System status, operational performance, and the evidence behind our reports.">
            <div className="space-y-8 [&_.rounded-xl]:rounded-2xl [&_.shadow-sm]:shadow-none">
                {/* Hero Status */}
                <Card className={cn(
                    "border-l-4 shadow-none rounded-2xl",
                    data.status === "operational" ? "border-l-green-500" :
                        data.status === "degraded" ? "border-l-yellow-500" :
                            data.status === "outage" ? "border-l-red-500" : "border-l-gray-400",
                )}>
                    <CardContent className="p-5 sm:p-8 flex flex-col md:flex-row items-start justify-between gap-6">
                        <div className="flex items-start gap-4">
                            {getStatusIcon(data.status)}
                            <div>
                                <h2 className="text-2xl font-semibold tracking-tight">
                                    {data.status === 'operational' ? 'All Systems Operational' :
                                        data.status === 'degraded' ? 'Partial System Degradation' :
                                            data.status === 'outage' ? 'System Outage' : 'Status Not Yet Verified'}
                                </h2>
                                <p className="text-muted-foreground mt-1">
                                    Last updated: {Number.isNaN(Date.parse(data.last_updated)) ? 'Unavailable' : new Date(data.last_updated).toLocaleString()}
                                </p>
                            </div>
                        </div>
                        <div className="md:text-right">
                            <div className="text-sm font-medium text-muted-foreground">Uptime (90 days)</div>
                            <div className={cn("text-3xl font-bold", data.uptime_90d == null ? "text-muted-foreground" : "text-foreground")}>
                                {displayPercent(data.uptime_90d)}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Core Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>System Performance (24h)</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div>
                                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
                                    <span className="text-sm font-medium">Job Processing Volume</span>
                                    <span className="text-2xl font-bold">{data.metrics.jobs_processed_24h.toLocaleString()}</span>
                                </div>

                            </div>

                            <div>
                                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
                                    <span className="text-sm font-medium">Global Success Rate</span>
                                    <span className="text-2xl font-bold">{displayPercent(data.metrics.success_rate_24h)}</span>
                                </div>
                                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                    {data.metrics.success_rate_24h != null && <DynamicProgress
                                        className={cn(
                                            "h-full",
                                            data.metrics.success_rate_24h > 98 ? 'bg-green-500' : 'bg-yellow-500'
                                        )}
                                        rate={`${data.metrics.success_rate_24h}%`}
                                    />}
                                </div>
                            </div>

                            <div>
                                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium">Integration success</span>
                                        <Badge variant="outline" className="text-xs px-2">External APIs</Badge>
                                    </div>
                                    <span className="text-2xl font-bold">{displayPercent(data.metrics.integration_success_rate_24h)}</span>
                                </div>
                                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                    {data.metrics.integration_success_rate_24h != null && <DynamicProgress
                                        className={cn(
                                            "h-full",
                                            data.metrics.integration_success_rate_24h > 95 ? 'bg-green-500' :
                                                data.metrics.integration_success_rate_24h > 80 ? 'bg-yellow-500' : 'bg-red-500'
                                        )}
                                        rate={`${data.metrics.integration_success_rate_24h}%`}
                                    />}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Component Status</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {data.components.map((c, i) => (
                                    <div key={i} className="flex flex-wrap gap-3 items-center justify-between p-3 border rounded-lg bg-card/50">
                                        <span className="font-medium">{c.name}</span>
                                        <Badge variant={c.status === 'operational' ? 'default' : c.status === 'unverified' ? 'outline' : 'destructive'}
                                            className={c.status === 'operational' ? 'bg-green-100 text-green-800 hover:bg-green-100' : ''}>
                                            {c.status === 'operational' ? 'Operational' : c.status === 'unverified' ? 'Unverified' : 'Issues Detected'}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Evidence & Assurance */}
                <div className="space-y-4">
                    <div>
                        <h2 className="text-2xl font-bold">Evidence &amp; Assurance</h2>
                        <p className="text-muted-foreground mt-1">
                            Production claims exclude demo, seeded, and shadow runs. Missing evidence is shown as unverified—not 100%.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle>Production Mission Evidence (30d)</CardTitle>
                                <CardDescription>
                                    Explicitly production-labeled runs only; no customer or mission identifiers are published.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div><p className="text-xs text-muted-foreground">Sample size</p><p className="text-2xl font-bold">{data.assurance.production_30d.sample_size}</p></div>
                                <div><p className="text-xs text-muted-foreground">Terminal runs</p><p className="text-2xl font-bold">{data.assurance.production_30d.terminal_runs}</p></div>
                                <div><p className="text-xs text-muted-foreground">Completion</p><p className="text-xl font-semibold">{displayPercent(data.assurance.production_30d.technical_completion_rate)}</p></div>
                                <div><p className="text-xs text-muted-foreground">Outcome success</p><p className="text-xl font-semibold">{displayPercent(data.assurance.production_30d.outcome_success_rate)}</p></div>
                                <div className="sm:col-span-2">
                                    <Badge variant={data.assurance.production_30d.claim_status === "reportable" ? "default" : "outline"}>
                                        {data.assurance.production_30d.claim_status === "reportable" ? "Reportable sample" :
                                            data.assurance.production_30d.claim_status === "directional" ? "Directional—sample below 30" : "Insufficient production evidence"}
                                    </Badge>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader><CardTitle>Audit evidence</CardTitle></CardHeader>
                            <CardContent className="space-y-3 break-words text-sm">
                                <div><p className="text-muted-foreground">Bundle</p><p className="font-medium">{data.assurance.audit_bundle_schema}</p></div>
                                <div><p className="text-muted-foreground">Human-readable report</p><p className="font-medium">{data.assurance.human_readable_report}</p></div>
                                <div><p className="text-muted-foreground">Report attestation</p><p className="font-medium">{data.assurance.report_attestation}</p></div>
                                <div><p className="text-muted-foreground">Integrity</p><p className="font-medium">{data.assurance.integrity}</p></div>
                                <div><p className="text-muted-foreground">Payloads</p><p className="font-medium">{data.assurance.payload_policy}</p></div>
                                <Separator />
                                <div className="flex flex-wrap gap-1.5">
                                    {data.assurance.evidence_levels.map((level) => <Badge key={level} variant="outline">{level.replaceAll("_", " ")}</Badge>)}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Quality & Verification (per-module) */}
                {data.modules && data.modules.length > 0 && (
                    <div className="space-y-4">
                        <div>
                            <h2 className="text-2xl font-bold">Quality &amp; Verification</h2>
                            <p className="text-muted-foreground mt-1">
                                Independent end-to-end test coverage and open issues, by product module.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {data.modules.map((m, i) => {
                                const dot =
                                    m.status === "operational" ? "bg-green-500" :
                                    m.status === "degraded" ? "bg-yellow-500" : "bg-gray-400";
                                const statusLabel =
                                    m.status === "operational" ? "Verified" :
                                    m.status === "degraded" ? `${m.open_incidents} open issue${m.open_incidents === 1 ? "" : "s"}` :
                                    "Not verified";
                                return (
                                    <Card key={i} className="bg-card/50">
                                        <CardContent className="p-5 space-y-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-semibold">{m.module}</span>
                                                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                                    <span className={cn("w-2 h-2 rounded-full", dot)} />
                                                    {statusLabel}
                                                </span>
                                            </div>
                                            <div className="flex items-baseline gap-4 text-sm">
                                                <div>
                                                    <span className="text-2xl font-bold">{m.behaviors}</span>
                                                    <span className="text-muted-foreground ml-1">behaviors</span>
                                                </div>
                                                <div className="text-muted-foreground">
                                                    <span className="font-semibold text-foreground">{m.tests}</span> tests
                                                </div>
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                Last checked: {relativeTime(m.last_activity)}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Incident History*/}
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold">Past Incidents</h2>
                    <div className="space-y-4">
                        {data.incidents.length > 0 ? (
                            data.incidents.map((incident, idx) => (
                                <Card key={idx}>
                                    <CardContent className="p-6">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
                                            <div className="font-semibold text-lg text-primary">{incident.message}</div>
                                            <div className="text-sm text-muted-foreground">{new Date(incident.date).toLocaleDateString()}</div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant="outline">{incident.status}</Badge>

                                        </div>
                                    </CardContent>
                                </Card>
                            ))
                        ) : (
                            <Card className="border-border bg-card">
                                <CardContent className="p-8 text-center text-foreground">
                                    <CheckCircle2 className="w-8 h-8 shrink-0 mx-auto mb-4 text-green-500 opacity-50" />
                                    <h3 className="text-lg font-semibold">No incidents reported recently</h3>
                                    <p className="opacity-80">No incidents are listed in the current report. See the status above for current availability.</p>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>

            </div>
        </Shell>
    );
}
