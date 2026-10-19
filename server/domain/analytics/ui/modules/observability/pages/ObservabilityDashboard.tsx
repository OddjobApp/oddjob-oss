
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { AlertCircle, CheckCircle, Clock, Activity, Brain, Globe, Eye } from "lucide-react";
import { TraceWaterfall } from "@domain-ui/analytics/ui/components/observability/TraceWaterfall";
import { CriticFeed } from "@domain-ui/analytics/ui/components/observability/CriticFeed";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    LineChart,
    Line
} from "recharts";

interface PipelineStat {
    pipeline_id: number;
    pipeline_name: string;
    total_executions: string;
    successful_executions: string;
    success_rate_percentage: number;
    avg_duration_seconds: string;
    last_execution_time: string;
}

interface AIUsageStat {
    model: string;
    request_count: string;
    total_tokens: number;
    avg_latency_ms: number;
}

interface ErrorHotspot {
    job_type: string;
    job_id: number;
    failure_count: string;
    last_failure: string;
}

interface ObservabilityStats {
    pipelines: PipelineStat[];
    ai_usage: AIUsageStat[];
    errors: ErrorHotspot[];
    trace_volume: any[];
}

const safeDateDisplay = (dateStr: string | number | undefined) => {
    if (!dateStr) return "Never";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime()) || d.getTime() < 86400000) return "Never";
        return d.toLocaleString();
    } catch {
        return "Never";
    }
};

export default function ObservabilityDashboard() {
    const { data: stats, isLoading } = useQuery<ObservabilityStats>({
        queryKey: ["observability-stats"],
        queryFn: async () => {
            const res = await fetch("/api/observability/stats");
            if (!res.ok) throw new Error("Failed to fetch stats");
            return res.json();
        },
        refetchInterval: 30000 // Refresh every 30s
    });

    if (isLoading) {
        return (
            <div className="p-8 space-y-6">
                <Skeleton className="h-12 w-1/3" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Skeleton className="h-40" />
                    <Skeleton className="h-40" />
                    <Skeleton className="h-40" />
                </div>
                <Skeleton className="h-96" />
            </div>
        );
    }

    const pipelines = stats?.pipelines || [];
    const aiUsage = stats?.ai_usage || [];
    const errors = stats?.errors || [];

    return (
        <div className="p-8 space-y-8 bg-background min-h-screen text-foreground">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Observability Dashboard</h1>
                <p className="text-muted-foreground mt-2">
                    Real-time metrics from W3C Distributed Tracing & Forensic Logs
                </p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Global AI Token Usage</CardTitle>
                        <Brain className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {aiUsage.reduce((acc, curr) => acc + (Number(curr.total_tokens) || 0), 0).toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground">Tokens consumed across all models</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Trace Volume (24h)</CardTitle>
                        <Activity className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {stats?.trace_volume.reduce((acc, curr) => acc + Number(curr.span_count), 0).toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground">Spans ingested</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Error Rate Hotspots</CardTitle>
                        <AlertCircle className="h-4 w-4 text-destructive" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{errors.length} Active</div>
                        <p className="text-xs text-muted-foreground">Jobs with frequent failures</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="performance" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="performance">Pipeline Performance</TabsTrigger>
                    <TabsTrigger value="ai">AI & RAG Telemetry</TabsTrigger>
                    <TabsTrigger value="critic">Critic Feed (Qualitative)</TabsTrigger>
                    <TabsTrigger value="errors">Error Analysis</TabsTrigger>
                    <TabsTrigger value="traces">Trace Explorer</TabsTrigger>
                </TabsList>

                <TabsContent value="traces" className="space-y-4">
                    <TracesList />
                </TabsContent>

                <TabsContent value="critic" className="space-y-4 h-[600px]">
                    <CriticFeed />
                </TabsContent>

                <TabsContent value="performance" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Pipeline Execution Metrics</CardTitle>
                            <CardDescription>Average latency and success rates per pipeline.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Pipeline</TableHead>
                                        <TableHead>Executions</TableHead>
                                        <TableHead>Success Rate</TableHead>
                                        <TableHead>Avg Duration</TableHead>
                                        <TableHead>Last Run</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pipelines.map((p) => (
                                        <TableRow key={p.pipeline_id}>
                                            <TableCell className="font-medium">{p.pipeline_name}</TableCell>
                                            <TableCell>{p.total_executions}</TableCell>
                                            <TableCell>
                                                <Badge variant={p.success_rate_percentage > 90 ? "success" : p.success_rate_percentage > 70 ? "warning" : "destructive"}>
                                                    {p.success_rate_percentage}%
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{(parseFloat(p.avg_duration_seconds) || 0).toFixed(2)}s</TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {safeDateDisplay(p.last_execution_time)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="ai" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Token Usage by Model</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={aiUsage}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="model" />
                                        <YAxis />
                                        <Tooltip cursor={{ fill: 'transparent' }} />
                                        <Bar dataKey="total_tokens" fill="#8884d8" name="Tokens" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Average Latency by Model</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={aiUsage}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="model" />
                                        <YAxis />
                                        <Tooltip cursor={{ fill: 'transparent' }} />
                                        <Bar dataKey="avg_latency_ms" fill="#82ca9d" name="Latency (ms)" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="errors" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Top Failure Hotspots</CardTitle>
                            <CardDescription>Jobs that are frequently failing or timing out.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Job Type</TableHead>
                                        <TableHead>Job ID</TableHead>
                                        <TableHead>Failure Count</TableHead>
                                        <TableHead>Last Failure</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {errors.map((e, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell className="font-medium">{e.job_type}</TableCell>
                                            <TableCell>{e.job_id}</TableCell>
                                            <TableCell className="text-destructive font-bold">{e.failure_count}</TableCell>
                                            <TableCell>
                                                {safeDateDisplay(e.last_failure)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function TracesList() {
    const { data: traces, isLoading } = useQuery({
        queryKey: ["recent-traces"],
        queryFn: async () => {
            const res = await fetch("/api/observability/traces");
            if (!res.ok) throw new Error("Failed to fetch traces");
            return res.json();
        },
        refetchInterval: 10000
    });

    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

    if (isLoading) return <Skeleton className="h-64" />;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Recent Distributed Traces</CardTitle>
                <CardDescription>Inspect full execution waterfalls across system boundaries.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Trace ID</TableHead>
                            <TableHead>Root Job</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead>Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {traces?.map((t: any) => (
                            <TableRow key={t.trace_id}>
                                <TableCell className="font-mono text-xs">{t.trace_id.substring(0, 8)}...</TableCell>
                                <TableCell>{t.job_type}</TableCell>
                                <TableCell>
                                    <Badge variant={t.status === 'success' ? 'success' : 'destructive'}>
                                        {t.status}
                                    </Badge>
                                </TableCell>
                                <TableCell>{t.duration_ms}ms</TableCell>
                                <TableCell className="text-muted-foreground text-xs">
                                    {safeDateDisplay(t.created_at)}
                                </TableCell>
                                <TableCell>
                                    <Button variant="outline" size="sm" onClick={() => setSelectedTraceId(t.trace_id)}>
                                        <Eye className="h-4 w-4 mr-2" />
                                        Inspect
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <Dialog open={!!selectedTraceId} onOpenChange={(open) => !open && setSelectedTraceId(null)}>
                    <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                        <DialogHeader>
                            <DialogTitle>Trace Inspection</DialogTitle>
                        </DialogHeader>
                        {selectedTraceId && <TraceWaterfall traceId={selectedTraceId} />}
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}
