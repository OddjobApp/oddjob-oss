
import { useLocation } from "wouter";
import { CrewReturnRibbon } from '@/components/agent-chat/CrewReturnRibbon';
import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Building2,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import Breadcrumb from "@domain-ui/core/ui/components/layout/Breadcrumb";
import { HatMenu } from "@/components/hat-menu/HatMenu";
import SkipToContent from "@domain-ui/core/ui/components/layout/SkipToContent";
import { useGlobalKeyboardShortcuts } from "@domain-ui/core/ui/hooks/use-keyboard-shortcuts";
import { readAssistantLink } from "@shared/assistant-link";
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
import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazy-retry";
const UniversalSearch = lazyWithRetry(() => import("@domain-ui/core/ui/modules/components/UniversalSearch").then(m => ({ default: (m as any).UniversalSearch }))) as React.FC<any>;
const CommandPalette = lazyWithRetry(() => import("@domain-ui/core/ui/components/shared/CommandPalette")) as React.FC<any>;
const AgentChatSheet = lazyWithRetry(() =>
  import("./AgentChatSheet").then(m => ({ default: m.AgentChatSheet || m.default }))
) as React.FC<any>;
const KeyboardShortcutsDialog = lazyWithRetry(() => import("./KeyboardShortcutsDialog").then(m => ({ default: (m as any).KeyboardShortcutsDialog }))) as React.FC<any>;
import { SidebarProvider, SidebarInset, useSidebar } from "@domain-ui/core/ui/components/ui/sidebar";
import AppSidebar from "@domain-ui/core/ui/components/layout/AppSidebar";
import { ErrorBoundary as PageErrorBoundary } from "@domain-ui/core/ui/components/shared/ErrorBoundary";
import { Header } from './Header.js';
import { ProjectSwitcher } from '@/modules/projects/components/ProjectSwitcher';
import { useTheme } from "@domain-ui/core/ui/components/theme-provider";
import { GlobalEventNotifier } from "./GlobalEventNotifier.js";
import { DecisionToastManager } from "../decisions/DecisionToastManager";
import { DecisionBanner } from "../decisions/DecisionBanner";
import { useDecisionSSE } from "../../hooks/use-decision-sse";
import { NotificationInbox } from "./NotificationInbox.js";
import { useDecisionStore } from "../../stores/decision.store";
import { formatBadgeCount } from "./DecisionIndicator.js";
import { useDecisionFallbackPolling } from "../../hooks/use-decision-fallback-polling";

