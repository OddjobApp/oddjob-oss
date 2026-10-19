import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { DynamicUIRenderer } from "@/components/dynamic-ui/DynamicUIRenderer";
import { TokenizedUISchema } from "@/components/dynamic-ui/types";
import {
  ArrowRight,
  Bot,
  ClipboardList,
  DollarSign,
  FileClock,
  Hammer,
  Landmark,
  Settings,
  Shield,
  Sparkles,
  Telescope,
  Wrench,
  Zap,
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

type HubLink = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function asItems(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.apps)) return data.apps;
  if (Array.isArray(data?.deployments)) return data.deployments;
  if (Array.isArray(data?.jobs)) return data.jobs;
  return [];
}

function formatCount(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value.trim()) return value;
  return "0";
}

const primaryLinks: HubLink[] = [
  {
    title: "App Arsenal",
    description: "Installed apps, marketplace blueprints, deployments, and app detail pages.",
    href: "/armory/apps",
    icon: Bot,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Forge Studio (CREW)",
    description: "Autonomous App Forge Studio in CREW — Deliberate with your agent squad and live-assemble applications.",
    href: "/workspace/chat?studio=forge",
    icon: Hammer,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    title: "Org Forge",
    description: "Synthesize operating models, blueprints, forms, and app-backed org structure.",
    href: "/armory/org-forge",
    icon: Shield,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "Forms",
    description: "Reusable human-input forms for approvals, HIL steps, and generated workflows.",
    href: "/armory/forms",
    icon: ClipboardList,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    title: "Forge History",
    description: "Past build jobs, resumable runs, approvals, and generated app traces.",
    href: "/armory/forge/history",
    icon: FileClock,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Forge Settings",
    description: "Governance defaults, orchestration standards, and forge runtime preferences.",
    href: "/armory/forge/settings",
    icon: Settings,
    tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
];

const secondaryLinks: HubLink[] = [
  {
    title: "System X-Ray",
    description: "Inspect app, mission, and system composition.",
    href: "/armory/x-ray",
    icon: Zap,
    tone: "border-yellow-400/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  },
  {
    title: "Identity Bridge",
    description: "Prospecting and identity workflows connected to generated apps.",
    href: "/armory/identity-bridge",
    icon: Telescope,
    tone: "border-sky-400/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  {
    title: "App Earnings",
    description: "Developer earnings, usage, and app monetization signals.",
    href: "/armory/earnings",
    icon: DollarSign,
    tone: "border-lime-400/20 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  },
];

export default function AppsForgeOverview() {
  const [, setLocation] = useLocation();

  const fleetQuery = useQuery({
    queryKey: ["/api/apps/fleet", "apps-forge-overview"],
    queryFn: () => fetchJson("/api/apps/fleet"),
    retry: 1,
  });

  const marketQuery = useQuery({
    queryKey: ["/api/apps/market", "apps-forge-overview"],
    queryFn: () => fetchJson("/api/apps/market"),
    retry: 1,
  });

  const forgeHistoryQuery = useQuery({
    queryKey: ["/api/apps/forge/history", "apps-forge-overview"],
    queryFn: () => fetchJson("/api/apps/forge/history"),
    retry: 1,
  });

  const formsQuery = useQuery({
    queryKey: ["/api/forms", "apps-forge-overview"],
    queryFn: () => fetchJson("/api/forms"),
    retry: 1,
  });

  const fleet = asItems(fleetQuery.data);
  const market = asItems(marketQuery.data);
  const forgeHistory = asItems(forgeHistoryQuery.data);
  const forms = asItems(formsQuery.data);
  const isLoading = fleetQuery.isLoading || marketQuery.isLoading || forgeHistoryQuery.isLoading || formsQuery.isLoading;

  const stats = [
    {
      label: "Installed apps",
      value: fleet.length,
      helper: `${market.length} marketplace entries`,
      icon: Bot,
      tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    },
    {
      label: "Forge runs",
      value: forgeHistory.length,
      helper: "recent build history",
      icon: Hammer,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "Forms",
      value: forms.length,
      helper: "human-input assets",
      icon: ClipboardList,
      tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
    {
      label: "Build surface",
      value: "Unified",
      helper: "App Forge + Intelligence Forge",
      icon: Sparkles,
      tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">Apps & Forge</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Apps & Forge
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Build, install, govern, and reuse apps, forms, and forge-generated operating assets from one surface.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation("/armory/apps")}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <Bot className="mr-2 h-4 w-4 text-blue-700 dark:text-blue-300" />
              App Arsenal
            </Button>
            <Button
              onClick={() => { window.location.href = "/workspace/chat?studio=forge"; }}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              <Hammer className="mr-2 h-4 w-4" />
              Open Forge in CREW
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
                    {isLoading ? (
                      <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
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
          <Card className="border-foreground/10 bg-foreground/[0.04]">
            <CardHeader className="border-b border-foreground/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-black uppercase tracking-tight text-foreground">Build Surfaces</CardTitle>
                  <CardDescription className="text-muted-foreground">The app and forge tools that used to be split across Armory, Tactics, and System.</CardDescription>
                </div>
                <Badge variant="outline" className="border-foreground/10 bg-foreground/[0.03] text-[10px] font-black uppercase text-muted-foreground">
                  {primaryLinks.length} tools
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
              {primaryLinks.map((item) => {
                const Icon = item.icon;
                const isExternal = item.href.startsWith('/workspace');
                const cardEl = (
                  <Card className="group h-full cursor-pointer border-foreground/10 bg-background/20 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.06]">
                    <CardContent className="flex h-full flex-col gap-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className={cn("rounded-xl border p-3", item.tone)}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-black uppercase tracking-tight text-foreground">{item.title}</h2>
                          {isExternal && (
                            <Badge variant="outline" className="text-[9px] font-mono border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                              CREW Studio
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{item.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                );

                if (isExternal) {
                  return (
                    <a key={item.href} href={item.href}>
                      {cardEl}
                    </a>
                  );
                }

                return (
                  <Link key={item.href} href={item.href}>
                    {cardEl}
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-foreground/10 bg-foreground/[0.04]">
              <CardHeader className="border-b border-foreground/10 p-4">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-foreground">Forge Loop</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">How the consolidated area fits together.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {[
                  { title: "Design", detail: "Use forms, org context, and app requirements as inputs.", icon: ClipboardList },
                  { title: "Build", detail: "Forge generates app code, architecture, and approvals.", icon: Wrench },
                  { title: "Deploy", detail: "App Arsenal tracks installed apps and live deployments.", icon: Bot },
                  { title: "Govern", detail: "Settings and history preserve standards, provenance, and replay.", icon: Landmark },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="flex gap-3 rounded-xl border border-foreground/10 bg-background/20 p-3">
                      <Icon className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" />
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-foreground">{item.title}</p>
                        <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{item.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-3">
              {secondaryLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div className="group flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.04] p-4 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.07]">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={cn("shrink-0 rounded-xl border p-2", item.tone)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase tracking-tight text-foreground">{item.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs font-medium text-muted-foreground">{item.description}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tokenized UI Phase 2 Demonstration Panel */}
        <div className="mt-2">
          <Card className="border-foreground/10 bg-foreground/[0.04] overflow-hidden">
            <CardHeader className="border-b border-foreground/10 p-4">
              <CardTitle className="text-base font-black uppercase tracking-tight text-foreground">
                Tokenized UI Architecture (Phase 2 Preview)
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                A live demonstration of the dynamic layout engine with reactive query binding and human-in-the-loop actions.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <DynamicUIRenderer schema={demoSchema} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const demoSchema: TokenizedUISchema = {
  version: "1.2.0",
  id: "soc-incident-deck",
  title: "Oddjob Security Operations Deck (Selected: {{state.selectedApp}})",
  theme: {
    colors: {
      brand: "#a855f7",
      background: "rgba(10, 10, 15, 0.4)",
      surface: "rgba(30, 30, 45, 0.45)",
      border: "rgba(168, 85, 247, 0.2)"
    },
    borderRadius: {
      card: "1rem",
      button: "0.5rem"
    }
  },
  queries: {
    fetchFleet: {
      endpoint: "/api/apps/fleet",
      method: "GET"
    }
  },
  state: {
    selectedApp: "",
    remediationNote: ""
  },
  layout: {
    type: "grid",
    children: [
      {
        id: "stat-1",
        type: "StatCard",
        gridSpan: { md: 4 },
        props: {
          label: "Active Fleet Applications",
          value: "{{queries.fetchFleet.data.length}}",
          change: "Operational",
          changeType: "positive"
        }
      },
      {
        id: "stat-2",
        type: "StatCard",
        gridSpan: { md: 4 },
        props: {
          label: "Average Response Time",
          value: "4.2m",
          change: "0.8m faster",
          changeType: "positive"
        }
      },
      {
        id: "stat-3",
        type: "StatCard",
        gridSpan: { md: 4 },
        props: {
          label: "Compliance Violations",
          value: "0",
          change: "No violations",
          changeType: "positive"
        }
      },
      {
        id: "card-incident-list",
        type: "Card",
        gridSpan: { md: 8 },
        props: {
          title: "App Fleet Catalog (Click row to select)",
          description: "Live applications running on the Oddjob cluster."
        },
        children: [
          {
            id: "incident-table",
            type: "DataTable",
            props: {
              columns: [
                { header: "App Name", accessor: "name" },
                { header: "Deployment Port", accessor: "port", font: "mono" },
                { header: "Provenance Status", accessor: "status", badge: true }
              ],
              data: "{{queries.fetchFleet.data}}",
              onRowClick: {
                action: "setState",
                payload: {
                  selectedApp: "{{event.row.name}}"
                }
              }
            }
          }
        ]
      },
      {
        id: "card-action-center",
        type: "Card",
        gridSpan: { md: 4 },
        props: {
          title: "Override & Dispatch",
          description: "Submit custom recovery overrides directly to execution workers."
        },
        children: [
          {
            id: "target-override",
            type: "FormInput",
            props: {
              label: "Target Application Selected",
              placeholder: "Click a row or type...",
              bindToState: "selectedApp"
            }
          },
          {
            id: "override-reason",
            type: "FormTextArea",
            props: {
              label: "Operator Remediation Note",
              placeholder: "Describe the remediation action...",
              bindToState: "remediationNote"
            }
          },
          {
            id: "dispatch-btn",
            type: "ActionButton",
            props: {
              label: "Trigger Automated Rebuild",
              disabled: "{{!state.selectedApp}}",
              onClick: {
                action: "dispatchApi",
                method: "POST",
                endpoint: "/api/apps/rebuild",
                body: {
                  appName: "{{state.selectedApp}}",
                  note: "{{state.remediationNote}}"
                },
                requiresApproval: true,
                approvalMessage: "Are you sure you want to trigger an automated rebuild of application {{state.selectedApp}}?"
              }
            }
          }
        ]
      }
    ]
  }
};
