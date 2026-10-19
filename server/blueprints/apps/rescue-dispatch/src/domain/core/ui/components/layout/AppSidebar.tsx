import {
  Home,
  Users,
  Briefcase,
  Inbox,
  AlertTriangle,
  Settings,
  Play,
  Key,
  LogOut,
  Brain,
  Network,
  DollarSign,
  Wrench,
  Camera,
  Wand2,
  History,
  BarChart3,
  TrendingUp,
  Zap,
  Workflow,
  Bot,
  Shield,
  ShieldCheck,
  Activity,
  FlaskConical,
  Terminal,
  Hammer,
  PlugZap,
  Server,
  FileSearch,
  ScrollText,
  HeartPulse,
  BookMarked,
  Bell,
  Monitor,
  Radio,
  User,
} from 'lucide-react';
import { SmartLink } from '@domain-ui/core/ui/components/shared/SmartLink';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@domain-ui/core/ui/components/ui/sidebar';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { HatIcon } from '@domain-ui/core/ui/components/shared/HatIcon';
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { ModeToggle } from '@domain-ui/core/ui/components/mode-toggle';
import { THEME } from '@/theme';
import { cn } from "@/lib/utils";
import type { Permission } from '@/lib/permissions';

interface AppSidebarProps {
  userRole?: 'admin' | 'user';
  userName?: string;
  userEmail?: string;
}

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  badge?: number;
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export default function AppSidebar({ userRole = 'admin', userName = 'Admin User', userEmail = 'admin@oddjob.com' }: AppSidebarProps) {
  const [location, setLocation] = useLocation();
  const { can, logoutMutation } = useAuth();

  const { data: approvals } = useQuery<any[]>({
    queryKey: ['/api/approvals'],
    staleTime: 60000,       // Badge stays fresh for 60s — avoids refetch on every pod switch
    refetchInterval: 60000, // Poll every 60s in the background
  });

  const pendingCount = approvals?.length || 0;

  const isConnectionsSection = location.startsWith('/connections') ||
    location.startsWith('/credentials') ||
    location.startsWith('/saas') ||
    location.startsWith('/admin/integrations') ||
    location.startsWith('/admin/mcp-tokens');

  const isPlatformMaintenanceSection = location.startsWith('/platform-maintenance') ||
    location.startsWith('/snapshots') ||
    location.startsWith('/admin/documentation') ||
    location.startsWith('/admin/dependencies') ||
    location.startsWith('/admin/evolution') ||
    location.startsWith('/admin/autoresearch') ||
    location.startsWith('/admin/system-graph');

  const isHealthSection = location.startsWith('/health') ||
    location.startsWith('/observability') ||
    location.startsWith('/monitoring') ||
    location.startsWith('/alerts') ||
    location.startsWith('/events') ||
    location.startsWith('/pulse') ||
    location.startsWith('/admin/events') ||
    location.startsWith('/admin/alerts') ||
    location.startsWith('/admin/diagnoses') ||
    location.startsWith('/admin/infra-health');

  const isAccountAdminSection = location.startsWith('/account-admin') ||
    location.startsWith('/organizations') ||
    location.startsWith('/users') ||
    location.startsWith('/billing') ||
    location.startsWith('/admin');

  const navigationGroups: NavGroup[] = [
    {
      label: "Operations",
      items: [
        { title: 'Dashboard', url: '/dashboard', icon: Home },
        { title: 'Operations', url: '/operations', icon: Workflow },
      ]
    },
    {
      label: "Intelligence",
      items: [
        { title: 'Insights', url: '/insights', icon: BarChart3 },
        {
          title: 'Decision Inbox',
          url: '/control/decisions',
          icon: Inbox,
          badge: pendingCount > 0 ? pendingCount : undefined
        },
        { title: 'Policies', url: '/control/policies', icon: ShieldCheck },
        { title: 'Simulator', url: '/control/simulator', icon: Play },
        { title: 'Board Room', url: '/control/board-room', icon: Briefcase },
        { title: 'Operational Health', url: '/health', icon: HeartPulse },
      ]
    },
    {
      label: "Knowledge",
      items: [
        { title: 'Knowledge', url: '/knowledge', icon: Brain },
      ]
    },
    {
      label: "Armory",
      items: [
        { title: 'Apps & Forge', url: '/armory', icon: Hammer },
        { title: 'Tool Registry', url: '/armory/tools', icon: Wrench },
        { title: 'Run Memory', url: '/armory/run-memory', icon: History },
      ]
    },
    {
      label: "Platform",
      items: [
        { title: 'Platform', url: '/platform', icon: Server },
      ]
    },
    {
      label: "User/Settings",
      items: [
        { title: 'Settings', url: '/settings', icon: Settings },
        { title: 'Profile', url: '/profile', icon: User },
      ]
    },
  ];

  const adminNavGroup: NavGroup = {
    label: "Administration",
    items: [
      { title: 'Account Overview', url: '/account-admin', icon: ShieldCheck, exact: true },
      { title: 'Organizations', url: '/account-admin/organizations', icon: Briefcase },
      { title: 'Users', url: '/account-admin/users', icon: Users },
      { title: 'Billing', url: '/account-admin/billing', icon: DollarSign },
      { title: 'Licensing', url: '/account-admin/licensing', icon: Zap },
      { title: 'UCI Hub (Gallery)', url: '/admin/uci-hub', icon: Bot },
      { title: 'Skill Registry', url: '/admin/skill-registry', icon: Terminal },
      { title: 'Audit Log', url: '/admin/audit', icon: ScrollText },
      { title: 'Scoring Studio', url: '/admin/scoring', icon: Wand2 },
      { title: 'Evaluation Studio', url: '/admin/evaluation-studio', icon: FlaskConical },
    ]
  };

  const healthNavGroup: NavGroup = {
    label: "Health",
    items: [
      { title: 'Health Overview', url: '/health', icon: HeartPulse, exact: true },
      { title: 'Observability', url: '/health/observability', icon: Activity },
      { title: 'Monitoring', url: '/health/monitoring', icon: Monitor },
      { title: 'Alerts', url: '/health/alerts', icon: Bell },
      { title: 'Events', url: '/health/events', icon: FileSearch },
      { title: 'Pulse', url: '/health/pulse', icon: Radio },
      { title: 'Incidents', url: '/health/incidents', icon: AlertTriangle },
      { title: 'Infra Health', url: '/health/infra-health', icon: Server },
    ]
  };

  const connectionsNavGroup: NavGroup = {
    label: "Connections",
    items: [
      { title: 'Connections Overview', url: '/connections', icon: Network, exact: true },
      { title: 'Credentials', url: '/connections/credentials', icon: Key },
      { title: 'Integrations', url: '/connections/integrations', icon: Wrench },
      { title: 'MCP Tokens', url: '/connections/mcp-tokens', icon: Server },
      { title: 'SaaS Connectors', url: '/connections/saas', icon: PlugZap },
    ]
  };

  const platformMaintenanceNavGroup: NavGroup = {
    label: "Platform Maintenance",
    items: [
      { title: 'Maintenance Overview', url: '/platform-maintenance', icon: Activity, exact: true },
      { title: 'Snapshots', url: '/platform-maintenance/snapshots', icon: Camera },
      { title: 'Documentation', url: '/platform-maintenance/documentation', icon: BookMarked },
      { title: 'Software Audit', url: '/platform-maintenance/software-audit', icon: Shield },
      { title: 'System Evolution', url: '/platform-maintenance/evolution', icon: Activity },
      { title: 'Autoresearch', url: '/platform-maintenance/autoresearch', icon: TrendingUp },
      { title: 'System Graph', url: '/platform-maintenance/system-graph', icon: Network },
    ]
  };

  // Determine which sub-navigation panel to show (if any)
  const isPlatformSubNavActive = isConnectionsSection || isPlatformMaintenanceSection || isAccountAdminSection;

  const isSubNavActive = isHealthSection || isPlatformSubNavActive;

  const activeAdminGroup = isHealthSection
    ? healthNavGroup
    : isConnectionsSection
    ? connectionsNavGroup
    : isPlatformMaintenanceSection
      ? platformMaintenanceNavGroup
      : adminNavGroup;
  const activeAdminRoot = isHealthSection
    ? "/health"
    : isConnectionsSection
    ? "/connections"
    : isPlatformMaintenanceSection
      ? "/platform-maintenance"
      : "/account-admin";
  const activeAdminLabel = isHealthSection
    ? "Health"
    : isConnectionsSection
    ? "Connections"
    : isPlatformMaintenanceSection
      ? "Platform Maintenance"
      : "Account & Admin";

  // Settings and Profile items persist in Platform sub-navigation panels (Req 5.4)
  const platformPersistentItems: NavItem[] = [
    { title: 'Settings', url: '/settings', icon: Settings },
    { title: 'Profile', url: '/profile', icon: User },
  ];

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/auth/login";
      }
    });
  };

  return (
    <Sidebar collapsible="icon" className="glass-sidebar transition-all duration-300">
      <SidebarHeader className="p-6 border-b border-sidebar-border bg-muted/20">
        <SmartLink href="/dashboard">
          <div className="flex items-center gap-4 group-data-[collapsible=icon]:justify-center cursor-pointer group">
            <div className="relative group/logo">
              <div className="bg-white rounded-full p-[3.1px] shadow-md border border-white/20 flex items-center justify-center transition-transform duration-500 group-hover/logo:scale-110">
                <HatIcon className="w-[36.75px] h-[36.75px] transition-all duration-500 group-hover/logo:rotate-12 drop-shadow-md" />
              </div>
              <div className="absolute -inset-2 bg-primary/20 rounded-full blur-xl opacity-0 group-hover/logo:opacity-50 transition-opacity duration-700" />
            </div>
            <div className="flex flex-col group-data-[collapsible=icon]:hidden transition-all duration-300">
              <span className="text-[31.5px] font-black text-foreground tracking-tighter leading-none group-hover:text-primary transition-colors">Oddjob</span>
              <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Agentic-Intelligence</span>
            </div>
          </div>
        </SmartLink>
      </SidebarHeader>

      <SidebarContent>
        {navigationGroups.map((group) => {
          const visibleItems = group.items.filter(item => !item.permission || can(item.permission));

          if (visibleItems.length === 0) return null;

          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => {
                    const isActive = item.exact ? location === item.url : location === item.url || location.startsWith(item.url + '/');
                    return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                        className="transition-all duration-200 hover:bg-muted/50 data-[active=true]:bg-primary/10 data-[active=true]:text-primary group/item"
                      >
                        <SmartLink href={item.url} className="flex items-center gap-3 w-full px-2">
                          <item.icon className={cn("w-4 h-4 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover/item:text-primary/70")} />
                          <span className="flex-1 font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">{item.title}</span>
                          {item.badge !== undefined && item.badge > 0 && (
                            <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold min-w-[20px] text-center shadow-sm">
                              {item.badge}
                            </span>
                          )}
                        </SmartLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}

        {/* Conditional sub-navigation panel for Platform sub-domains and Health */}
        {isSubNavActive && (
          <>
            <div className="px-4 py-2">
              <Separator className="bg-sidebar-border/50" />
            </div>
            <SidebarGroup>
              <SmartLink href={activeAdminRoot}>
                <SidebarGroupLabel className="px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 cursor-pointer hover:text-primary transition-colors">
                  {activeAdminLabel}
                </SidebarGroupLabel>
              </SmartLink>
              <SidebarGroupContent>
                <SidebarMenu>
                  {activeAdminGroup.items.map((item) => {
                    const isActive = item.exact ? location === item.url : location === item.url || location.startsWith(item.url + '/');
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          className="hover:bg-muted/50 data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                        >
                          <SmartLink href={item.url} className="flex items-center gap-3 w-full px-2">
                            <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                            <span className="flex-1 font-medium tracking-tight">{item.title}</span>
                          </SmartLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                  {/* Persist Settings and Profile in Platform sub-navigation panels (Req 5.4) */}
                  {isPlatformSubNavActive && (
                    <>
                      <div className="px-2 py-2">
                        <Separator className="bg-sidebar-border/30" />
                      </div>
                      {platformPersistentItems.map((item) => {
                        const isActive = location === item.url || location.startsWith(item.url + '/');
                        return (
                          <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive}
                              tooltip={item.title}
                              className="hover:bg-muted/50 data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                            >
                              <SmartLink href={item.url} className="flex items-center gap-3 w-full px-2">
                                <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                                <span className="flex-1 font-medium tracking-tight">{item.title}</span>
                              </SmartLink>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4 bg-muted/10">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="w-full justify-start gap-2 px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground font-medium"
              onClick={handleLogout}
              tooltip="Log out"
            >
              <LogOut className="w-4 h-4" />
              <span className="group-data-[collapsible=icon]:hidden">Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="flex items-center justify-between gap-2 mt-2 px-2 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />
            <span>Operational</span>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <span className="text-[10px] text-muted-foreground/40 font-mono">{import.meta.env.VITE_APP_VERSION ?? 'dev'}</span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
