import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { StatCard } from "@domain-ui/core/ui/components/ui/stat-card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@domain-ui/core/ui/components/ui/table";
import { Activity, AlertTriangle, Calendar, Clock, GitBranch, Zap, ArrowRight, Scale } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { missionRunPath } from "@/lib/paths";
import { ActivityTimeline, TimelineEvent } from '../components/ActivityTimeline.js';
import { ProactiveInsightsCard } from '../components/ProactiveInsightsCard.js';
import { DecisionDashboardWidget } from '../components/DecisionDashboardWidget.js';
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { usePrefetch } from "@domain-ui/core/ui/hooks/use-prefetch";
import { Section } from "@domain-ui/core/ui/components/shared/Section";
import "./Dashboard.css";

interface DashboardStats {
  activeSchedules: number;
  failedJobs24h: number;
  activeAlerts: number;
  activePipelines: number;
  activeWorkstreams: number;
  executionTrend: {
    day: string;
    status_completed: number;
    status_failed: number;
  }[];
  recentExecutions: {
    executionId: number;
    jobName: string;
    status: string;
    startTime: string;
    scheduledJobName: string;
    duration?: string;
    type?: string;
    missionId?: number;
    runId?: number;
  }[];
  activeAlertList: {
    alertId: number;
    severity: string;
    message: string;
    title?: string;
    createdAt?: string;
  }[];
}

// Fix #19: single shared query hook — three sub-components share the same cache entry
function useDashboardStats() {
  return useSuspenseQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard/stats");
      return res.json();
    },
    refetchInterval: 15000,
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCards({ prefetch }: { prefetch: (url: string) => void }) {
  const { data: summary } = useDashboardStats();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        title="Active Schedules"
        value={summary?.activeSchedules}
        icon={Calendar}
        linkTo="/schedules"
        trend={{ value: 0, label: "Nominal" }}
        onMouseEnter={() => prefetch("/api/schedules")}
      />
      <StatCard
        title="Anomaly Alerts"
        value={summary?.failedJobs24h}
        icon={AlertTriangle}
        valueColor={summary?.failedJobs24h > 0 ? "text-destructive" : "text-emerald-500"}
        linkTo="/health/monitoring"
        trend={summary?.failedJobs24h > 0 ? { value: summary.failedJobs24h, label: "Critical", positive: false } : undefined}
        onMouseEnter={() => prefetch("/api/monitoring")}
      />
      <StatCard
        title="Active Pulses"
        value={summary?.activeAlerts}
        icon={Activity}
        valueColor={summary?.activeAlerts > 0 ? "text-amber-500" : "text-primary"}
        linkTo="/health/alerts"
        onMouseEnter={() => prefetch("/api/alerts")}
      />
      <StatCard
        title="Live Workstreams"
        value={summary?.activeWorkstreams}
        icon={GitBranch}
        linkTo="/workstreams"
        onMouseEnter={() => prefetch("/api/workstreams")}
      />
    </div>
  );
}

