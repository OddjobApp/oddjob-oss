import {
  Rocket,
  LayoutDashboard,
  FolderKanban,
  Home,
  Users,
  Briefcase,
  AlertTriangle,
  Settings,
  Key,
  LogOut,
  Brain,
  Network,
  DollarSign,
  Wrench,
  Camera,
  Wand2,
  History,
  Database,
  BarChart3,
  TrendingUp,
  Zap,
  Workflow,
  Bot,
  Shield,
  ShieldCheck,
  Activity,
  FlaskConical,
  Layers,
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
  Sun,
  Moon,
  ClipboardList,
} from 'lucide-react';
import { SmartLink } from '@domain-ui/core/ui/components/shared/SmartLink';
import { useLocation } from 'wouter';
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
  useSidebar,
} from '@domain-ui/core/ui/components/ui/sidebar';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { HatIcon } from '@domain-ui/core/ui/components/shared/HatIcon';
import { useOperationalMode } from '@/contexts/OperationalModeContext';
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { useTheme, LIGHT_MODE_ENABLED } from '@domain-ui/core/ui/components/theme-provider';
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
  icon: React.ComponentType<any>;
  permission?: Permission;
  badge?: number;
  exact?: boolean;
  /** Paths under `url` that belong to another item, so both are not highlighted at once. */
  activeExcept?: string[];
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

function isNavItemActive(item: NavItem, location: string): boolean {
  if (item.activeExcept?.some((prefix) => location === prefix || location.startsWith(prefix + '/'))) return false;
  return item.exact ? location === item.url : location === item.url || location.startsWith(item.url + '/');
}

