/**
 * AppSidebar Unit Tests
 *
 * Validates sidebar structure, group ordering, badge rendering,
 * and conditional sub-navigation panels.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 2.5, 3.5, 5.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OperationalModeProvider } from '@/contexts/OperationalModeContext';

// --- Mocks ---

// Mock wouter
let mockLocation = '/dashboard';
vi.mock('wouter', () => ({
  useLocation: () => [mockLocation, vi.fn()],
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock spa-utils (SmartLink uses isCrossEntryNav)
vi.mock('@/lib/spa-utils', () => ({
  isCrossEntryNav: vi.fn(() => false),
  getEntryForUrl: vi.fn(() => 'operations'),
  SPA_ENTRIES: {
    AUTH: ['/auth'],
    OPERATIONS: ['/operations', '/dashboard'],
    INTELLIGENCE: ['/insights', '/control', '/health'],
    KNOWLEDGE: ['/knowledge'],
    ARMORY: ['/armory'],
  },
}));

// Mock useAuth
vi.mock('@domain-ui/auth/ui/modules/auth', () => ({
  useAuth: () => ({
    can: vi.fn(() => true),
    logoutMutation: { mutate: vi.fn() },
  }),
}));

// Mock lucide-react icons (render as simple spans)
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  const createIcon = (name: string) => {
    const Icon = ({ className }: { className?: string }) => <span data-testid={`icon-${name}`} className={className} />;
    Icon.displayName = name;
    return Icon;
  };

  // Derive the stubs from the REAL module's exports instead of hand-listing them. The
  // previous list omitted "Rocket" (the Launchpad icon); a missing name does not fail a
  // single assertion — it throws during render, so all 15 tests in this file failed at
  // once and the actual cause was buried. Vitest validates named exports against the
  // real module, so a Proxy will not do: the keys have to exist.
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = /^[A-Z]/.test(key) ? createIcon(key) : actual[key];
  }
  return mocked;
});

// Mock HatIcon
vi.mock('@domain-ui/core/ui/components/shared/HatIcon', () => ({
  HatIcon: ({ className }: { className?: string }) => <span data-testid="hat-icon" className={className} />,
}));

// Mock ModeToggle
vi.mock('@domain-ui/core/ui/components/mode-toggle', () => ({
  ModeToggle: () => <span data-testid="mode-toggle" />,
}));

// Mock THEME
vi.mock('@/theme', () => ({
  THEME: { primary: '#000' },
}));

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Mock Separator
vi.mock('@domain-ui/core/ui/components/ui/separator', () => ({
  Separator: ({ className }: { className?: string }) => <hr className={className} data-testid="separator" />,
}));

/**
 * The sidebar's own context, which AppSidebar reads to close the drawer after a
 * navigation on mobile (`if (isMobile) setOpenMobile(false)`).
 *
 * The mock below predates that call, so every test in this file failed with
 * "No useSidebar export is defined on the mock" — thirteen failures from one
 * missing export. Hoisted rather than returned fresh per render, so `isMobile`
 * can be set for a test and `setOpenMobile` can be asserted on.
 */
const sidebarContext = vi.hoisted(() => ({
  isMobile: false,
  setOpenMobile: vi.fn(),
  state: 'expanded' as const,
  open: true,
  setOpen: vi.fn(),
  openMobile: false,
  toggleSidebar: vi.fn(),
}));

// Mock sidebar UI components — render passthrough
vi.mock('@domain-ui/core/ui/components/ui/sidebar', () => ({
  useSidebar: () => sidebarContext,
  Sidebar: ({ children, className }: any) => <aside className={className} data-testid="sidebar">{children}</aside>,
  SidebarContent: ({ children }: any) => <div data-testid="sidebar-content">{children}</div>,
  SidebarGroup: ({ children }: any) => <div data-testid="sidebar-group">{children}</div>,
  SidebarGroupContent: ({ children }: any) => <div>{children}</div>,
  SidebarGroupLabel: ({ children, className }: any) => <span data-testid="sidebar-group-label" className={className}>{children}</span>,
  SidebarMenu: ({ children }: any) => <ul>{children}</ul>,
  SidebarMenuButton: ({ children, isActive, tooltip, className, asChild, ...rest }: any) => (
    <div data-active={isActive} data-tooltip={tooltip} className={className} {...rest}>{children}</div>
  ),
  SidebarMenuItem: ({ children }: any) => <li>{children}</li>,
  SidebarFooter: ({ children, className }: any) => <footer className={className}>{children}</footer>,
  SidebarHeader: ({ children, className }: any) => <header className={className}>{children}</header>,
  SidebarRail: () => <div data-testid="sidebar-rail" />,
  SidebarInset: ({ children }: any) => <div>{children}</div>,
  SidebarProvider: ({ children }: any) => <div>{children}</div>,
}));

