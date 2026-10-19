
import { useLocation } from "wouter";
import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Loader2,
} from "lucide-react";
import Breadcrumb from "@domain-ui/core/ui/components/layout/Breadcrumb";
import SkipToContent from "@domain-ui/core/ui/components/layout/SkipToContent";
import { useGlobalKeyboardShortcuts } from "@domain-ui/core/ui/hooks/use-keyboard-shortcuts";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { useOrgContextOptional } from "@domain-ui/core/ui/hooks/use-org-context";
import { useSessionTimeout } from "@domain-ui/core/ui/hooks/use-session-timeout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { useUniversalSearch } from "@domain-ui/core/ui/modules/components/UniversalSearch";
import { lazy, Suspense } from "react";
const UniversalSearch = lazy(() => import("@domain-ui/core/ui/modules/components/UniversalSearch").then(m => ({ default: (m as any).UniversalSearch }))) as React.FC<any>;
const CommandPalette = lazy(() => import("@domain-ui/core/ui/components/shared/CommandPalette")) as React.FC<any>;
const AgentChatSheet = lazy(() => import("./AgentChatSheet").then(m => ({ default: (m as any).AgentChatSheet }))) as React.FC<any>;
const KeyboardShortcutsDialog = lazy(() => import("./KeyboardShortcutsDialog").then(m => ({ default: (m as any).KeyboardShortcutsDialog }))) as React.FC<any>;
import { SidebarProvider, SidebarInset } from "@domain-ui/core/ui/components/ui/sidebar";
import AppSidebar from "@domain-ui/core/ui/components/layout/AppSidebar";
import { ErrorBoundary as PageErrorBoundary } from "@domain-ui/core/ui/components/shared/ErrorBoundary";
import { Header } from './Header.js';
import { useTheme } from "@domain-ui/core/ui/components/theme-provider";
import { GlobalEventNotifier } from "./GlobalEventNotifier.js";
import { DecisionToastManager } from "../decisions/DecisionToastManager";
import { DecisionBanner } from "../decisions/DecisionBanner";
import { useDecisionSSE } from "../../hooks/use-decision-sse";

