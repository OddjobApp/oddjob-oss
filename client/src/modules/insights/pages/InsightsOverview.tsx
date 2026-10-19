import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Brain,
  DollarSign,
  FlaskConical,
  Gauge,
  LineChart,
  TrendingUp,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { cn } from "@/lib/utils";

type CostStats = {
  totalSpend?: number;
  orgBudget?: {
    currentMonthSpend?: number;
    monthlyBudget?: number;
  } | null;
  insights?: unknown[];
};

type ROIMetrics = {
  netSavings?: string;
  hoursSaved?: string;
  roiMultiplier?: string;
  periodOps?: number;
};

type ToolUsage = {
  toolName?: string;
  count?: number;
};

type BehavioralHealth = {
  status?: string;
  tier?: string;
  metrics?: Record<string, any>;
};

type PredictiveHealth = {
  status?: string;
  service_mode?: string;
};

type LinkItem = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
  badge?: string;
  experimental?: boolean;
};

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function asArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function formatCount(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value.trim()) return value;
  return "0";
}

function formatCurrency(value: unknown) {
  const amount = typeof value === "number" ? value : parseFloat(String(value || "0"));
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

const insightLinks: LinkItem[] = [
  {
    title: "ROI & Value",
    description: "Savings, time returned, automated work completed, and business value trends.",
    href: "/insights/roi",
    icon: TrendingUp,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "Cost Center",
    description: "Spend, budgets, model costs, active operations, and optimization alerts.",
    href: "/insights/costs",
    icon: DollarSign,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    title: "Tool Analytics",
    description: "Tool usage patterns and capability invocation frequency across agent runs.",
    href: "/insights/tools",
    icon: Wrench,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Agent Analytics",
    description: "Agent performance, cost efficiency, comparisons, and operational telemetry.",
    href: "/insights/agents",
    icon: Brain,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Scoring",
    description: "Behavioral models, live scores, signal inspection, and threshold visibility.",
    href: "/insights/scoring",
    icon: Activity,
    tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  {
    title: "Prediction Intelligence",
    description: "Experimental prediction evaluation, governance checks, and predictive monitoring.",
    href: "/insights/prediction",
    icon: FlaskConical,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    badge: "Advanced / Experimental",
    experimental: true,
  },
];

// Translate internal status codes into plain business language for the signal board.
const PREDICTION_STATUS_LABELS: Record<string, string> = {
  local_fallback: "Resilient (local)",
  cloud: "Advanced (cloud)",
  advanced: "Advanced",
  operational: "Operational",
  experimental: "Experimental",
  degraded: "Degraded",
  offline: "Offline",
  unknown: "Checking…",
};
function humanizePredictionStatus(s?: string | null): string {
  if (!s) return "Experimental";
  return PREDICTION_STATUS_LABELS[String(s).toLowerCase()]
    || String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function InsightsOverview() {
  const [, setLocation] = useLocation();

  const costQuery = useQuery<CostStats>({
    queryKey: ["/api/analytics/cost-dashboard", "insights-overview"],
    queryFn: () => fetchJson("/api/analytics/cost-dashboard"),
    retry: 1,
  });

  const roiQuery = useQuery<ROIMetrics>({
    queryKey: ["/api/analytics/roi", "insights-overview"],
    queryFn: () => fetchJson("/api/analytics/roi"),
    retry: 1,
  });

  const toolQuery = useQuery<ToolUsage[]>({
    queryKey: ["/api/agent/analytics/tools", "insights-overview"],
    queryFn: () => fetchJson("/api/agent/analytics/tools"),
    retry: 1,
  });

  const scoringModelsQuery = useQuery({
    queryKey: ["/api/behavioral/models", "insights-overview"],
    queryFn: () => fetchJson("/api/behavioral/models"),
    retry: 1,
  });

  const scoringHealthQuery = useQuery<BehavioralHealth>({
    queryKey: ["/api/behavioral/health", "insights-overview"],
    queryFn: () => fetchJson("/api/behavioral/health"),
    retry: 1,
  });

  const predictiveHealthQuery = useQuery<PredictiveHealth>({
    queryKey: ["/api/predictive/health", "insights-overview"],
    queryFn: () => fetchJson("/api/predictive/health"),
    retry: 1,
  });

  const cost = costQuery.data;
  const roi = roiQuery.data;
  const toolUsage = Array.isArray(toolQuery.data) ? toolQuery.data : [];
  const scoringModels = asArray(scoringModelsQuery.data);
  const scoringHealth = scoringHealthQuery.data || {};
  const predictiveHealth = predictiveHealthQuery.data || {};
  const isLoading =
    costQuery.isLoading ||
    roiQuery.isLoading ||
    toolQuery.isLoading ||
    scoringModelsQuery.isLoading ||
    scoringHealthQuery.isLoading ||
    predictiveHealthQuery.isLoading;

  const totalToolCalls = toolUsage.reduce((sum, item) => sum + (item.count || 0), 0);
  const currentSpend = cost?.orgBudget?.currentMonthSpend ?? cost?.totalSpend;

  const statCards = [
    {
      label: "Month spend",
      value: currentSpend == null ? "Unknown" : formatCurrency(currentSpend),
      helper: cost?.orgBudget?.monthlyBudget ? `${formatCurrency(cost.orgBudget.monthlyBudget)} monthly limit` : "cost dashboard",
      icon: DollarSign,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "ROI multiplier",
      value: roi?.roiMultiplier || "0x",
      helper: `${formatCurrency(roi?.netSavings)} net savings`,
      icon: TrendingUp,
      tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "Tool calls",
      value: totalToolCalls,
      helper: `${toolUsage.length} tools reporting`,
      icon: Wrench,
      tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    },
    {
      label: "Scoring models",
      value: scoringModels.length,
      helper: `health: ${scoringHealth.status || "unknown"}`,
      icon: Activity,
      tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Insights</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Insights
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                ROI, cost, tool telemetry, agent analytics, scoring, and advanced prediction intelligence from one command surface.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation("/insights/costs")}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <DollarSign className="mr-2 h-4 w-4 text-amber-700 dark:text-amber-300" />
              Costs
            </Button>
            <Button
              onClick={() => setLocation("/insights/roi")}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              <LineChart className="mr-2 h-4 w-4" />
              ROI
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="border-foreground/10 bg-foreground/[0.04]">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                    {isLoading ? (
                      <Skeleton className="mt-2 h-8 w-24 bg-foreground/10" />
                    ) : (
                      <p className="mt-1 text-3xl font-black text-foreground">{formatCount(stat.value)}</p>
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

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {insightLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <Card
                    className={cn(
                      "group h-full cursor-pointer border-foreground/10 bg-foreground/[0.04] transition-colors hover:border-foreground/20 hover:bg-foreground/[0.07]",
                      item.experimental && "border-violet-400/20 bg-violet-500/[0.06]"
                    )}
                  >
                    <CardContent className="flex h-full flex-col gap-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className={cn("rounded-xl border p-3", item.tone)}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex items-center gap-2">
                          {item.badge && (
                            <Badge variant="outline" className="border-violet-300/20 text-[10px] font-black uppercase text-violet-700 dark:text-violet-200">
                              {item.badge}
                            </Badge>
                          )}
                          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                        </div>
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

          <div className="space-y-4">
            <Card className="border-foreground/10 bg-foreground/[0.04]">
              <CardHeader className="border-b border-foreground/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm font-black uppercase tracking-widest text-foreground">Signal Board</CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">Current insight surface health.</CardDescription>
                  </div>
                  <Badge variant="outline" className="border-foreground/10 text-[10px] font-black uppercase text-muted-foreground">
                    Live
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {[
                  {
                    title: "Automated ops",
                    value: roi?.periodOps,
                    detail: "tasks counted in ROI",
                    icon: Gauge,
                  },
                  {
                    title: "Hours saved",
                    value: roi?.hoursSaved,
                    detail: "manual work diverted",
                    icon: BarChart3,
                  },
                  {
                    title: "Prediction status",
                    value: humanizePredictionStatus(predictiveHealth.status || predictiveHealth.service_mode),
                    detail: "advanced surface",
                    icon: FlaskConical,
                  },
                ].map((signal) => {
                  const Icon = signal.icon;
                  return (
                    <div key={signal.title} className="rounded-xl border border-foreground/10 bg-background/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{signal.title}</p>
                        </div>
                        {isLoading ? (
                          <Skeleton className="h-5 w-12 bg-foreground/10" />
                        ) : (
                          <span className="text-sm font-black text-foreground">{formatCount(signal.value)}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">{signal.detail}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="border-violet-400/20 bg-violet-500/[0.06]">
              <CardHeader className="p-4">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-violet-700 dark:text-violet-300" />
                  <CardTitle className="text-sm font-black uppercase tracking-widest text-foreground">Prediction Is Advanced</CardTitle>
                </div>
                <CardDescription className="text-xs leading-5 text-violet-100/70">
                  Keep prediction intelligence available for deeper diagnostics, but lead demos with ROI, cost, tools, agents, and scoring.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