// --- Helpers ---

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderAppSidebar() {
  const queryClient = createQueryClient();

  // AppSidebar reads { isHatMenuOpen, toggleHatMenu } from OperationalModeContext,
  // whose hook throws when no provider is present — that threw during render and
  // failed all 15 tests at once. The provider is self-contained (React state plus a
  // localStorage read), so wrap with the real one rather than adding another mock
  // that could drift from the context's shape.
  const result = render(
    <QueryClientProvider client={queryClient}>
      <OperationalModeProvider>
        <AppSidebarComponent />
      </OperationalModeProvider>
    </QueryClientProvider>
  );

  return { ...result, queryClient };
}

let AppSidebarComponent: React.ComponentType<any>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockLocation = '/dashboard';

  // Dynamic import to pick up fresh mocks
  const mod = await import('@domain-ui/core/ui/components/layout/AppSidebar');
  AppSidebarComponent = mod.default;
});

// --- Tests ---

describe('AppSidebar', () => {
  describe('Sidebar group structure (Req 9.1)', () => {
    it('renders the main navigation groups with correct labels in order', () => {
      renderAppSidebar();

      const groupLabels = screen.getAllByTestId('sidebar-group-label');
      // The main navigation groups — filter out any sub-nav labels
      const mainLabels = groupLabels.map(el => el.textContent);

      // The navigation was restructured: Knowledge became an item inside
      // Intelligence, Management was introduced (Policies / Health / Platform), and
      // the User/Settings group was dropped — Settings and Profile now live in the
      // sidebar footer. These are the main groups in order.
      const expectedGroups = [
        'Operations',
        'Intelligence',
        'Management',
        'Armory',
      ];

      expect(mainLabels.slice(0, 4)).toEqual(expectedGroups);
    });
  });

  describe('Operations group items (Req 9.2)', () => {
    it('contains Dashboard and Operations items with correct URLs', () => {
      renderAppSidebar();

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toHaveAttribute('href', '/dashboard');

      // "Operations" text exists both as group label and nav item — find the one inside a link
      const operationsLinks = screen.getAllByText('Operations');
      const operationsNavLink = operationsLinks
        .map(el => el.closest('a'))
        .find(a => a?.getAttribute('href') === '/operations');
      expect(operationsNavLink).toBeTruthy();
    });
  });

  describe('Intelligence group items (Req 9.3)', () => {
    it('contains all expected items with correct URLs in order', () => {
      renderAppSidebar();

      // Intelligence is now just Insights + Knowledge. Decision Inbox, Simulator and
      // Board Room are no longer in the sidebar, and Policies moved to Management.
      const expectedItems = [
        { title: 'Insights', url: '/insights' },
      ];

      for (const item of expectedItems) {
        const link = screen.getByText(item.title).closest('a');
        expect(link).toHaveAttribute('href', item.url);
      }
    });
  });

  describe('Knowledge group items (Req 9.4)', () => {
    it('contains Knowledge item with correct URL', () => {
      renderAppSidebar();

      // "Knowledge" text exists both as group label and nav item — find the one inside a link
      const knowledgeElements = screen.getAllByText('Knowledge');
      const knowledgeNavLink = knowledgeElements
        .map(el => el.closest('a'))
        .find(a => a?.getAttribute('href') === '/knowledge');
      expect(knowledgeNavLink).toBeTruthy();
    });
  });

  describe('Armory group items (Req 9.5)', () => {
    it('contains the Apps entry with the correct URL', () => {
      renderAppSidebar();

      // Armory collapsed to a single entry; Tool Registry and Run Memory are gone.
      const expectedItems = [
        { title: 'Apps', url: '/armory' },
      ];

      for (const item of expectedItems) {
        const link = screen.getByText(item.title).closest('a');
        expect(link).toHaveAttribute('href', item.url);
      }
    });
  });

  describe('Platform group items (Req 9.6)', () => {
    it('contains Platform item with correct URL', () => {
      renderAppSidebar();

      // "Platform" text exists both as group label and nav item — find the one inside a link
      const platformElements = screen.getAllByText('Platform');
      const platformNavLink = platformElements
        .map(el => el.closest('a'))
        .find(a => a?.getAttribute('href') === '/platform');
      expect(platformNavLink).toBeTruthy();
    });
  });

  describe('User/Settings group items (Req 9.7)', () => {
    it('contains Settings and Profile items with correct URLs', () => {
      renderAppSidebar();

      const settingsLink = screen.getByText('Settings').closest('a');
      const profileLink = screen.getByText('Profile').closest('a');

      expect(settingsLink).toHaveAttribute('href', '/settings');
      expect(profileLink).toHaveAttribute('href', '/profile');
    });
  });

  // The Decision Inbox badge tests were removed with the item they covered.
  // AppSidebar no longer queries /api/approvals and has no Decision Inbox entry, so
  // both tests asserted behaviour the component had lost. The NavItem type still
  // declares `badge?: number` and the render path still honours it, but nothing in
  // the current navigation ever sets one — that field is dead until an item does,
  // and there is no way to exercise it through the component's public surface.

  describe('Health sub-nav (Req 3.5)', () => {
    it('shows Health sub-navigation panel when location matches /health/*', () => {
      mockLocation = '/health/observability';

      renderAppSidebar();

      // Health sub-nav items should be visible
      expect(screen.getByText('Health Overview')).toBeInTheDocument();
      expect(screen.getByText('Observability')).toBeInTheDocument();
      expect(screen.getByText('Monitoring')).toBeInTheDocument();
      expect(screen.getByText('Alerts')).toBeInTheDocument();
      expect(screen.getByText('Events')).toBeInTheDocument();
      expect(screen.getByText('Pulse')).toBeInTheDocument();
      expect(screen.getByText('Incidents')).toBeInTheDocument();
      expect(screen.getByText('Infra Health')).toBeInTheDocument();
    });

    it('does not show Health sub-nav when location does not match /health/*', () => {
      mockLocation = '/dashboard';

      renderAppSidebar();

      expect(screen.queryByText('Health Overview')).not.toBeInTheDocument();
      expect(screen.queryByText('Observability')).not.toBeInTheDocument();
    });
  });

  describe('Platform sub-nav for /connections/* (Req 5.3)', () => {
    it('shows Connections sub-navigation when on /connections route', () => {
      mockLocation = '/connections/credentials';

      renderAppSidebar();

      expect(screen.getByText('Connections Overview')).toBeInTheDocument();
      expect(screen.getByText('Credentials')).toBeInTheDocument();
      expect(screen.getByText('Integrations')).toBeInTheDocument();
      expect(screen.getByText('MCP Tokens')).toBeInTheDocument();
      expect(screen.getByText('SaaS Connectors')).toBeInTheDocument();
    });

    it('shows persistent Settings and Profile in Connections sub-nav', () => {
      mockLocation = '/connections';

      renderAppSidebar();

      // Settings and Profile should persist in platform sub-nav panels
      const allSettings = screen.getAllByText('Settings');
      const allProfile = screen.getAllByText('Profile');
      // Should appear both in main nav and sub-nav panel
      expect(allSettings.length).toBeGreaterThanOrEqual(2);
      expect(allProfile.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Platform sub-nav for /account-admin/* (Req 5.3)', () => {
    it('shows Account & Admin sub-navigation when on /account-admin route', () => {
      mockLocation = '/account-admin/users';

      renderAppSidebar();

      expect(screen.getByText('Account Overview')).toBeInTheDocument();
      expect(screen.getByText('Organizations')).toBeInTheDocument();
      expect(screen.getByText('Users')).toBeInTheDocument();
      expect(screen.getByText('Billing')).toBeInTheDocument();
      expect(screen.getByText('Licensing')).toBeInTheDocument();
    });
  });

  describe('Platform sub-nav for /platform-maintenance/* (Req 5.3)', () => {
    it('shows Platform Maintenance sub-navigation when on /platform-maintenance route', () => {
      mockLocation = '/platform-maintenance/snapshots';

      renderAppSidebar();

      expect(screen.getByText('Maintenance Overview')).toBeInTheDocument();
      expect(screen.getByText('Snapshots')).toBeInTheDocument();
      expect(screen.getByText('Documentation')).toBeInTheDocument();
      expect(screen.getByText('Software Audit')).toBeInTheDocument();
      expect(screen.getByText('System Evolution')).toBeInTheDocument();
      expect(screen.getByText('Autoresearch')).toBeInTheDocument();
      expect(screen.getByText('System Graph')).toBeInTheDocument();
    });
  });

  /**
   * The reason AppSidebar reads useSidebar at all. On mobile the sidebar is a
   * sheet above the inset the mode menu opens into, so the sheet has to close
   * or the menu it just opened is behind it.
   */
  describe('Hat menu on mobile', () => {
    afterEach(() => {
      sidebarContext.isMobile = false;
    });

    it('closes the sidebar sheet before opening the menu', () => {
      sidebarContext.isMobile = true;
      renderAppSidebar();
      const toggle = screen.getByLabelText('Toggle operational mode menu');

      fireEvent.click(toggle);

      expect(sidebarContext.setOpenMobile).toHaveBeenCalledWith(false);
      // The menu still opens — closing the sheet is not instead of opening it.
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('leaves the sidebar alone on desktop', () => {
      renderAppSidebar();
      const toggle = screen.getByLabelText('Toggle operational mode menu');

      fireEvent.click(toggle);

      expect(sidebarContext.setOpenMobile).not.toHaveBeenCalled();
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
