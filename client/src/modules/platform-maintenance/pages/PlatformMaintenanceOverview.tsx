import React from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ArrowRight,
  BookMarked,
  Camera,
  Layers,
  Network,
  Shield,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { cn } from "@/lib/utils";

type MaintenanceLink = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

const maintenanceLinks: MaintenanceLink[] = [
  {
    title: "Snapshots",
    description: "Workspace, output, schema, and runtime snapshots used for recovery and comparison.",
    href: "/platform-maintenance/snapshots",
    icon: Camera,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Documentation",
    description: "Autonomous documentation coverage, freshness, generation, and maintenance state.",
    href: "/platform-maintenance/documentation",
    icon: BookMarked,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "Knowledge Packs",
    description: "Organization-scoped governed knowledge, compiled controls, certification state, and decision evidence.",
    href: "/platform-maintenance/knowledge-packs",
    icon: Shield,
    tone: "border-indigo-400/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  {
    title: "Software Audit",
    description: "Dependency health, security alerts, package drift, and remediation signals.",
    href: "/platform-maintenance/software-audit",
    icon: Shield,
    tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  {
    title: "System Evolution",
    description: "Platform self-improvement, rollout waves, and governed evolution activity.",
    href: "/platform-maintenance/evolution",
    icon: Activity,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    title: "Autoresearch",
    description: "Scheduled research loops, shadow experiments, and autonomous capability learning.",
    href: "/platform-maintenance/autoresearch",
    icon: TrendingUp,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    title: "System Graph",
    description: "Internal platform topology, blast radius, dependencies, and architectural relationships.",
    href: "/platform-maintenance/system-graph",
    icon: Network,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Component Gallery",
    description: "Indexed UI components and blueprints available for dynamic app synthesis, with live previews.",
    href: "/platform-maintenance/components",
    icon: Layers,
    tone: "border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  },
];

export default function PlatformMaintenanceOverview() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-violet-300 shadow-[0_0_16px_rgba(196,181,253,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300">Platform Maintenance</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Platform Maintenance
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Internal platform care: snapshots, documentation, software audit, system evolution, autoresearch, and graph topology.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation("/platform-maintenance/snapshots")}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <Camera className="mr-2 h-4 w-4 text-cyan-700 dark:text-cyan-300" />
              Snapshots
            </Button>
            <Button
              onClick={() => setLocation("/platform-maintenance/software-audit")}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              <Shield className="mr-2 h-4 w-4" />
              Software Audit
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {[
            { label: "Preserve", detail: "snapshots and recovery points", icon: Camera, tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
            { label: "Document", detail: "coverage and freshness loops", icon: BookMarked, tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
            { label: "Evolve", detail: "audit, graph, and research signals", icon: Activity, tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
          ].map((signal) => {
            const Icon = signal.icon;
            return (
              <Card key={signal.label} className="border-foreground/10 bg-foreground/[0.04]">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{signal.label}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{signal.detail}</p>
                  </div>
                  <div className={cn("rounded-xl border p-3", signal.tone)}>
                    <Icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {maintenanceLinks.map((item) => {
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

        <Card className="border-foreground/10 bg-foreground/[0.04]">
          <CardHeader className="border-b border-foreground/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-black uppercase tracking-widest text-foreground">Maintenance Boundary</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">Internal platform care, separate from tenant/account administration.</CardDescription>
              </div>
              <Badge variant="outline" className="border-foreground/10 text-[10px] font-black uppercase text-muted-foreground">
                Internal
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
            {[
              "Keep account settings in Account & Admin.",
              "Keep build and deployment surfaces in Apps & Forge.",
              "Keep platform upkeep and evolution here.",
            ].map((message) => (
              <div key={message} className="rounded-xl border border-foreground/10 bg-background/20 p-3 text-xs font-semibold leading-5 text-muted-foreground">
                {message}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
