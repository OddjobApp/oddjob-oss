import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Database,
  Globe,
  Key,
  Network,
  PlugZap,
  Server,
  ShieldCheck,
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
import { useOrgContextOptional } from "@domain-ui/core/ui/hooks/use-org-context";
import { cn } from "@/lib/utils";

type LinkItem = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

type Credential = {
  id: number;
  type?: string;
};

type McpToken = {
  id: number;
  isActive?: boolean;
};

type SaaSConnector = {
  platform: string;
  status?: string;
  is_enabled?: boolean;
};

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function asArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.credentials)) return data.credentials;
  if (Array.isArray(data?.tokens)) return data.tokens;
  if (Array.isArray(data?.connectors)) return data.connectors;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

const connectionLinks: LinkItem[] = [
  {
    title: "Credentials",
    description: "API keys, OAuth clients, environment-backed secrets, and provider credentials.",
    href: "/connections/credentials",
    icon: Key,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Integrations",
    description: "External platform bridges, MCP server settings, and tool connectivity surfaces.",
    href: "/connections/integrations",
    icon: Network,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "MCP Tokens",
    description: "HTTP access tokens, scoped permissions, resource limits, and MCP access state.",
    href: "/connections/mcp-tokens",
    icon: Server,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    title: "SaaS Connectors",
    description: "Jira, Confluence, Slack, GitHub, Teams, Resend, sync config, and event workflows.",
    href: "/connections/saas",
    icon: PlugZap,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
];

const saasLinks: LinkItem[] = [
  {
    title: "Event Workflows",
    description: "Reactive workflows triggered by SaaS platform events.",
    href: "/connections/saas/workflows",
    icon: Globe,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Sync Config",
    description: "Bidirectional sync rules and schema-aware field mapping.",
    href: "/connections/saas/sync-config",
    icon: Database,
    tone: "border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
];

export default function ConnectionsOverview() {
  const [, setLocation] = useLocation();
  const orgContext = useOrgContextOptional();
  const selectedOrgId = orgContext?.selectedOrgId ?? null;
  const connectorPath = selectedOrgId
    ? `/api/saas/connectors?organization_id=${selectedOrgId}`
    : "/api/saas/connectors";

  const credentialsQuery = useQuery<Credential[] | { credentials?: Credential[] }>({
    queryKey: ["/api/credentials", "connections-overview"],
    queryFn: () => fetchJson("/api/credentials"),
    retry: 1,
  });

  const tokensQuery = useQuery<{ tokens?: McpToken[] } | McpToken[]>({
    queryKey: ["/api/mcp/tokens", "connections-overview"],
    queryFn: () => fetchJson("/api/mcp/tokens"),
    retry: 1,
  });

  const connectorsQuery = useQuery<SaaSConnector[] | { connectors?: SaaSConnector[] }>({
    queryKey: ["/api/saas/connectors", selectedOrgId, "connections-overview"],
    queryFn: () => fetchJson(connectorPath),
    retry: 1,
  });

  const credentials = asArray(credentialsQuery.data) as Credential[];
  const tokens = asArray(tokensQuery.data) as McpToken[];
  const connectors = asArray(connectorsQuery.data) as SaaSConnector[];
  const isLoading = credentialsQuery.isLoading || tokensQuery.isLoading || connectorsQuery.isLoading;
  const activeTokens = tokens.filter((token) => token.isActive !== false).length;
  const connectedSaaS = connectors.filter((connector) => connector.status === "connected" || connector.is_enabled).length;
  const disconnectedSaaS = Math.max(connectors.length - connectedSaaS, 0);
  const inactiveTokens = Math.max(tokens.length - activeTokens, 0);
  const credentialTypes = new Set(credentials.map((credential) => credential.type).filter(Boolean)).size;
  const hasConnectionRisk = disconnectedSaaS > 0 || inactiveTokens > 0 || connectors.length === 0;

  const statCards = [
    {
      label: "Credentials",
      value: credentials.length,
      helper: "stored secret references",
      icon: Key,
      tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    },
    {
      label: "MCP Tokens",
      value: activeTokens,
      helper: "active HTTP access tokens",
      icon: Server,
      tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
    {
      label: "SaaS Bridges",
      value: connectedSaaS,
      helper: "connected external platforms",
      icon: PlugZap,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "Security",
      value: "Scoped",
      helper: "permissions and secret boundaries",
      icon: ShieldCheck,
      tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-300">Connections</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Connections
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                External systems, secrets, OAuth assets, SaaS sync, MCP access, and integration bridges in one control surface.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation("/connections/credentials/new")}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <Key className="mr-2 h-4 w-4 text-cyan-700 dark:text-cyan-300" />
              Add Credential
            </Button>
            <Button
              onClick={() => setLocation("/connections/saas")}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              <PlugZap className="mr-2 h-4 w-4" />
              SaaS Connectors
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
                      <p className="mt-1 text-3xl font-black text-foreground">
                        {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
                      </p>
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

        <Card className={cn(
          "border-foreground/10 bg-foreground/[0.04]",
          hasConnectionRisk && "border-amber-400/20 bg-amber-500/[0.06]"
        )}>
          <CardHeader className="border-b border-foreground/10 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
                  {hasConnectionRisk ? (
                    <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                  )}
                  Connection Review
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Risk-first summary for secrets, access tokens, and SaaS bridges.
                </CardDescription>
              </div>
              <Badge variant="outline" className={cn(
                "w-fit border-foreground/10 text-[10px] font-black uppercase",
                hasConnectionRisk ? "border-amber-400/30 text-amber-700 dark:text-amber-300" : "border-emerald-400/30 text-emerald-700 dark:text-emerald-300"
              )}>
                {hasConnectionRisk ? "Review recommended" : "No obvious connector risk"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
            {[
              {
                label: "Disconnected SaaS",
                value: `${disconnectedSaaS}/${connectors.length}`,
                helper: connectors.length === 0 ? "No SaaS bridges configured" : "bridges not connected",
                tone: disconnectedSaaS > 0 || connectors.length === 0 ? "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                icon: PlugZap,
              },
              {
                label: "Inactive tokens",
                value: inactiveTokens,
                helper: "HTTP access tokens not active",
                tone: inactiveTokens > 0 ? "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                icon: Server,
              },
              {
                label: "Credential coverage",
                value: credentialTypes,
                helper: "distinct secret classes available",
                tone: credentialTypes === 0 ? "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
                icon: Key,
              },
            ].map(item => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl border border-foreground/10 bg-background/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{item.label}</p>
                      {isLoading ? (
                        <Skeleton className="mt-2 h-7 w-16 bg-foreground/10" />
                      ) : (
                        <p className="mt-1 text-2xl font-black text-foreground">{item.value}</p>
                      )}
                    </div>
                    <div className={cn("rounded-xl border p-2.5", item.tone)}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-2 text-xs font-medium text-muted-foreground">{item.helper}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {connectionLinks.map((item) => {
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

          <div className="space-y-4">
            <Card className="border-foreground/10 bg-foreground/[0.04]">
              <CardHeader className="border-b border-foreground/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm font-black uppercase tracking-widest text-foreground">Connection State</CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">Live external-access signals.</CardDescription>
                  </div>
                  <Badge variant="outline" className="border-foreground/10 text-[10px] font-black uppercase text-muted-foreground">
                    Scoped
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {[
                  {
                    title: "Credential types",
                    value: credentialTypes,
                    detail: "distinct secret classes",
                    icon: Key,
                  },
                  {
                    title: "Connector health",
                    value: `${connectedSaaS}/${connectors.length}`,
                    detail: "connected SaaS bridges",
                    icon: CheckCircle2,
                  },
                  {
                    title: "Org context",
                    value: selectedOrgId ? `Org ${selectedOrgId}` : "All orgs",
                    detail: "active connector scope",
                    icon: Globe,
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
                          <Skeleton className="h-5 w-16 bg-foreground/10" />
                        ) : (
                          <span className="max-w-[160px] truncate text-sm font-black text-foreground">{signal.value}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">{signal.detail}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-3">
              {saasLinks.map((item) => {
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
      </div>
    </div>
  );
}
