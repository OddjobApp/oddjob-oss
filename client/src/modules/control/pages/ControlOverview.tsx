import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Code2,
  GitBranch,
  Inbox,
  Landmark,
  Fingerprint,
  type LucideIcon,
  Play,
  ShieldCheck,
  Users,
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

type GovernorStats = {
  activePolicies?: number;
  recentViolations?: number;
  pendingApprovals?: number;
  systemHealth?: string;
  totalPolicies?: number;
};

type QueueItem = {
  id: number | string;
  status?: string;
  recoveryOptions?: unknown[];
};

type AgentIdentity = {
  id: string;
  status: string;
  riskLevel: string;
};

type GovernanceReportingSummary = {
  generatedAt: string;
  metrics: {
    identities: number;
    highRiskIdentities: number;
    suspendedIdentities: number;
    staleReviews: number;
    deniedActions: number;
    approvalRequired: number;
    recentEvents: number;
  };
  topPolicyCodes: Array<{ code: string; count: number }>;
  topDeniedActions: Array<{
    id: number;
    agentId: string;
    tool: string;
    action: string;
    resource: string;
    riskLevel: string;
    policyCodes: string[];
    createdAt: string;
  }>;
  reviewQueue: Array<{
    id: string;
    agentId: string;
    displayName: string;
    riskLevel: string;
    status: string;
    lastReviewedAt?: string | null;
  }>;
};

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function asItems(data: any): QueueItem[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

const controlLinks = [
  {
    title: "Decision Inbox",
    description: "Approvals, recovery choices, and human-in-the-loop clearances.",
    href: "/control/decisions",
    icon: Inbox,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    title: "Agent Identities",
    description: "Manage agent principals, risk, grants, and suspend/reactivate controls.",
    href: "/control/agent-identities",
    icon: Fingerprint,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Policies",
    description: "Rules for budgets, tool access, approvals, redaction, and overrides.",
    href: "/control/policies",
    icon: ShieldCheck,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "Simulator",
    description: "Dry-run governance resolution before work reaches production.",
    href: "/control/simulator",
    icon: Play,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Status",
    description: "Policy health, recent violations, and active governance pressure.",
    href: "/control/status",
    icon: Activity,
    tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  {
    title: "Board Room",
    description: "Institutional oversight, resource governance, and audit posture.",
    href: "/control/board-room",
    icon: Landmark,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    title: "Resolution Map",
    description: "Visualize how governance rules cascade across work.",
    href: "/control/visualizer",
    icon: GitBranch,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
];

const clearanceFlow: { title: string; detail: string; icon: LucideIcon }[] = [
  {
    title: "Policy",
    detail: "Rules resolve against the work context before action starts.",
    icon: ShieldCheck,
  },
  {
    title: "Decision",
    detail: "Humans clear high-risk requests and recovery options.",
    icon: Users,
  },
  {
    title: "Simulation",
    detail: "Operators test constraints before changing production rules.",
    icon: Play,
  },
  {
    title: "Audit",
    detail: "Board-level oversight tracks spend, violations, and decommissions.",
    icon: Landmark,
  },
];

export default function ControlOverview() {
  const [, setLocation] = useLocation();

  const statsQuery = useQuery<GovernorStats>({
    queryKey: ["/api/governor/stats", "control-overview"],
    queryFn: () => fetchJson("/api/governor/stats"),
  });

  const approvalsQuery = useQuery({
    queryKey: ["/api/approvals", "control-overview"],
    queryFn: () => fetchJson("/api/approvals"),
  });

  const rescueQuery = useQuery({
    queryKey: ["/api/rescue/sessions", "control-overview"],
    queryFn: () => fetchJson("/api/rescue/sessions"),
  });

  const identitiesQuery = useQuery<{ identities: AgentIdentity[]; count: number }>({
    queryKey: ["/api/governor/agent-identities", "control-overview"],
    queryFn: () => fetchJson("/api/governor/agent-identities"),
  });

  const reportingQuery = useQuery<GovernanceReportingSummary>({
    queryKey: ["/api/governor/agent-governance/reporting-summary", "control-overview"],
    queryFn: () => fetchJson("/api/governor/agent-governance/reporting-summary"),
  });

  const stats = statsQuery.data || {};
  const reporting = reportingQuery.data;
  const approvals = asItems(approvalsQuery.data);
  const rescueSessions = asItems(rescueQuery.data);
  const requestedRescue = rescueSessions.filter((item) => String(item.status || "").toUpperCase() === "REQUESTED");
  const identities = identitiesQuery.data?.identities ?? [];
  const suspendedIdentities = identities.filter((identity) => ["suspended", "revoked"].includes(identity.status)).length;
  const highRiskIdentities = identities.filter((identity) => ["high", "critical"].includes(identity.riskLevel)).length;
  const isLoading = statsQuery.isLoading || approvalsQuery.isLoading || rescueQuery.isLoading || identitiesQuery.isLoading || reportingQuery.isLoading;

  const statCards = [
    {
      label: "Pending decisions",
      value: stats.pendingApprovals ?? approvals.length,
      helper: `${requestedRescue.length} recovery queues`,
      icon: Inbox,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "Active policies",
      value: stats.activePolicies ?? 0,
      helper: `${stats.totalPolicies ?? 0} total policies`,
      icon: ShieldCheck,
      tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "Violations",
      value: reporting?.metrics.deniedActions ?? stats.recentViolations ?? 0,
      helper: `${reporting?.metrics.approvalRequired ?? 0} approval-gated`,
      icon: Activity,
      tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    },
    {
      label: "Agent identities",
      value: identitiesQuery.data?.count ?? identities.length,
      helper: `${highRiskIdentities} high risk Â· ${suspendedIdentities} suspended`,
      icon: Fingerprint,
      tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Control</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Control
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Govern autonomous work with one surface for decisions, policies, simulations, and oversight.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation("/control/simulator")}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <Code2 className="mr-2 h-4 w-4 text-blue-700 dark:text-blue-300" />
              Simulate
            </Button>
            <Button
              onClick={() => setLocation("/control/decisions")}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              <Inbox className="mr-2 h-4 w-4" />
              Review Queue
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
                      <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
                    ) : (
                      <p className="mt-1 text-3xl font-black text-foreground">{stat.value}</p>
                    )}
                    <p className="mt-1 text-xs font-medium text-muted-foreground">{stat.helper}</p>
                  </div>
                  <div className={cn("rounded-2xl border p-3", stat.tone)}>
                    <Icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <Card className="border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="border-b border-foreground/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-black uppercase tracking-tight text-foreground">Governance Reporting</CardTitle>
                  <CardDescription className="text-muted-foreground">Risk posture from identities and recent agent decisions.</CardDescription>
                </div>
                <Badge variant="outline" className="border-foreground/10 bg-foreground/[0.03] text-[10px] font-black uppercase text-muted-foreground">
                  {reporting?.metrics.recentEvents ?? 0} events
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 p-4">
              {[
                ["Stale reviews", reporting?.metrics.staleReviews ?? 0],
                ["Denied actions", reporting?.metrics.deniedActions ?? 0],
                ["Approval gates", reporting?.metrics.approvalRequired ?? 0],
                ["High risk", reporting?.metrics.highRiskIdentities ?? highRiskIdentities],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-foreground/10 bg-background/20 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                  {isLoading ? (
                    <Skeleton className="mt-2 h-7 w-14 bg-foreground/10" />
                  ) : (
                    <p className="mt-1 text-2xl font-black text-foreground">{value}</p>
                  )}
                </div>
              ))}
              <div className="col-span-2 rounded-xl border border-foreground/10 bg-background/20 p-3">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Top Policy Codes</p>
                <div className="flex flex-wrap gap-2">
                  {(reporting?.topPolicyCodes ?? []).map((item) => (
                    <Badge key={item.code} variant="outline" className="border-foreground/10 bg-foreground/[0.04] text-[10px] font-black uppercase text-foreground">
                      {item.code} ({item.count})
                    </Badge>
                  ))}
                  {!isLoading && (reporting?.topPolicyCodes ?? []).length === 0 && (
                    <span className="text-xs text-muted-foreground">No policy pressure recorded.</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="border-b border-foreground/10">
              <CardTitle className="text-base font-black uppercase tracking-tight text-foreground">Attention Queue</CardTitle>
              <CardDescription className="text-muted-foreground">Identities and actions that deserve operator review.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Stale Reviews</p>
                {(reporting?.reviewQueue ?? []).slice(0, 4).map((identity) => (
                  <button
                    key={identity.id}
                    type="button"
                    onClick={() => setLocation("/control/agent-identities")}
                    className="w-full rounded-xl border border-foreground/10 bg-background/20 p-3 text-left transition-colors hover:bg-foreground/[0.06]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-bold text-foreground">{identity.displayName}</span>
                      <Badge variant="outline" className={cn("shrink-0 text-[10px] font-black uppercase", identity.riskLevel === "high" || identity.riskLevel === "critical" ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
                        {identity.riskLevel}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{identity.agentId}</p>
                  </button>
                ))}
                {!isLoading && (reporting?.reviewQueue ?? []).length === 0 && (
                  <div className="rounded-xl border border-foreground/10 bg-background/20 p-3 text-xs text-muted-foreground">No stale reviews.</div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recent Denials</p>
                {(reporting?.topDeniedActions ?? []).slice(0, 4).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setLocation("/control/agent-identities")}
                    className="w-full rounded-xl border border-foreground/10 bg-background/20 p-3 text-left transition-colors hover:bg-foreground/[0.06]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-sm font-bold text-foreground">{event.tool}.{event.action}</span>
                      <Badge variant="outline" className="shrink-0 border-rose-500/30 bg-rose-500/10 text-[10px] font-black uppercase text-rose-700 dark:text-rose-300">
                        denied
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{event.agentId}</p>
                  </button>
                ))}
                {!isLoading && (reporting?.topDeniedActions ?? []).length === 0 && (
                  <div className="rounded-xl border border-foreground/10 bg-background/20 p-3 text-xs text-muted-foreground">No recent denials.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <Card className="border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="border-b border-foreground/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-black uppercase tracking-tight text-foreground">Control Surfaces</CardTitle>
                  <CardDescription className="text-muted-foreground">Governance tools grouped by decision workflow.</CardDescription>
                </div>
                <Badge variant="outline" className="border-foreground/10 bg-foreground/[0.03] text-[10px] font-black uppercase text-muted-foreground">
                  {controlLinks.length} surfaces
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
              {controlLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <Card className="group h-full border-foreground/10 bg-background/20 transition-colors hover:bg-foreground/[0.06]">
                      <CardContent className="flex h-full flex-col gap-4 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className={cn("rounded-2xl border p-3", item.tone)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-tight text-foreground">{item.title}</h3>
                          <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{item.description}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="border-b border-foreground/10">
              <CardTitle className="text-base font-black uppercase tracking-tight text-foreground">Clearance Flow</CardTitle>
              <CardDescription className="text-muted-foreground">The control loop for governed autonomous work.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {clearanceFlow.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex gap-3 rounded-xl border border-foreground/10 bg-background/20 p-3">
                    <Icon className="mt-0.5 h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-foreground">{item.title}</p>
                      <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
