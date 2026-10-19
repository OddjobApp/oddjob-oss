import React, { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  FileSearch,
  HeartPulse,
  MessageSquare,
  Monitor,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  TestTube2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { cn } from "@/lib/utils";

type HealthLink = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

type AttentionItem = {
  id: string;
  alertId?: number;
  label: string;
  detail: string;
  href: string;
  severity: "critical" | "warning" | "info";
  icon: LucideIcon;
  action: string;
};

const healthLinks: HealthLink[] = [
  {
    title: "Observability",
    description: "Unified telemetry, traces, status signals, and operational context.",
    href: "/health/observability",
    icon: Activity,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Monitoring",
    description: "Runtime monitoring for executions, services, health metrics, and active checks.",
    href: "/health/monitoring",
    icon: Monitor,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Alerts",
    description: "Active alerts, alert history, thresholds, and attention signals.",
    href: "/health/alerts",
    icon: Bell,
    tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  {
    title: "Events",
    description: "Event stream, filters, diagnostic records, and audit-adjacent activity.",
    href: "/health/events",
    icon: FileSearch,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    title: "Pulse",
    description: "Live system pulse, behavior signals, and moment-to-moment platform activity.",
    href: "/health/pulse",
    icon: Radio,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "Incidents",
    description: "Diagnoses, incident evidence, clustered failures, and recommended response paths.",
    href: "/health/incidents",
    icon: AlertTriangle,
    tone: "border-orange-400/20 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  {
    title: "Infra Health",
    description: "Infrastructure health, dependency state, service availability, and platform checks.",
    href: "/health/infra-health",
    icon: Server,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    title: "E2E Testing",
    description: "Playwright coverage, recent failures, validation runs, and assembled test blocks.",
    href: "/health/e2e-tests",
    icon: TestTube2,
    tone: "border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  },
];

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function countItems(data: any): number {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.items)) return data.items.length;
  if (Array.isArray(data?.alerts)) return data.alerts.length;
  if (Array.isArray(data?.events)) return data.events.length;
  if (Array.isArray(data?.data)) return data.data.length;
  return Number(data?.count ?? data?.total ?? 0);
}

function asArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.alerts)) return data.alerts;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function formatUpdatedAt(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function HealthOverview() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const alertsQuery = useQuery({ queryKey: ["/api/alerts", "health-overview"], queryFn: () => fetchJson("/api/alerts"), refetchInterval: 30000 });
  const eventsQuery = useQuery({ queryKey: ["/api/events", "health-overview"], queryFn: () => fetchJson("/api/events?limit=25"), refetchInterval: 30000 });
  const infraQuery = useQuery({ queryKey: ["/api/admin/circuit-breakers", "health-overview"], queryFn: () => fetchJson("/api/admin/circuit-breakers"), refetchInterval: 30000 });

  const loading = alertsQuery.isLoading || eventsQuery.isLoading || infraQuery.isLoading;
  const alerts = asArray(alertsQuery.data);
  const events = asArray(eventsQuery.data);
  const circuits = asArray(infraQuery.data);
  const alertCount = alerts.length;
  const eventCount = events.length;
  const dependencyCount = circuits.length;
  const hasOpenCircuit = circuits.some((item: any) => String(item.state || item.status || "").toLowerCase() === "open");
  const hasCriticalSignals = alertCount > 0 || hasOpenCircuit;
  const lastUpdated = Math.max(
    alertsQuery.dataUpdatedAt || 0,
    eventsQuery.dataUpdatedAt || 0,
    infraQuery.dataUpdatedAt || 0
  );

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const alertItems = alerts.slice(0, 4).map((alert: any, index: number) => {
      const severity = String(alert.severity || "warning").toLowerCase();
      return {
        id: `alert-${alert.id ?? alert.message ?? alert.createdAt ?? index}`,
        alertId: typeof alert.id === "number" ? alert.id : undefined,
        label: alert.title || alert.message || "Active alert",
        detail: alert.source || alert.category || "Alert requires review",
        href: "/health/alerts",
        severity: severity === "critical" ? "critical" : "warning",
        icon: AlertTriangle,
        action: "Review alert",
      } as AttentionItem;
    });

    const circuitItems = circuits
      .filter((circuit: any) => String(circuit.state || circuit.status || "").toLowerCase() === "open")
      .slice(0, 3)
      .map((circuit: any) => ({
        id: `circuit-${circuit.name}`,
        label: `${circuit.name || "Circuit breaker"} is open`,
        detail: `${circuit.failures ?? circuit.failureCount ?? 0} recent failures`,
        href: "/health/infra-health",
        severity: "critical" as const,
        icon: Server,
        action: "Inspect dependency",
      }));

    const eventItems = alertItems.length || circuitItems.length
      ? []
      : events.slice(0, 3).map((event: any, index: number) => ({
          id: `event-${event.id ?? event.eventId ?? event.timestamp ?? event.createdAt ?? index}`,
          label: event.eventType || event.type || "Recent platform event",
          detail: event.source || event.context?.source || "Recent activity",
          href: "/health/events",
          severity: "info" as const,
          icon: FileSearch,
          action: "View event",
        }));

    return [...circuitItems, ...alertItems, ...eventItems].slice(0, 6);
  }, [alerts, circuits, events]);

  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: number) => {
      const res = await fetch(`/api/alerts/${alertId}/acknowledge`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to acknowledge alert");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts", "health-overview"] });
    },
  });

  const openAssistantBrief = async () => {
    try {
      const res = await fetch("/api/health/triage-brief", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch triage brief");
      const briefData = await res.json();

      const prompt = [
        "Create a Health triage brief for this page.",
        `Open alerts: ${alertCount}`,
        `Recent events loaded: ${eventCount}`,
        `Circuit breakers loaded: ${dependencyCount}`,
        `Platform state: ${hasCriticalSignals ? "Watch" : "Nominal"}`,
        "Use this structure:",
        "1. Current severity and why.",
        "2. What changed recently.",
        "3. Likely impacted apps, cycles, runs, or dependencies.",
        "4. Recommended next actions, ordered by safety.",
        "5. Any action that needs approval, routed through Assistant approvals.",
        "\nHere is the live diagnostics brief from the server:",
        briefData.markdown
      ].join("\n");

      window.dispatchEvent(new CustomEvent("agent-assist-request", {
        detail: {
          prompt,
          context: {
            page: "health-command-center",
            alertCount,
            eventCount,
            dependencyCount,
            hasCriticalSignals,
            briefMarkdown: briefData.markdown,
            topAttentionItems: attentionItems.map(item => ({
              label: item.label,
              severity: item.severity,
              detail: item.detail,
            })),
          },
        },
      }));
    } catch (err) {
      console.error("[HealthOverview] Failed to fetch triage brief, falling back to static prompt:", err);
      const prompt = [
        "Create a Health triage brief for this page.",
        `Open alerts: ${alertCount}`,
        `Recent events loaded: ${eventCount}`,
        `Circuit breakers loaded: ${dependencyCount}`,
        `Platform state: ${hasCriticalSignals ? "Watch" : "Nominal"}`,
        "Use this structure:",
        "1. Current severity and why.",
        "2. What changed recently.",
        "3. Likely impacted apps, cycles, runs, or dependencies.",
        "4. Recommended next actions, ordered by safety.",
        "5. Any action that needs approval, routed through Assistant approvals.",
      ].join("\n");

      window.dispatchEvent(new CustomEvent("agent-assist-request", {
        detail: {
          prompt,
          context: {
            page: "health-command-center",
            alertCount,
            eventCount,
            dependencyCount,
            hasCriticalSignals,
            topAttentionItems: attentionItems.map(item => ({
              label: item.label,
              severity: item.severity,
              detail: item.detail,
            })),
          },
        },
      }));
    }
  };

  const refreshAll = () => {
    alertsQuery.refetch();
    eventsQuery.refetch();
    infraQuery.refetch();
  };

  const stats = [
    {
      label: "Open alerts",
      value: alertCount,
      helper: alertCount > 0 ? "needs triage" : "clear",
      icon: Bell,
      tone: alertCount > 0 ? "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "Recent events",
      value: eventCount,
      helper: "activity records",
      icon: FileSearch,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "Dependencies",
      value: dependencyCount,
      helper: "infra checks",
      icon: Server,
      tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    },
    {
      label: "Platform state",
      value: hasCriticalSignals ? "Watch" : "Nominal",
      helper: hasCriticalSignals ? "attention required" : "no active blockers",
      icon: HeartPulse,
      tone: hasCriticalSignals ? "border-orange-400/20 bg-orange-500/10 text-orange-700 dark:text-orange-300" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Health / Observability</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Health
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Triage active issues, inspect runtime signals, and understand platform health from one command surface.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={refreshAll}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4 text-cyan-700 dark:text-cyan-300", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              onClick={openAssistantBrief}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Assistant Brief
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="border-foreground/10 bg-foreground/[0.04]">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                    {loading ? (
                      <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
                    ) : (
                      <p className="mt-1 text-3xl font-black text-foreground">{stat.value}</p>
                    )}
                    <p className="mt-1 text-xs font-medium text-muted-foreground">{stat.helper}</p>
                  </div>
                  <div className={cn("rounded-xl border p-3", stat.tone)}>
                    <Icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="border-b border-foreground/10 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
                    <HeartPulse className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                    Needs Attention
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Prioritized issues, dependency failures, and latest operational signals.
                  </CardDescription>
                </div>
                <Badge variant="outline" className={cn(
                  "w-fit text-[10px] font-black uppercase",
                  hasCriticalSignals ? "border-orange-400/30 text-orange-700 dark:text-orange-300" : "border-emerald-400/30 text-emerald-700 dark:text-emerald-300"
                )}>
                  {hasCriticalSignals ? "Watch" : "Nominal"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-4">
              {loading ? (
                Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 rounded-xl bg-foreground/10" />)
              ) : attentionItems.length === 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-2.5 text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-black uppercase tracking-tight text-foreground">No active health blockers</p>
                      <p className="text-xs font-medium text-muted-foreground">
                        {dependencyCount} dependencies checked. {lastUpdated ? `Last updated ${formatUpdatedAt(new Date(lastUpdated))}.` : "Waiting for first refresh."}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setLocation("/health/events")}
                    className="hidden h-10 rounded-xl border-foreground/10 bg-background/20 px-4 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08] md:inline-flex"
                  >
                    View Events
                  </Button>
                </div>
              ) : (
                attentionItems.map((item) => {
                  const Icon = item.icon;
                  const tone = item.severity === "critical"
                    ? "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    : item.severity === "warning"
                      ? "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
                  return (
                    <div key={item.id} className="group flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background/20 p-3 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.05]">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={cn("shrink-0 rounded-xl border p-2.5", tone)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={cn("shrink-0 border-foreground/10 text-[9px] font-black uppercase", item.severity === "critical" ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground")}>
                                {item.severity}
                              </Badge>
                              <p className="truncate text-sm font-bold text-foreground">{item.label}</p>
                            </div>
                            <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{item.detail}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {item.alertId !== undefined && (
                            <Button
                              variant="outline"
                              onClick={() => acknowledgeAlert.mutate(item.alertId!)}
                              disabled={acknowledgeAlert.isPending}
                              className="hidden h-8 rounded-lg border-foreground/10 bg-foreground/[0.03] px-3 text-[9px] font-black uppercase text-foreground hover:bg-foreground/[0.08] md:inline-flex"
                            >
                              Acknowledge
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            onClick={() => setLocation(item.href)}
                            className="h-8 rounded-lg px-2 text-[10px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-300 hover:bg-foreground/[0.08] hover:text-cyan-700 dark:text-cyan-200"
                          >
                            <span className="hidden md:inline">{item.action}</span>
                            <ArrowRight className="ml-0 h-4 w-4 transition-transform group-hover:translate-x-1 md:ml-2" />
                          </Button>
                        </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="border-cyan-400/20 bg-cyan-500/[0.05]">
            <CardHeader className="border-b border-foreground/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
                    <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                    Assistant Triage
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Route findings, approval-worthy fixes, and next actions through the Assistant.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="border-cyan-400/30 text-[10px] font-black uppercase text-cyan-700 dark:text-cyan-300">
                  Brief-ready
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="rounded-xl border border-foreground/10 bg-background/20 p-4">
                <p className="text-sm font-black uppercase tracking-tight text-foreground">
                  {hasCriticalSignals ? "Ask Assistant to triage active risk" : "Ask Assistant for a health brief"}
                </p>
                <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">
                  Includes alert count, recent event volume, dependency state, and the top attention queue.
                </p>
              </div>
              <Button
                onClick={openAssistantBrief}
                className="h-11 w-full rounded-xl bg-foreground text-[10px] font-black uppercase text-background hover:bg-muted"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Open Assistant Brief
              </Button>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {lastUpdated ? `Last updated ${formatUpdatedAt(new Date(lastUpdated))}` : "Waiting for telemetry"}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-cyan-400/20 bg-cyan-500/[0.05]">
          <CardHeader className="border-b border-foreground/10 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
                  <HeartPulse className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                  Operator Triage
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Start with active breakage, then move to monitoring gaps and live telemetry.
                </CardDescription>
              </div>
              <Badge variant="outline" className="w-fit border-cyan-400/30 text-[10px] font-black uppercase text-cyan-700 dark:text-cyan-300">
                Risk-first routing
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
            {[
              {
                label: "Broken now",
                helper: "Review alerts and incidents first when work is blocked.",
                action: "Open Alerts",
                href: "/health/alerts",
                icon: AlertTriangle,
                tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
              },
              {
                label: "Needs watching",
                helper: "Use monitoring and infra health to catch degraded systems.",
                action: "Open Monitoring",
                href: "/health/monitoring",
                icon: Monitor,
                tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
              },
              {
                label: "What changed",
                helper: "Use events and pulse when you need recent movement.",
                action: "Open Events",
                href: "/health/events",
                icon: FileSearch,
                tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              },
            ].map(item => {
              const Icon = item.icon;
              return (
                <Link key={item.label} href={item.href}>
                  <div className="group h-full rounded-xl border border-foreground/10 bg-background/20 p-4 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.06]">
                    <div className="flex items-start justify-between gap-3">
                      <div className={cn("rounded-xl border p-2.5", item.tone)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                    </div>
                    <h2 className="mt-4 text-sm font-black uppercase tracking-tight text-foreground">{item.label}</h2>
                    <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{item.helper}</p>
                    <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-300">{item.action}</p>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {healthLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <Card className="group h-full cursor-pointer border-foreground/10 bg-foreground/[0.04] transition-colors hover:border-foreground/20 hover:bg-foreground/[0.07]">
                  <CardContent className="flex h-full flex-col gap-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className={cn("rounded-xl border p-3", item.tone)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                    </div>
                    <div>
                      <h2 className="text-sm font-black uppercase tracking-tight text-foreground">{item.title}</h2>
                      <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{item.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