// Hoisted outside component to prevent re-creation on every render (#3)
function SyncingOverlay() {
  return (
    <div className="fixed inset-0 z-modal flex flex-col items-center justify-center bg-background/95 backdrop-blur-md">
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

function MobileUtilityTray({
  isHidden,
  onAssistant,
  onSearch,
  pendingDecisionCount,
}: {
  isHidden?: boolean;
  onAssistant: () => void;
  onSearch: () => void;
  pendingDecisionCount: number;
}) {
  const pendingDecisionBadge = formatBadgeCount(pendingDecisionCount);
  // Hide the floating tray while the mobile sidebar sheet is open — the tray is
  // above the sheet (z-overlay vs the sheet's z-50), so otherwise it would
  // overlay the sheet's footer.
  const { openMobile } = useSidebar();
  const actionClass =
    "relative flex h-12 w-12 min-w-[3rem] items-center justify-center rounded-2xl border border-white/15 bg-white/20 text-primary shadow-lg transition active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-primary";

  if (isHidden || openMobile) {
    return null;
  }

  return (
    <nav
      aria-label="Mobile utilities"
      className="fixed inset-x-0 bottom-3 z-overlay flex justify-center px-3 sm:hidden"
    >
      <div className="flex items-center gap-2 rounded-[1.75rem] border border-white/20 bg-white/85 p-2 shadow-2xl backdrop-blur-3xl dark:border-white/10 dark:bg-black/85">
        <div className="[&>button]:h-12 [&>button]:w-12 [&>button]:min-w-[3rem] [&>button]:rounded-2xl">
          <NotificationInbox />
        </div>
        <button
          type="button"
          onClick={onAssistant}
          className={cn(actionClass, pendingDecisionCount > 0 && "animate-pulse-slow ring-2 ring-amber-400/40")}
          title={pendingDecisionCount > 0 ? "Review pending decisions in Oddjob Assistant" : "Open Oddjob Assistant"}
          aria-label="Open Oddjob Assistant"
        >
          <Sparkles className="h-6 w-6" />
          {pendingDecisionBadge && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-white/20 bg-red-500 px-1 text-[10px] font-black text-white shadow-lg ring-2 ring-white dark:ring-slate-900">
              {pendingDecisionBadge}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onSearch}
          className={actionClass}
          title="Search resources"
          aria-label="Search resources"
        >
          <Search className="h-6 w-6" />
        </button>
      </div>
    </nav>
  );
}

/**
 * Immersive routes render a full-bleed canvas that covers the mobile utility
 * tray, so the Copilot needs a floating fallback trigger there — and only there,
 * to avoid duplicating the tray on ordinary screens.
 *
 * Extracted as a pure predicate so the rule is testable without mounting Layout.
 * See Layout.mobile.test.ts.
 */
const IMMERSIVE_MOBILE_ROUTES = ["/knowledge/graph", "/platform-maintenance/system-graph"];

export function shouldShowMobileAssistantFab(
  path: string,
  isChatOpen: boolean,
  isSearchOpen: boolean,
): boolean {
  if (isChatOpen || isSearchOpen) return false;
  return IMMERSIVE_MOBILE_ROUTES.some(route => path === route || path.startsWith(`${route}/`));
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
  const pendingDecisionCount = useDecisionStore((state) => state.pendingCount);

  // Initialize session timeout management
  useSessionTimeout();

  // Initialize global keyboard shortcuts
  useGlobalKeyboardShortcuts();

  // Bootstrap Decision SSE client, store, and browser notification service
  useDecisionSSE();
  useDecisionFallbackPolling();

  // Listen for command palette / agent-assist events
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>(undefined);
  const [chatInitialContext, setChatInitialContext] = useState<Record<string, any> | undefined>(undefined);
  const [chatAssistRequestId, setChatAssistRequestId] = useState(0);

  useEffect(() => {
    const handleOpenCommandPalette = () => setIsCommandPaletteOpen(true);
    const handleOpenShortcuts = () => setShowShortcuts(true);
    const handleAgentAssist = (e: any) => {
      const isToggle = Boolean(e?.detail?.toggle);
      if (e?.detail) {
        setChatInitialPrompt(e.detail.prompt);
        setChatInitialContext(e.detail.context);
      } else {
        setChatInitialPrompt(undefined);
        setChatInitialContext(undefined);
      }
      setChatAssistRequestId(prev => prev + 1);
      if (isToggle) {
        setIsAgentChatOpen(prev => !prev);
      } else {
        setIsAgentChatOpen(true);
      }
    };

    // Global command-palette shortcut: Cmd/Ctrl+K (standard). preventDefault so it
    // doesn't trigger the browser's own Ctrl+K search-bar focus.
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };

    window.addEventListener('open-command-palette', handleOpenCommandPalette);
    window.addEventListener('open-shortcuts', handleOpenShortcuts);
    window.addEventListener('agent-assist-request', handleAgentAssist);
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('open-command-palette', handleOpenCommandPalette);
      window.removeEventListener('open-shortcuts', handleOpenShortcuts);
      window.removeEventListener('agent-assist-request', handleAgentAssist);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  // A link from outside the app, such as a Slack HIL notification's
  // /dashboard?assistant=approvals, opens the assistant on that view. The parameter
  // is removed so a reload or a copied address does not open it again.
  useEffect(() => {
    const link = readAssistantLink(window.location.search);
    if (!link) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${link.search}${window.location.hash}`);
    window.dispatchEvent(new CustomEvent('agent-assist-request', {
      detail: { context: { assistantView: link.view, source: 'assistant-link' } },
    }));
  }, []);

  // Preload AgentChatSheet chunk during browser idle to eliminate drawer opening latency
  useEffect(() => {
    if (typeof window !== "undefined") {
      const preload = () => {
        import("./AgentChatSheet").catch(() => {});
      };
      if ("requestIdleCallback" in window) {
        const handle = (window as any).requestIdleCallback(preload);
        return () => (window as any).cancelIdleCallback?.(handle);
      } else {
        const timer = setTimeout(preload, 1000);
        return () => clearTimeout(timer);
      }
    }
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
  const isAssistant = location.startsWith('/assistant');

  const pageTitle = (isMissionsRoot || isDashboardRoot) ? "" : (mission?.name || pipeline?.name || (
    location === "/" ? "Dashboard" :
    location === "/operations/runs" ? "Mission Timeline" :
    location === "/operations/workstreams" ? "Pipelines" :
    location === "/armory" ? "Apps" :
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
    (isAssistant && location.includes('/workbench')) ? "Assistant" :
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
    // The /operations/workstreams page is the pipeline portfolio (title, metrics,
    // and actions all say "Pipelines") — label it to match so the nav is trusted.
    "/operations/workstreams": "Pipelines",
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
    "/assistant": "Assistant",
    "/assistant/workbench": "Assistant",
    "/workspace/chat": "Room",
    "/chat": "Room",
    "/workspace/spatial": "Signal Studio",
    "/workspace/signals": "Signal Studio",
    "/spatial": "Signal Studio",
    "/signals": "Signal Studio",
  };

  const segments = location.split('/').filter(Boolean);
  const breadcrumbs: { label: string; href?: string }[] = [
    { label: "Home", href: location === "/" || location === "/dashboard" ? undefined : "/dashboard" }
  ];

  segments.forEach((s, i, arr) => {
    const isLast = i === arr.length - 1;
    const segmentPath = `/${arr.slice(0, i + 1).join('/')}`;

    // Skip the intermediate 'chat' segment when viewing a specific room session
    // to prevent duplicative "ROOM / ROOM ..." in top navigation
    if (s.toLowerCase() === 'chat' && arr[i + 1] && (arr[i + 1].toLowerCase().startsWith('crew-') || arr[i + 1].toLowerCase().startsWith('room-'))) {
      return;
    }

    let label = routeBreadcrumbLabels[segmentPath];
    if (!label) {
      if (isLast && missionId && mission?.name) {
        label = mission.name;
      } else if (isLast && pipelineId && pipeline?.name) {
        label = pipeline.name;
      } else if (s.toLowerCase().startsWith('crew-')) {
        label = s.replace(/^crew-/i, 'room-').split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      } else if (s.toLowerCase() === 'crew') {
        label = 'Room';
      } else {
        label = s.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      }
    }

    breadcrumbs.push({
      label,
      href: isLast ? undefined : segmentPath,
    });
  });
  const isImmersiveMobileSurface =
    location.startsWith('/knowledge/graph') ||
    location.startsWith('/platform-maintenance/system-graph');

  const isSpatialSurface =
    location.startsWith('/workspace/spatial') ||
    location.startsWith('/spatial') ||
    location.startsWith('/signal-intelligence');

  const isCrewChat =
    location.startsWith('/workspace/chat') ||
    location.startsWith('/chat');

  return (
    <SidebarProvider className={cn("bg-background", isCrewChat && "h-svh max-h-svh overflow-hidden")}>
      <GlobalEventNotifier />
      <DecisionToastManager />
      <SkipToContent />

      <AppSidebar
        userRole={adminRole?.isSuperAdmin || adminRole?.isOrgAdmin ? 'admin' : 'user'}
        userName={user.username}
        userEmail={user.email || undefined}
      />

      <SidebarInset className={cn("flex flex-col flex-1 min-w-0", isCrewChat ? "h-full max-h-full overflow-hidden" : "overflow-y-auto overflow-x-auto")}>
        {/* Hat Menu — cards appear above the header bar when hat is clicked */}
        <HatMenu />

        <div className="sticky top-0 z-50 flex flex-col pointer-events-none [&>*]:pointer-events-auto">
          <DecisionBanner />
          <div className="w-full">
            <Header
              title={pageTitle}
              breadcrumbs={breadcrumbs}
              isAssistantOpen={isAgentChatOpen}
              onToggleAssistant={() => setIsAgentChatOpen(prev => !prev)}
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
                      <SelectTrigger
                        aria-label="Active organization"
                        className="w-40 h-10 rounded-xl bg-white/20 dark:bg-white/5 border-white/20 dark:border-white/5 text-xs font-bold text-foreground dark:text-white"
                      >
                        <Building2 className="mr-1.5 h-3.5 w-3.5 shrink-0 opacity-70 text-primary" />
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
              projectSelector={<ProjectSwitcher />}
            />
          </div>
        </div>

        <CrewReturnRibbon />
        <main
          id="main-content"
          className={cn(
            "flex-1 w-full transition-all duration-500 ease-in-out",
            isCrewChat
              ? "p-0 pb-0 overflow-hidden h-full max-h-full"
              : isSpatialSurface
                ? "pb-24 sm:pb-2 p-1 sm:p-2 lg:p-2"
                : "pb-24 sm:pb-2 p-2 lg:p-4"
          )}
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

      <MobileUtilityTray
        isHidden={isAgentChatOpen || universalSearch.isOpen || isImmersiveMobileSurface}
        pendingDecisionCount={pendingDecisionCount}
        onAssistant={() => window.dispatchEvent(new CustomEvent('agent-assist-request', {
          detail: pendingDecisionCount > 0
            ? { context: { assistantView: 'approvals', source: 'assistant-mobile-tray' } }
            : undefined,
        }))}
        onSearch={() => universalSearch.setIsOpen(true)}
      />

      <Suspense fallback={null}>
        {universalSearch.isOpen && (
          <PageErrorBoundary name="UniversalSearch" fallback={null}>
            <UniversalSearch
              open={universalSearch.isOpen}
              onOpenChange={universalSearch.setIsOpen}
            />
          </PageErrorBoundary>
        )}

        {isCommandPaletteOpen && (
          <PageErrorBoundary name="CommandPalette" fallback={null}>
            <CommandPalette
              open={isCommandPaletteOpen}
              onOpenChange={setIsCommandPaletteOpen}
            />
          </PageErrorBoundary>
        )}

        {showShortcuts && (
          <PageErrorBoundary name="KeyboardShortcutsDialog" fallback={null}>
            <KeyboardShortcutsDialog
              open={showShortcuts}
              onOpenChange={setShowShortcuts}
            />
          </PageErrorBoundary>
        )}

        {isAgentChatOpen && (
          <PageErrorBoundary name="AgentChatSheet" fallback={null}>
            <Suspense fallback={null}>
              <AgentChatSheet
                open={isAgentChatOpen}
                onOpenChange={setIsAgentChatOpen}
                initialPrompt={chatInitialPrompt}
                initialContext={chatInitialContext}
                assistRequestId={chatAssistRequestId}
              />
            </Suspense>
          </PageErrorBoundary>
        )}
      </Suspense>
    </SidebarProvider>
  );
}