function ExecutionTrendCard() {
  const { data: summary } = useDashboardStats();

  const data = summary?.executionTrend ?? [];
  if (data.length === 0) return null;

  const maxTotal = data.reduce((max, current) => Math.max(max, current.status_completed + current.status_failed), 1);

  return (
    <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
      <CardHeader className="px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
            <Activity className="w-4 h-4 text-primary" />
            Execution Ledger
          </CardTitle>
          <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5">Live Telemetry</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="flex gap-3">
          {/* Y-axis scale ticks */}
          <div className="flex h-48 w-6 shrink-0 flex-col justify-between pr-1 text-right text-[9px] font-mono tabular-nums text-muted-foreground">
            <span>{maxTotal}</span>
            <span>{Math.round(maxTotal / 2)}</span>
            <span>0</span>
          </div>
          {/* Plot area: faint gridlines behind, bars in front */}
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              <span className="border-t border-dashed border-border/50" />
              <span className="border-t border-dashed border-border/50" />
              <span className="border-t border-border/60" />
            </div>
            <div className="relative flex h-48 items-end space-x-3 px-1">
              {data.map((item, index) => {
                const scaleFactor = 100 / Math.max(maxTotal, 1);
                return (
                  <div key={index} className="group relative flex h-full flex-1 flex-col justify-end items-center gap-1.5">
                    {item.status_completed > 0 && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(item.status_completed * scaleFactor, 2)}%` }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        className="w-full max-w-[28px] bg-emerald-500/60 rounded-t-sm transition-colors duration-300 hover:bg-emerald-500"
                        title={`Completed: ${item.status_completed}`}
                      />
                    )}
                    {item.status_failed > 0 && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(item.status_failed * scaleFactor, 2)}%` }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        className="w-full max-w-[28px] bg-rose-500/60 rounded-t-sm transition-colors duration-300 hover:bg-rose-500"
                        title={`Failed: ${item.status_failed}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* X-axis day labels, aligned under the bars (spacer matches the y-axis column) */}
        <div className="flex gap-3">
          <div className="w-6 shrink-0" aria-hidden="true" />
          <div className="flex flex-1 space-x-3 px-1 mt-2">
            {data.map((item, index) => (
              <span key={index} className="flex-1 text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{item.day.slice(0, 3)}</span>
            ))}
          </div>
        </div>
        <div className="flex justify-start text-[10px] space-x-6 mt-8 pt-4 border-t border-border/40 mx-2">
          <div className="flex items-center space-x-2.5">
            <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full" />
            <span className="text-muted-foreground font-bold uppercase tracking-wider">Nominal</span>
          </div>
          <div className="flex items-center space-x-2.5">
            <span className="h-1.5 w-1.5 bg-rose-500 rounded-full" />
            <span className="text-muted-foreground font-bold uppercase tracking-wider">Anomaly</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OperationalLog({ prefetch }: { prefetch: (url: string) => void }) {
  const [, setLocation] = useLocation();
  const { data: summary } = useDashboardStats();

  return (
    <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
      <CardHeader className="px-6 py-4 border-b bg-muted/30 flex flex-row items-center justify-between">
        <div className="space-y-0.5">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
            <Clock className="w-4 h-4 text-primary" />
            Operational Log
          </CardTitle>
          <CardDescription className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Intercepted system signals</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild className="text-primary hover:text-primary/80" onMouseEnter={() => prefetch("/api/monitoring")}>
          <Link href="/health/monitoring">View All <ArrowRight className="ml-1 w-3 h-3" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent border-border/40">
              <TableHead className="pl-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Operation</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Signal</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Latency</TableHead>
              <TableHead className="text-right pr-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!summary || summary.recentExecutions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-muted-foreground font-medium text-xs">
                  No Operational Fragments Detected
                </TableCell>
              </TableRow>
            ) : (
              summary.recentExecutions.slice(0, 10).map((exec) => {
                // recentExecutions is a UNION of two tables and `executionId` means a
                // different thing in each: pipeline_step_executions.id for 'planned'
                // rows, agent_run_steps.id for 'autonomous' ones. /health/monitoring/:id
                // resolves only the former, so linking an autonomous row there 404s —
                // and every agent_run_steps row has a null mission_id, so they all fell
                // through to that branch.
                const hasMissionContext = Boolean(exec.missionId && exec.runId);
                const isPlannedExecution = exec.type !== "autonomous";
                // Both kinds resolve now: 'planned' ids are pipeline_step_executions,
                // 'autonomous' ids are agent_run_steps. The kind must be stated because
                // ids 35 and 48-51 exist in both tables.
                const target = hasMissionContext
                  ? missionRunPath(exec.missionId!, exec.runId!)
                  : isPlannedExecution
                    ? `/health/monitoring/step/${exec.executionId}`
                    : `/health/monitoring/agent-step/${exec.executionId}`;

                return (
                <TableRow
                  key={`${exec.type ?? "planned"}-${exec.executionId}`}
                  className={`group border-border/40 ${target ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"}`}
                  onMouseEnter={() => {
                    if (hasMissionContext) {
                      prefetch(`/api/missions/${exec.missionId}/runs/${exec.runId}`);
                    } else {
                      prefetch(`/api/executions/${exec.executionId}?kind=${isPlannedExecution ? "step" : "agent-step"}`);
                    }
                  }}
                  onClick={() => {
                    if (target) setLocation(target);
                  }}
                >
                  <TableCell className="pl-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors tracking-tight">{exec.jobName}</span>
                      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{exec.scheduledJobName || "Manual Intervention"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {exec.status === "success" ? (
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 gap-1.5 pl-1.5 pr-2.5 py-0.5 font-bold uppercase text-[9px] tracking-widest">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Nominal
                      </Badge>
                    ) : exec.status === "failed" ? (
                      <Badge variant="secondary" className="bg-rose-500/10 text-rose-600 border-rose-500/20 gap-1.5 pl-1.5 pr-2.5 py-0.5 font-bold uppercase text-[9px] tracking-widest">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Anomaly
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 gap-1.5 pl-1.5 pr-2.5 py-0.5 font-bold uppercase text-[9px] tracking-widest">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Active
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                    {exec.duration || "SEC: < 1"}
                  </TableCell>
                  <TableCell className="text-right pr-6 text-xs font-mono text-muted-foreground group-hover:text-primary transition-colors">
                    {format(new Date(exec.startTime), "HH:mm:ss")}
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function LivePulse() {
  const { data: timelineData } = useSuspenseQuery<TimelineEvent[]>({
    queryKey: ["/api/dashboard/timeline"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard/timeline");
      return res.json();
    },
    refetchInterval: 10000,
  });

  return (
    <Card className="flex flex-col h-full border-border/40 shadow-sm overflow-hidden bg-card">
      <CardHeader className="px-6 py-4 border-b bg-muted/30">
        <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
          <Activity className="w-4 h-4 text-primary" />
          Live Pulse
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 operational-ledger">
        <ActivityTimeline events={timelineData ?? []} className="p-6" maxHeight="max-h-[600px]" />
      </CardContent>
    </Card>
  );
}

// ─── Skeleton fallbacks ───────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
    </div>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-64 w-full rounded-xl" />;
}

function TableSkeleton() {
  return (
    <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
      <CardHeader className="px-6 py-4 border-b bg-muted/30">
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/40">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4 px-6 py-4">
              <Skeleton className="h-10 flex-1" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TimelineSkeleton() {
  return (
    <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
      <CardHeader className="px-6 py-4 border-b bg-muted/30">
        <Skeleton className="h-5 w-24" />
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Page shell ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const prefetch = usePrefetch();

  return (
    // Fix #21: removed px-8 pt-8 — Layout already provides p-4 lg:p-6
    <div className="dashboard-container space-y-8 pb-10 bg-background">
      {/* Header — renders immediately, no data needed. Stacks on mobile so the
          title and the New Activity button don't crowd/overlap at narrow widths. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-black tracking-tight text-foreground uppercase italic">
            Command <span className="text-primary">Center</span>
          </h1>
          <div className="flex items-center gap-2 text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
            <span className="h-1.5 w-1.5 bg-primary rounded-full animate-pulse" />
            System Operational // Live Telemetry Active
          </div>
        </div>
        <div className="flex gap-4">
          <Link href="/jobs">
            <Button
              className="font-bold uppercase tracking-widest px-6 shadow-sm"
              onMouseEnter={() => prefetch("/api/jobs")}
            >
              <Zap className="w-4 h-4 mr-2" />
              New Activity
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <Section fallback={<KpiSkeleton />}>
        <KpiCards prefetch={prefetch} />
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Section fallback={<ChartSkeleton />}>
            <ExecutionTrendCard />
          </Section>

          <Section fallback={<TableSkeleton />}>
            <OperationalLog prefetch={prefetch} />
          </Section>
        </div>

        <div className="space-y-6">
          <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
            <CardHeader className="px-6 py-4 border-b bg-muted/30">
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                <Scale className="w-4 h-4 text-primary" />
                Pending Decisions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DecisionDashboardWidget />
            </CardContent>
          </Card>

          <Section fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
            <ProactiveInsightsCard />
          </Section>

          <Section fallback={<TimelineSkeleton />}>
            <LivePulse />
          </Section>
        </div>
      </div>
    </div>
  );
}
