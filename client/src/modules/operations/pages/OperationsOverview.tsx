import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Activity,
  Bot,
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  ListChecks,
  Network,
  Play,
  Plus,
  Sparkles,
  Workflow,
  Hexagon,
  Code2,
  Puzzle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AttentionQueue } from "../components/AttentionQueue";

type WorkItem = {
  id: number | string;
  name?: string;
  title?: string;
  status?: string;
  isActive?: boolean;
  createdAt?: string;
};

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function asItems(data: any): WorkItem[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.missions)) return data.missions;
  if (Array.isArray(data?.cycles)) return data.cycles;
  return [];
}

function isActiveItem(item: WorkItem) {
  const status = String(item.status || "").toLowerCase();
  return item.isActive === true || ["active", "running", "executing", "paused", "pending_approval"].includes(status);
}

function labelForStatus(item: WorkItem) {
  if (item.isActive && !item.status) return "Active";
  return String(item.status || "Ready").replace(/_/g, " ");
}

const hubLinks = [
  {
    title: "Missions",
    description: "Durable goals, team context, launch state, and run links.",
    href: "/operations/missions",
    icon: Network,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Runs",
    description: "Recent execution activity, approvals, errors, and live trail.",
    href: "/operations/runs",
    icon: Activity,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "Agents",
    description: "Reusable workers, capabilities, run history, and publishing.",
    href: "/operations/agents",
    icon: Bot,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    title: "Workstreams",
    description: "Procedural pipelines, triggers, data flow, and executions.",
    href: "/operations/workstreams",
    icon: GitBranch,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    title: "Templates",
    description: "Reusable mission and workstream patterns.",
    href: "/operations/templates",
    icon: FileText,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Schedules",
    description: "Recurring rules and scheduled automations.",
    href: "/operations/schedules",
    icon: Calendar,
    tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  {
    title: "Cycles",
    description: "Higher-level programs composed of missions and workstreams.",
    href: "/operations/cycles",
    icon: Workflow,
    tone: "border-lime-400/20 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  },
  {
    title: "Spatial Command",
    description: "Eulerian H3 hexagonal analytics, geofences, and fleet dispatch.",
    href: "/operations/spatial",
    icon: Hexagon,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "SDLC Systems Analyst",
    description: "Autonomous codegen pipeline, verification loops, and quality gates.",
    href: "/pipeline/sessions",
    icon: Code2,
    tone: "border-purple-400/20 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  },
  {
    title: "Studio Marketplace",
    description: "Enable CREW studio add-ons for this organization.",
    href: "/operations/studio-marketplace",
    icon: Puzzle,
    tone: "border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  },
];

const startOptions = [
  {
    title: "Goal",
    detail: "Create a governed mission.",
    href: "/operations/missions/new",
    icon: Network,
  },
  {
    title: "Template",
    detail: "Instantiate a proven pattern.",
    href: "/operations/templates",
    icon: Sparkles,
  },
  {
    title: "Workstream",
    detail: "Build a procedural pipeline.",
    href: "/operations/workstreams/new",
    icon: GitBranch,
  },
  {
    title: "Agent",
    detail: "Create a reusable worker.",
    href: "/operations/agents/new",
    icon: Bot,
  },
  {
    title: "Schedule",
    detail: "Automate recurring work.",
    href: "/operations/schedules/automations",
    icon: Clock,
  },
  {
    title: "Spatial Geofence",
    detail: "Define H3 region boundaries.",
    href: "/operations/spatial",
    icon: Hexagon,
  },
  {
    title: "Codegen Session",
    detail: "Run autonomous SDLC loop.",
    href: "/pipeline/sessions",
    icon: Code2,
  },
];

export default function OperationsOverview() {
  const [, setLocation] = useLocation();
  const [startOpen, setStartOpen] = useState(false);

  const missionsQuery = useQuery({ queryKey: ["/api/missions", "operations-overview"], queryFn: () => fetchJson("/api/missions") });
  const agentsQuery = useQuery({ queryKey: ["/api/jobs", "operations-overview"], queryFn: () => fetchJson("/api/jobs") });
  const workstreamsQuery = useQuery({ queryKey: ["/api/pipelines", "operations-overview"], queryFn: () => fetchJson("/api/pipelines") });
  const schedulesQuery = useQuery({ queryKey: ["/api/scheduled-jobs", "operations-overview"], queryFn: () => fetchJson("/api/scheduled-jobs") });
  const cyclesQuery = useQuery({ queryKey: ["/api/cycles", "operations-overview"], queryFn: () => fetchJson("/api/cycles?limit=8&offset=0") });

  const missions = asItems(missionsQuery.data);
  const agents = asItems(agentsQuery.data);
  const workstreams = asItems(workstreamsQuery.data);
  const scheduled = asItems(schedulesQuery.data);
  const cycles = asItems(cyclesQuery.data);
  const loading = missionsQuery.isLoading || agentsQuery.isLoading || workstreamsQuery.isLoading || schedulesQuery.isLoading || cyclesQuery.isLoading;

  const recentWork = useMemo(() => {
    return [
      ...missions.slice(0, 5).map((item) => ({ ...item, kind: "Mission", href: `/operations/missions/${item.id}` })),
      ...cycles.slice(0, 3).map((item) => ({ ...item, kind: "Cycle", href: `/operations/cycles/${item.id}` })),
      ...workstreams.slice(0, 3).map((item) => ({ ...item, kind: "Workstream", href: `/operations/workstreams/${item.id}` })),
    ]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 8);
  }, [missions, cycles, workstreams]);

  const stats = [
    {
      label: "Active missions",
      value: missions.filter(isActiveItem).length,
      helper: `${missions.length} total`,
      icon: Network,
      tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    },
    {
      label: "Agents",
      value: agents.length,
      helper: "available workers",
      icon: Bot,
      tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
    {
      label: "Workstreams",
      value: workstreams.length,
      helper: `${workstreams.filter(isActiveItem).length} active`,
      icon: GitBranch,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "Scheduled",
      value: scheduled.filter(isActiveItem).length,
      helper: `${scheduled.length} automations`,
      icon: Calendar,
      tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_16px_rgba(59,130,246,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-primary">Operations</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Operations
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Create, staff, automate, and monitor autonomous work from one command surface.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation("/operations/runs")}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <ListChecks className="mr-2 h-4 w-4 text-emerald-700 dark:text-emerald-300" />
              Runs
            </Button>
            <Button
              onClick={() => setStartOpen(true)}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-foreground/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Start Work
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
                    {loading ? <Skeleton className="mt-2 h-8 w-16 bg-foreground/10" /> : <p className="mt-1 text-3xl font-black text-foreground">{stat.value}</p>}
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

        <AttentionQueue />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {hubLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link key={link.href} href={link.href}>
                  <Card className="group h-full cursor-pointer border-foreground/10 bg-foreground/[0.04] transition-colors hover:border-foreground/20 hover:bg-foreground/[0.07]">
                    <CardHeader className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className={cn("rounded-xl border p-3", link.tone)}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-black uppercase tracking-tight text-foreground">{link.title}</CardTitle>
                        <CardDescription className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{link.description}</CardDescription>
                      </div>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>

          <Card className="border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-black uppercase tracking-widest text-foreground">Recent Work</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">Latest missions, cycles, and workstreams.</CardDescription>
                </div>
                <Badge variant="outline" className="border-foreground/10 text-[10px] font-black uppercase text-muted-foreground">
                  Live
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              {loading ? (
                Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 rounded-xl bg-foreground/10" />)
              ) : recentWork.length === 0 ? (
                <div className="rounded-xl border border-dashed border-foreground/10 p-6 text-center text-sm text-muted-foreground">
                  No operational work has been created yet.
                </div>
              ) : (
                recentWork.map((item) => (
                  <Link key={`${item.kind}-${item.id}`} href={item.href}>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background/20 p-3 transition-colors hover:bg-foreground/[0.04]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="shrink-0 border-foreground/10 text-[9px] font-black uppercase text-muted-foreground">
                            {item.kind}
                          </Badge>
                          <span className="truncate text-sm font-bold text-foreground">{item.name || item.title || `${item.kind} #${item.id}`}</span>
                        </div>
                        <p className="mt-1 truncate text-xs font-medium capitalize text-muted-foreground">{labelForStatus(item)}</p>
                      </div>
                      <Play className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent className="border-foreground/10 bg-background text-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase italic tracking-tight">Start Work</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {startOptions.map((option) => {
              const Icon = option.icon;
              return (
                <Button
                  key={option.href}
                  variant="outline"
                  onClick={() => {
                    setStartOpen(false);
                    setLocation(option.href);
                  }}
                  className="h-auto justify-start gap-3 rounded-xl border-foreground/10 bg-foreground/[0.03] p-4 text-left hover:bg-foreground/[0.08]"
                >
                  <span className="rounded-lg border border-foreground/10 bg-background/30 p-2">
                    <Icon className="h-4 w-4 text-primary" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black uppercase text-foreground">{option.title}</span>
                    <span className="block text-xs font-medium normal-case text-muted-foreground">{option.detail}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