export default function AppSidebar({ userRole = 'admin', userName = 'Admin User', userEmail = 'admin@oddjob.com' }: AppSidebarProps) {
  const [location] = useLocation();
  const { can, logoutMutation } = useAuth();
  const { theme, setTheme } = useTheme();
  const isDark = theme !== 'light';
  // The hat icon is the mode menu's trigger. It used to reach HatMenu through a
  // `window.__hatMenuToggle` global with a DOM-event fallback, because the menu
  // kept its open state locally where nothing else could reach it. That state
  // now lives in OperationalModeContext, so this is a plain function call.
  const { isHatMenuOpen, toggleHatMenu } = useOperationalMode();
  const { isMobile, setOpenMobile } = useSidebar();

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
        { title: 'Launchpad', url: '/launchpad', icon: Rocket },
        { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
        { title: 'Projects', url: '/projects', icon: FolderKanban },
        { title: 'Operations', url: '/operations', icon: Workflow },
      ]
    },
    {
      label: "Intelligence",
      items: [
        { title: 'Insights', url: '/insights', icon: BarChart3 },
        { title: 'Knowledge', url: '/knowledge', icon: Brain },
      ]
    },
    {
      label: "Management",
      items: [
        { title: 'Policies', url: '/control/policies', icon: ShieldCheck },
        { title: 'Health', url: '/health', icon: HeartPulse },
        { title: 'Platform', url: '/platform', icon: Server },
      ]
    },
    {
      label: "Armory",
      items: [
        { title: 'Apps', url: '/armory', icon: Hammer, activeExcept: ['/armory/forms'] },
        { title: 'Forms', url: '/armory/forms', icon: ClipboardList },
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
      { title: 'E2E Tests', url: '/health/e2e-tests', icon: ShieldCheck },
    ]
  };

  const connectionsNavGroup: NavGroup = {
    label: "Connections",
    items: [
      { title: 'Connections Overview', url: '/connections', icon: Network, exact: true },
      { title: 'Get Started', url: '/connections/get-started', icon: Zap },
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
      { title: 'Knowledge Packs', url: '/platform-maintenance/knowledge-packs', icon: Shield },
      { title: 'Software Audit', url: '/platform-maintenance/software-audit', icon: Shield },
      { title: 'System Evolution', url: '/platform-maintenance/evolution', icon: Activity },
      { title: 'Autoresearch', url: '/platform-maintenance/autoresearch', icon: TrendingUp },
      { title: 'System Graph', url: '/platform-maintenance/system-graph', icon: Network },
      { title: 'Component Gallery', url: '/platform-maintenance/components', icon: Layers },
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
      <SidebarHeader className="h-[76px] px-3.5 flex items-center justify-start border-b border-sidebar-border bg-muted/20">
        <div className="w-full flex items-center justify-start text-left mt-[5px]">
          <div className="flex items-center justify-start text-left">
            <div className="flex items-center justify-start gap-3 text-left group-data-[collapsible=icon]:justify-center cursor-pointer group">
              <div className="relative group/logo flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // The menu is rendered in the main inset. On mobile the
                    // sidebar is a modal sheet above that inset, so leave the
                    // sheet first or the newly opened menu is hidden behind it.
                    if (isMobile) setOpenMobile(false);
                    toggleHatMenu();
                  }}
                  className="bg-card rounded-full p-[9px] shadow-sm border border-foreground/15 flex items-center justify-center transition-transform duration-500 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Toggle operational mode menu"
                  aria-haspopup="menu"
                  aria-expanded={isHatMenuOpen}
                  aria-controls="hat-menu-cards"
                  // Marks this as the menu's trigger so HatMenu's click-outside
                  // handler does not close the strip a click before reopening it.
                  data-hat-menu-trigger=""
                  data-testid="sidebar-hat-trigger"
                >
                  <HatIcon className="w-[31.8px] h-[31.8px] transition-all duration-500 hover:rotate-12 drop-shadow-sm" />
                </button>
                {/* Decorative hover glow. It is a sibling painted AFTER the
                    button and overlaps it, so without pointer-events-none it
                    swallows every click on the hat — which is why the menu used
                    to need an invisible overlay button to catch them. */}
                <div className="pointer-events-none absolute -inset-1 bg-primary/20 rounded-full blur-md opacity-0 group-hover/logo:opacity-50 transition-opacity duration-700" />
              </div>
              <SmartLink href="/dashboard" className="flex flex-col text-left justify-start group-data-[collapsible=icon]:hidden transition-all duration-300">
                <span className="text-[37.7px] font-black text-foreground tracking-tight leading-none text-left group-hover:text-primary transition-colors">Oddjob</span>
                <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-[0.18em] mt-1 text-left">Agentic Intelligence</span>
              </SmartLink>
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {navigationGroups.map((group) => {
          const visibleItems = group.items.filter(item => !item.permission || can(item.permission));

          if (visibleItems.length === 0) return null;

          return (
            <SidebarGroup key={group.label} className="mt-2.5 first:mt-0">
              <SidebarGroupLabel className="px-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => {
                    const isActive = isNavItemActive(item, location);
                    return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                        className="transition-all duration-200 hover:bg-muted/50 data-[active=true]:bg-primary/10 data-[active=true]:text-primary relative data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1/2 data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:h-7 data-[active=true]:before:w-[3px] data-[active=true]:before:rounded-r data-[active=true]:before:bg-primary group/item"
                      >
                        <SmartLink
                          href={item.url}
                          onClick={item.onClick}
                          data-testid={item.url === '/dashboard' ? 'link-dashboard' : `link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                          className="flex items-center gap-3 w-full px-2"
                        >
                          <item.icon strokeWidth={1.75} className={cn("w-4 h-4 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover/item:text-primary/70")} />
                          <span className="flex-1 font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis group-data-[collapsible=icon]:hidden">{item.title}</span>
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
                <SidebarGroupLabel className="px-4 text-[9px] font-bold uppercase tracking-widest text-muted-foreground cursor-pointer hover:text-primary transition-colors">
                  {activeAdminLabel}
                </SidebarGroupLabel>
              </SmartLink>
              <SidebarGroupContent>
                <SidebarMenu>
                  {activeAdminGroup.items.map((item) => {
                    const isActive = isNavItemActive(item, location);
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          className="hover:bg-muted/50 data-[active=true]:bg-primary/10 data-[active=true]:text-primary relative data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1/2 data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:h-7 data-[active=true]:before:w-[3px] data-[active=true]:before:rounded-r data-[active=true]:before:bg-primary"
                        >
                          <SmartLink href={item.url} className="flex items-center gap-3 w-full px-2">
                            <item.icon strokeWidth={1.75} className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                            <span className="flex-1 font-medium tracking-tight group-data-[collapsible=icon]:hidden">{item.title}</span>
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
                              className="hover:bg-muted/50 data-[active=true]:bg-primary/10 data-[active=true]:text-primary relative data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1/2 data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:h-7 data-[active=true]:before:w-[3px] data-[active=true]:before:rounded-r data-[active=true]:before:bg-primary"
                            >
                              <SmartLink href={item.url} className="flex items-center gap-3 w-full px-2">
                                <item.icon strokeWidth={1.75} className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                                <span className="flex-1 font-medium tracking-tight group-data-[collapsible=icon]:hidden">{item.title}</span>
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
              asChild
              tooltip="Settings"
              className="w-full justify-start gap-2 px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground font-medium"
            >
              <SmartLink href="/settings" className="flex items-center gap-3 w-full">
                <Settings strokeWidth={1.75} className="w-4 h-4 text-muted-foreground" />
                <span className="group-data-[collapsible=icon]:hidden">Settings</span>
              </SmartLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Profile"
              className="w-full justify-start gap-2 px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground font-medium"
            >
              <SmartLink href="/profile" className="flex items-center gap-3 w-full">
                <User strokeWidth={1.75} className="w-4 h-4 text-muted-foreground" />
                <span className="group-data-[collapsible=icon]:hidden">Profile</span>
              </SmartLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {LIGHT_MODE_ENABLED && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                tooltip={isDark ? 'Light mode' : 'Dark mode'}
                className="w-full justify-start gap-2 px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground font-medium"
              >
                {isDark ? (
                  <Sun strokeWidth={1.75} className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Moon strokeWidth={1.75} className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="group-data-[collapsible=icon]:hidden">{isDark ? 'Light mode' : 'Dark mode'}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {/*
            * A list item, not a bare div. axe: list, serious — SidebarMenu
            * renders a <ul>, and a <div> child of one is not a list item.
            */}
          <li className="px-2 py-1.5 group-data-[collapsible=icon]:hidden">
            <Separator className="bg-sidebar-border/30" />
          </li>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="w-full justify-start gap-2 px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground font-medium"
              onClick={handleLogout}
              tooltip="Log out"
            >
              <LogOut strokeWidth={1.75} className="w-4 h-4 text-muted-foreground" />
              <span className="group-data-[collapsible=icon]:hidden">Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="flex items-center justify-between gap-2 mt-2 px-2 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />
            <span>Operational</span>
          </div>
          {/* /40 put this at 3.01:1. axe: color-contrast, serious. */}
            <span className="text-[10px] text-muted-foreground font-mono">{import.meta.env.VITE_APP_VERSION ?? 'dev'}</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