// Hoisted outside component to prevent re-creation on every render (#3)
function SyncingOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-md">
      <div className="relative flex flex-col items-center max-w-md p-8 text-center animate-in fade-in zoom-in duration-500">
        <div className="relative mb-6">
          <svg
            className="h-16 w-16 animate-spin text-primary opacity-20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
        <h2 className="mb-2 text-2xl font-bold tracking-tight">Synchronizing Session</h2>
        <p className="text-muted-foreground animate-pulse">
          Hardening your secure workspace...
        </p>
        <div className="mt-8 flex gap-1">
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
          <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { theme, setTheme } = useTheme();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { user, adminRole, isLoading } = useAuth();

  // Safe unconditional hook call — returns null outside OrgProvider (#2)
  const orgContext = useOrgContextOptional();
  const selectedOrgId = orgContext?.selectedOrgId ?? null;
  const setSelectedOrgId = orgContext?.setSelectedOrgId ?? (() => {});

  const queryClient = useQueryClient();
  const universalSearch = useUniversalSearch();
  const [isAgentChatOpen, setIsAgentChatOpen] = useState(false);

  // Initialize session timeout management
  useSessionTimeout();

  // Initialize global keyboard shortcuts
  useGlobalKeyboardShortcuts();

  // Bootstrap Decision SSE client, store, and browser notification service
  useDecisionSSE();

  // Listen for command palette / agent-assist events
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>(undefined);
  const [chatInitialContext, setChatInitialContext] = useState<Record<string, any> | undefined>(undefined);

  useEffect(() => {
    const handleOpenCommandPalette = () => setIsCommandPaletteOpen(true);
    const handleOpenShortcuts = () => setShowShortcuts(true);
    const handleAgentAssist = (e: any) => {
      if (e.detail) {
        setChatInitialPrompt(e.detail.prompt);
        setChatInitialContext(e.detail.context);
      } else {
        setChatInitialPrompt(undefined);
        setChatInitialContext(undefined);
      }
      setIsAgentChatOpen(true);
    };

    window.addEventListener('open-command-palette', handleOpenCommandPalette);
    window.addEventListener('open-shortcuts', handleOpenShortcuts);
    window.addEventListener('agent-assist-request', handleAgentAssist);

    return () => {
      window.removeEventListener('open-command-palette', handleOpenCommandPalette);
      window.removeEventListener('open-shortcuts', handleOpenShortcuts);
      window.removeEventListener('agent-assist-request', handleAgentAssist);
    };
  }, []);

  // Fetch organizations for Super Admin selector
  const isSuperAdmin = adminRole?.isSuperAdmin === true;

  const { data: organizationsResponse, isLoading: isLoadingOrgs } = useQuery<any>({
    queryKey: ['/api/admin/organizations'],
    queryFn: async () => {
      try {
        const res = await apiRequest('GET', '/api/admin/organizations');
        if (!res.ok) return { organizations: [] };
        return await res.json();
      } catch (e: any) {
        console.error("Error fetching organizations:", e);
        return { organizations: [] };
      }
    },
    enabled: isSuperAdmin && !!user,
  });

  const organizations = Array.isArray(organizationsResponse?.organizations)
    ? organizationsResponse.organizations
    : [];

  const selectedOrg = organizations.find((org: any) => org.id === selectedOrgId);
  const selectedOrgName = selectedOrg?.name || null;

  // Detect pipeline detail route and fetch pipeline name for breadcrumb
  const pipelineIdMatch = location.match(/^\/pipelines\/(\d+)$/);
  const pipelineId = pipelineIdMatch ? parseInt(pipelineIdMatch[1], 10) : null;

  const { data: pipeline } = useQuery<any>({
    queryKey: ['/api/pipelines', pipelineId],
    queryFn: async () => {
      if (!pipelineId) return null;
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!pipelineId && !isNaN(pipelineId),
  });

  // Detect mission detail route and fetch mission name for breadcrumb
  const missionIdMatch = location.match(/^\/missions\/(\d+)$/);
  const missionId = missionIdMatch ? parseInt(missionIdMatch[1], 10) : null;

  const { data: mission } = useQuery<any>({
    queryKey: ['/api/missions', missionId],
    queryFn: async () => {
      if (!missionId) return null;
      const res = await apiRequest('GET', `/api/missions/${missionId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!missionId && !isNaN(missionId),
  });

  // Fix #4: breadcrumb covers both pipeline and mission detail routes
  const customBreadcrumbItems =
    pipelineId && pipeline
      ? [
          { label: "Home", href: "/dashboard" },
          { label: "Pipelines", href: "/pipelines" },
          { label: pipeline.name || `Pipeline ${pipelineId}`, href: undefined },
        ]
      : missionId && mission
      ? [
          { label: "Home", href: "/dashboard" },
          { label: "Missions", href: "/missions" },
          { label: mission.name || `Mission ${missionId}`, href: undefined },
        ]
      : undefined;

  // Handle loading and auth redirect
  useEffect(() => {
    if (!isLoading && !user) {
      const isAuthPage = location.startsWith('/auth');
      if (isAuthPage) return;

      const hasCachedUser = !!sessionStorage.getItem('oddjob:user:cache');

      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      const loginUrl = `/auth/login?returnTo=${returnTo}`;

      if (!hasCachedUser) {
        console.warn("[Auth] Redirecting to login - session lost.");
        window.location.href = loginUrl;
        return;
      }

      const isPostLogin = window.location.search.includes('login=1');
      const gracePeriod = isPostLogin ? 8000 : 3000;

      const timeout = setTimeout(() => {
        if (!user && !location.startsWith('/auth')) {
          console.warn(`[Auth] Redirecting to login - hydration failed after ${gracePeriod}ms.`);
          window.location.href = loginUrl;
        }
      }, gracePeriod);

      return () => clearTimeout(timeout);
    }
  }, [isLoading, user, setLocation, location]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-background">
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-500">
          <svg
            className="h-10 w-10 animate-spin text-primary/50"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span className="text-sm font-medium text-muted-foreground tracking-wide">Loading workspace...</span>
        </div>
      </div>
    );
  }

  // During the grace period while user is null, show the SyncingOverlay
  if (!user) {
    return <SyncingOverlay />;
  }

  const isMissionsRoot = location === "/missions";
  const isDashboardRoot = location === "/dashboard" || location === "/";
  const isArmory = location.startsWith('/armory') || location === '/apps' || location.startsWith('/apps/') || location === '/forms' || location.startsWith('/forms/') || location === '/forge';
  const isInsights = location.startsWith('/insights');
  const isAccountAdmin = location.startsWith('/account-admin');
  const isConnections = location.startsWith('/connections');
  const isPlatformMaintenance = location.startsWith('/platform-maintenance');
  const isHealth = location.startsWith('/health');

  const pageTitle = (isMissionsRoot || isDashboardRoot) ? "" : (mission?.name || pipeline?.name || (
    location === "/" ? "Dashboard" :
    location === "/armory" ? "Apps & Forge" :
    location === "/insights" ? "Insights" :
    location === "/account-admin" ? "Account & Admin" :
    location === "/connections" ? "Connections" :
    location === "/platform-maintenance" ? "Platform Maintenance" :
    location === "/health" ? "Health" :
    (isAccountAdmin && location.includes('/organizations')) ? "Organizations" :
    (isAccountAdmin && location.includes('/users')) ? "Users" :
    (isAccountAdmin && location.includes('/billing')) ? "Billing" :
    (isAccountAdmin && location.includes('/licensing')) ? "Licensing" :
    (isPlatformMaintenance && location.includes('/snapshots')) ? "Snapshots" :
    (isPlatformMaintenance && location.includes('/documentation')) ? "Documentation" :
    (isPlatformMaintenance && location.includes('/software-audit')) ? "Software Audit" :
    (isPlatformMaintenance && location.includes('/evolution')) ? "System Evolution" :
    (isPlatformMaintenance && location.includes('/autoresearch')) ? "Autoresearch" :
    (isPlatformMaintenance && location.includes('/system-graph')) ? "System Graph" :
    (isHealth && location.includes('/observability')) ? "Observability" :
    (isHealth && location.includes('/monitoring')) ? "Monitoring" :
    (isHealth && location.includes('/alerts')) ? "Alerts" :
    (isHealth && location.includes('/events')) ? "Events" :
    (isHealth && location.includes('/pulse')) ? "Pulse" :
    (isHealth && location.includes('/incidents')) ? "Incidents" :
    (isHealth && location.includes('/infra-health')) ? "Infra Health" :
    (isConnections && location.includes('/credentials')) ? "Credentials" :
    (isConnections && location.includes('/integrations')) ? "Integrations" :
    (isConnections && location.includes('/mcp-tokens')) ? "MCP Tokens" :
    (isConnections && location.includes('/saas/workflows')) ? "SaaS Event Workflows" :
    (isConnections && location.includes('/saas/sync-config')) ? "SaaS Sync Config" :
    (isConnections && location.includes('/saas/analytics')) ? "SaaS Analytics" :
    (isConnections && location.includes('/saas')) ? "SaaS Connectors" :
    (isInsights && location.includes('/roi')) ? "ROI & Value" :
    (isInsights && location.includes('/costs')) ? "Cost Center" :
    (isInsights && location.includes('/tools')) ? "Tool Analytics" :
    (isInsights && location.includes('/agents')) ? "Agent Analytics" :
    (isInsights && location.includes('/scoring')) ? "Scoring" :
    (isInsights && location.includes('/prediction')) ? "Prediction Intelligence" :
    (isArmory && location.includes('/forms')) ? "Forms" :
    (isArmory && location.includes('org-forge')) ? "Org Forge" :
    (isArmory && (location.includes('apps') || location === '/apps')) ? "App Arsenal" :
    (isArmory && location.includes('/forge/history')) ? "Forge History" :
    (isArmory && location.includes('/forge/settings')) ? "Forge Settings" :
    (isArmory && (location.includes('forge') || location === '/forge')) ? "Forge Studio" :
    (isArmory && (location.includes('x-ray') || location === '/x-ray')) ? "System X-Ray" :
    location.split('/').pop()?.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase()) || "Oddjob"
  ));

  const routeBreadcrumbLabels: Record<string, string> = {
    "/account-admin": "Account & Admin",
    "/account-admin/organizations": "Organizations",
    "/account-admin/users": "Users",
    "/account-admin/billing": "Billing",
    "/account-admin/licensing": "Licensing",
    "/platform-maintenance": "Platform Maintenance",
    "/platform-maintenance/snapshots": "Snapshots",
    "/platform-maintenance/documentation": "Documentation",
    "/platform-maintenance/software-audit": "Software Audit",
    "/platform-maintenance/evolution": "System Evolution",
    "/platform-maintenance/autoresearch": "Autoresearch",
    "/platform-maintenance/system-graph": "System Graph",
    "/health": "Health",
    "/health/observability": "Observability",
    "/health/monitoring": "Monitoring",
    "/health/alerts": "Alerts",
    "/health/events": "Events",
    "/health/pulse": "Pulse",
    "/health/incidents": "Incidents",
    "/health/infra-health": "Infra Health",
    "/connections": "Connections",
    "/connections/credentials": "Credentials",
    "/connections/credentials/new": "Add Credential",
    "/connections/integrations": "Integrations",
    "/connections/mcp-tokens": "MCP Tokens",
    "/connections/saas": "SaaS Connectors",
    "/connections/saas/workflows": "Event Workflows",
    "/connections/saas/sync-config": "Sync Config",
    "/connections/saas/analytics": "SaaS Analytics",
  };

  const breadcrumbs = location === "/" ? ["Home"] : ["Home", ...location.split('/').filter(Boolean).map((s, i, arr) => {
    if (i === arr.length - 1) {
      if (missionId && mission?.name) return mission.name;
      if (pipelineId && pipeline?.name) return pipeline.name;
    }
    const segmentPath = `/${arr.slice(0, i + 1).join('/')}`;
    if (routeBreadcrumbLabels[segmentPath]) return routeBreadcrumbLabels[segmentPath];
    return s.replace(/^\w/, c => c.toUpperCase());
  })];

  return (
    <SidebarProvider className="bg-background">
      <GlobalEventNotifier />
      <DecisionToastManager />
      <SkipToContent />

      <AppSidebar
        userRole={adminRole?.isSuperAdmin || adminRole?.isOrgAdmin ? 'admin' : 'user'}
        userName={user.username}
        userEmail={user.email || undefined}
      />

      <SidebarInset className="flex flex-col flex-1 overflow-y-auto overflow-x-auto min-w-0">
        <Header
          title={pageTitle}
          breadcrumbs={breadcrumbs}
          isDarkMode={theme === "dark"}
          onToggleDarkMode={() => setTheme(theme === "dark" ? "light" : "dark")}
          username={user.username}
          role={adminRole?.isSuperAdmin ? "Super Admin" : adminRole?.isOrgAdmin ? "Org Admin" : "User"}
          orgSelector={isSuperAdmin && (
            <div className="flex items-center gap-2">
              {isLoadingOrgs ? (
                <Skeleton className="h-9 w-40" />
              ) : (
                <Select
                  value={selectedOrgId?.toString() || "all"}
                  onValueChange={(value) => {
                    const previousOrgId = selectedOrgId;
                    const newOrgId = value === "all" ? null : parseInt(value, 10);
                    setSelectedOrgId(newOrgId);

                    if (previousOrgId !== newOrgId) {
                      // Fix #5: invalidate only org-scoped queries, not the org list itself
                      queryClient.invalidateQueries({
                        predicate: (query) => {
                          const key = query.queryKey[0];
                          return typeof key === 'string' && key !== '/api/admin/organizations';
                        },
                      });

                      // Fix #6: client-side URL update, no hard reload
                      const params = new URLSearchParams(window.location.search);
                      if (newOrgId) {
                        params.set('orgId', newOrgId.toString());
                      } else {
                        params.delete('orgId');
                      }
                      const newSearch = params.toString();
                      setLocation(`${location}${newSearch ? `?${newSearch}` : ''}`, { replace: true } as any);
                    }
                  }}
                >
                  <SelectTrigger className="w-40 h-10 rounded-xl bg-white/20 dark:bg-white/5 border-white/20 dark:border-white/5 text-xs font-bold text-foreground dark:text-white">
                    <SelectValue placeholder="Org">
                      {selectedOrgName || "All Orgs"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Organizations</SelectItem>
                    {organizations.map((org: any) => (
                      <SelectItem key={org.id} value={org.id.toString()}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        />

        <DecisionBanner />

        <main
          id="main-content"
          className="flex-1 w-full p-2 lg:p-4 transition-all duration-500 ease-in-out"
          role="main"
        >
          <div className="h-full flex flex-col flex-1 min-h-0">
            <Breadcrumb className="md:hidden mb-4 items-center" items={customBreadcrumbItems} />
            <PageErrorBoundary>
            <div key={location} className="animate-page-in flex flex-col flex-1 min-h-0 h-full">
                {children}
              </div>
            </PageErrorBoundary>
          </div>
        </main>
      </SidebarInset>

      <Suspense fallback={null}>
        <UniversalSearch
          open={universalSearch.isOpen}
          onOpenChange={universalSearch.setIsOpen}
        />

        <CommandPalette
          open={isCommandPaletteOpen}
          onOpenChange={setIsCommandPaletteOpen}
        />

        <KeyboardShortcutsDialog
          open={showShortcuts}
          onOpenChange={setShowShortcuts}
        />

        <AgentChatSheet
          open={isAgentChatOpen}
          onOpenChange={setIsAgentChatOpen}
          initialPrompt={chatInitialPrompt}
          initialContext={chatInitialContext}
        />
      </Suspense>
    </SidebarProvider>
  );
}
