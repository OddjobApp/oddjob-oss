import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  CreditCard,
  KeyRound,
  Settings,
  ShieldCheck,
  Users,
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

type Organization = {
  id: number;
  name: string;
};

type UserData = {
  id: string;
  email?: string;
  username?: string;
};

type LicenseStatus = {
  type?: string;
  plan?: string;
  isActive?: boolean;
  daysRemaining?: number | null;
};

type LinkItem = {
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

function asArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.users)) return data.users;
  if (Array.isArray(data?.organizations)) return data.organizations;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function formatCount(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value.trim()) return value;
  return "0";
}

const accountAdminLinks: LinkItem[] = [
  {
    title: "Organizations",
    description: "Tenant records, organization settings, members, exports, and org-scoped controls.",
    href: "/account-admin/organizations",
    icon: Building2,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "Users",
    description: "User accounts, access state, admin roles, organization assignments, and permissions.",
    href: "/account-admin/users",
    icon: Users,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Billing",
    description: "Subscription plan, checkout, and payment state for the selected organization.",
    href: "/account-admin/billing",
    icon: CreditCard,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    title: "Licensing",
    description: "License status, trial activation, enterprise keys, and entitlement state.",
    href: "/account-admin/licensing",
    icon: BadgeCheck,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
];

const relatedLinks: LinkItem[] = [
  {
    title: "Profile",
    description: "Personal account details and notification preferences.",
    href: "/profile",
    icon: Settings,
    tone: "border-border/20 bg-muted/10 text-foreground",
  },
  {
    title: "Connections",
    description: "Credentials, integrations, MCP tokens, and SaaS sync live together.",
    href: "/connections",
    icon: KeyRound,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
];

export default function AccountAdminOverview() {
  const [, setLocation] = useLocation();
  const orgContext = useOrgContextOptional();
  const selectedOrgId = orgContext?.selectedOrgId ?? null;

  const organizationsQuery = useQuery<{ organizations?: Organization[] } | Organization[]>({
    queryKey: ["/api/admin/organizations", "account-admin-overview"],
    queryFn: () => fetchJson("/api/admin/organizations"),
    retry: 1,
  });

  const usersQuery = useQuery<{ users?: UserData[] } | UserData[]>({
    queryKey: ["/api/admin/users", "account-admin-overview"],
    queryFn: () => fetchJson("/api/admin/users"),
    retry: 1,
  });

  const licenseQuery = useQuery<LicenseStatus>({
    queryKey: ["/api/licensing/status", "account-admin-overview"],
    queryFn: () => fetchJson("/api/licensing/status"),
    retry: 1,
  });

  const selectedOrgQuery = useQuery<any>({
    queryKey: ["/api/organizations", selectedOrgId, "account-admin-overview"],
    queryFn: () => fetchJson(`/api/organizations/${selectedOrgId}`),
    enabled: !!selectedOrgId,
    retry: 1,
  });

  const organizations = asArray(organizationsQuery.data);
  const users = asArray(usersQuery.data);
  const license = licenseQuery.data || {};
  const selectedOrg = selectedOrgQuery.data;
  const isLoading = organizationsQuery.isLoading || usersQuery.isLoading || licenseQuery.isLoading || selectedOrgQuery.isLoading;

  const statCards = [
    {
      label: "Organizations",
      value: organizations.length,
      helper: "tenant records",
      icon: Building2,
      tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "Users",
      value: users.length,
      helper: "account identities",
      icon: Users,
      tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    },
    {
      label: "Plan",
      value: selectedOrg?.subscriptionStatus || license.plan || license.type || "Unknown",
      helper: selectedOrgId ? `selected org ${selectedOrgId}` : "no org selected",
      icon: CreditCard,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "License",
      value: license.isActive ? "Active" : license.type || "Unknown",
      helper: license.daysRemaining != null ? `${license.daysRemaining} days remaining` : "entitlement state",
      icon: BadgeCheck,
      tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_16px_rgba(125,211,252,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-sky-700 dark:text-sky-300">Account & Admin</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Account & Admin
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Tenant administration, users, billing, and licensing from one account control surface.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation("/account-admin/users")}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <Users className="mr-2 h-4 w-4 text-blue-700 dark:text-blue-300" />
              Users
            </Button>
            <Button
              onClick={() => setLocation("/account-admin/organizations")}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              <Building2 className="mr-2 h-4 w-4" />
              Organizations
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {accountAdminLinks.map((item) => {
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
                    <CardTitle className="text-sm font-black uppercase tracking-widest text-foreground">Account State</CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">Current tenant administration signals.</CardDescription>
                  </div>
                  <Badge variant="outline" className="border-foreground/10 text-[10px] font-black uppercase text-muted-foreground">
                    Admin
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {[
                  {
                    title: "Selected org",
                    value: selectedOrg?.name || (selectedOrgId ? `Org ${selectedOrgId}` : "All orgs"),
                    detail: "active admin context",
                    icon: Briefcase,
                  },
                  {
                    title: "License mode",
                    value: license.type || "unknown",
                    detail: "enterprise entitlement",
                    icon: ShieldCheck,
                  },
                  {
                    title: "Subscription",
                    value: selectedOrg?.subscriptionStatus || "unknown",
                    detail: "billing state",
                    icon: CreditCard,
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
                          <span className="max-w-[160px] truncate text-sm font-black text-foreground">{formatCount(signal.value)}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">{signal.detail}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-3">
              {relatedLinks.map((item) => {
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
