import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import React from 'react';

const { mockUseOrgContext } = vi.hoisted(() => ({
  mockUseOrgContext: vi.fn(() => ({ isAdmin: true })),
}));

vi.mock('@domain-ui/core/ui/hooks/use-org-context', () => ({
  useOrgContext: () => mockUseOrgContext(),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/apps', vi.fn()],
}));

vi.mock('@domain-ui/core/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn() },
  apiRequest: vi.fn(),
}));

const mockUseQuery = vi.fn((..._args: any[]) => ({ data: undefined, isLoading: false }));
const mockUseMutation = vi.fn((..._args: any[]) => ({ mutate: vi.fn(), isPending: false }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (args: any) => mockUseQuery(args),
  useMutation: (args: any) => mockUseMutation(args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Minimal UI stubs
vi.mock('@domain-ui/core/ui/components/ui/tabs', () => ({
  Tabs: ({ children }: any) => <div data-testid="tabs-root">{children}</div>,
  TabsList: ({ children }: any) => (
    <div data-testid="tablist" aria-label="App Marketplace Navigation">
      {children}
    </div>
  ),
  TabsTrigger: ({ children, value, onClick }: any) => (
    <button 
      data-testid="tab" 
      data-state="inactive"
      onClick={onClick}
    >
      {children}
    </button>
  ),
  TabsContent: ({ children, value }: any) => (
    <div role="tabpanel" data-testid={`tab-content-${value}`}>
      {children}
    </div>
  ),
}));
vi.mock('@domain-ui/core/ui/components/ui/card', () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@domain-ui/core/ui/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid={props['data-testid']}>{children}</button>
  ),
}));
vi.mock('@domain-ui/core/ui/components/ui/badge', () => ({
  Badge: ({ children, variant }: any) => <span data-testid="badge" data-variant={variant}>{children}</span>,
}));
vi.mock('@domain-ui/core/ui/components/ui/input', () => ({
  Input: ({ placeholder, value, onChange, ...props }: any) => (
    <input placeholder={placeholder} value={value} onChange={onChange} {...props} />
  ),
}));
vi.mock('@domain-ui/core/ui/components/ui/label', () => ({
  Label: ({ children }: any) => <label>{children}</label>,
}));
vi.mock('@domain-ui/core/ui/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));
vi.mock('@domain-ui/core/ui/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));
vi.mock('@domain-ui/core/ui/components/ui/select', () => ({
  Select: ({ children }: any) => <div data-testid="select-root">{children}</div>,
  SelectTrigger: ({ children, 'aria-label': ariaLabel }: any) => (
    <button aria-expanded="false" aria-label={ariaLabel || "Filter"} title={ariaLabel || "Filter"}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div data-testid="listbox" aria-label="Options">{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-testid="option" data-value={value}>{children}</div>,
}));
vi.mock('@domain-ui/core/ui/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div data-testid="dropdown-menu">{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@domain-ui/core/ui/components/ui/sheet', () => ({
  Sheet: ({ children }: any) => <div data-testid="sheet">{children}</div>,
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetTrigger: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@domain-ui/core/ui/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => <div data-testid="dialog" data-state={open ? 'open' : 'closed'}>{children}</div>,
  DialogContent: ({ children }: any) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogTrigger: ({ children, asChild }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('lucide-react', () => ({
  Loader2: () => <span>Loading</span>,
  Download: () => <span>Download</span>,
  ExternalLink: () => <span>ExternalLink</span>,
  Settings: () => <span>Settings</span>,
  Bot: () => <span>Bot</span>,
  LayoutTemplate: () => <span>LayoutTemplate</span>,
  Search: () => <span>Search</span>,
  SortAsc: () => <span>SortAsc</span>,
  Hammer: () => <span>Hammer</span>,
  Sparkles: () => <span>Sparkles</span>,
  Filter: () => <span>Filter</span>,
  MoreVertical: () => <span>MoreVertical</span>,
  PlayCircle: () => <span>PlayCircle</span>,
  PauseCircle: () => <span>PauseCircle</span>,
  Star: () => <span>Star</span>,
  MessageSquare: () => <span>MessageSquare</span>,
  Code: () => <span>Code</span>,
  RefreshCw: () => <span>RefreshCw</span>,
  ChevronDown: () => <span>ChevronDown</span>,
  ChevronRight: () => <span>ChevronRight</span>,
  ShieldCheck: () => <span>ShieldCheck</span>,
  Clock3: () => <span>Clock3</span>,
  PackageCheck: () => <span>PackageCheck</span>,
  Boxes: () => <span>Boxes</span>,
  Eye: () => <span>Eye</span>,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    ul: ({ children, ...props }: any) => <ul {...props}>{children}</ul>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

import AppMarketplace from './AppMarketplace.js';
import { apiRequest } from '@/lib/queryClient';

const MARKET_APPS = [
  { id: 1, name: 'CRM Assistant', slug: 'crm-assistant', description: 'Automate CRM tasks', version: '1.0', isPublic: true },
  { id: 2, name: 'Data Extractor', slug: 'data-extractor', description: 'Extract structured data', version: '2.0', isPublic: true },
];

const INSTALLED_DEPLOYMENTS = [
  {
    source: 'app',
    id: 'app-1',
    title: 'Prospecting',
    description: 'Lead generation',
    status: 'live',
    publicPath: '/app/prospecting',
    configurePath: '/armory/apps/3',
    app: { id: 3, name: 'Prospecting', slug: 'prospecting', description: 'Lead generation', version: '1.0', isPublic: false, status: 'active' },
    deployment: { id: 1, appId: 3, status: 'active', isPublished: true, publicSlug: 'prospecting' },
  },
  {
    source: 'agent_ai',
    id: 'agent-9',
    title: 'Revenue Coach',
    description: 'Helps reps prepare deals',
    status: 'live',
    publicPath: '/a/revenue-coach',
    configurePath: '/agents/91?tab=publish',
    agentDeployment: {
      id: 9,
      jobId: 91,
      slug: 'revenue-coach',
      title: 'Revenue Coach',
      description: 'Helps reps prepare deals',
      allowedPipelineIds: [7, 8],
      pipelineNames: ['Intake', 'Follow-up'],
      stats: { averageRating: '1.0', totalInteractions: 12 },
    },
  },
];

function setupQueryMocks(overrides: Record<string, any> = {}) {
  mockUseQuery.mockImplementation((options: any) => {
    const key = Array.isArray(options.queryKey) ? options.queryKey[0] : options.queryKey;
    if (key === '/api/apps/market') return { data: overrides.market ?? MARKET_APPS, isLoading: false };
    if (key === '/api/apps/fleet') return { data: overrides.fleet ?? INSTALLED_DEPLOYMENTS, isLoading: false };
    if (key === '/api/apps/installed') return { data: overrides.installed ?? [], isLoading: false };
    if (key === '/api/apps/blueprints') return { data: ['chat-assistant', 'copilotkit-starter'], isLoading: false };
    return { data: undefined, isLoading: false };
  });
}

describe('AppMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrgContext.mockReturnValue({ isAdmin: true });
    setupQueryMocks();
  });

  it('renders the Marketplace and Installed tabs', () => {
    render(<AppMarketplace />);
    expect(screen.getByRole('button', { name: /Marketplace/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Installed/i }).length).toBeGreaterThan(0);
  });

  it('renders market app names and descriptions', () => {
    render(<AppMarketplace />);
    expect(screen.getByText('CRM Assistant')).toBeInTheDocument();
    expect(screen.getByText('Automate CRM tasks')).toBeInTheDocument();
    expect(screen.getByText('Data Extractor')).toBeInTheDocument();
  });

  it('shows skeleton placeholders while data is loading', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true });
    render(<AppMarketplace />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('filters market apps by search term (case-insensitive)', async () => {
    const user = userEvent.setup();
    render(<AppMarketplace />);

    const searchInput = screen.getByPlaceholderText('Search apps by name, tag, or capability');
    await user.type(searchInput, 'crm');

    expect(screen.getByText('CRM Assistant')).toBeInTheDocument();
    expect(screen.queryByText('Data Extractor')).not.toBeInTheDocument();
  });

  it('shows "No apps found" message when search matches nothing', async () => {
    const user = userEvent.setup();
    render(<AppMarketplace />);

    await user.type(screen.getByPlaceholderText('Search apps by name, tag, or capability'), 'zzznomatch');
    expect(screen.getByText(/No Marketplace Apps Match/i)).toBeInTheDocument();
  });

  it('renders installed app names in the Installed tab content', () => {
    render(<AppMarketplace />);
    // Both tab panels are in the DOM; "Your Fleet" panel renders installed apps
    expect(screen.getByText('Prospecting')).toBeInTheDocument();
  });

  it('renders published Agent AIs in the fleet tab content', () => {
    render(<AppMarketplace />);
    expect(screen.getAllByText('Revenue Coach').length).toBeGreaterThan(0);
    expect(screen.getByText(/Agent AI \/ Job 91/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Intake/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/12 Uses/i)).toBeInTheDocument();
  });

  it('opens a published app tab immediately and warms the app in the background', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    vi.mocked(apiRequest).mockResolvedValue({ ok: true } as Response);

    render(<AppMarketplace />);

    await user.click(screen.getByRole('button', { name: /View App/i }));

    expect(openSpy).toHaveBeenCalledWith('/app/prospecting', '_blank');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('POST', '/api/public/apps/prospecting/start', {});
    });

    openSpy.mockRestore();
  });

  it('calls the install mutation when Install is clicked', async () => {
    const mockMutate = vi.fn();
    mockUseMutation.mockReturnValue({ mutate: mockMutate, isPending: false } as any);

    const user = userEvent.setup();
    render(<AppMarketplace />);

    // Component renders "Install App" for the install action
    const installButtons = screen.getAllByText(/Install App/i);
    await user.click(installButtons[0]);

    expect(mockMutate).toHaveBeenCalled();
  });

  it('disables Install button while a mutation is pending', () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: true } as any);
    render(<AppMarketplace />);

    const buttons = screen.getAllByRole('button', { name: /Install App/i });
    buttons.forEach(btn => expect(btn).toBeDisabled());
  });

  it('uses installed deployments as the authority when the fleet read model is stale', () => {
    setupQueryMocks({
      fleet: [],
      installed: [{
        deployment: { id: 44, appId: 1, status: 'installed', isPublished: false, publicSlug: null },
        app: MARKET_APPS[0],
      }],
    });

    render(<AppMarketplace />);

    expect(screen.getByRole('button', { name: /Configure/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Install App/i })).toHaveLength(1);
  });

  it('explains that non-admin users cannot install marketplace apps', () => {
    mockUseOrgContext.mockReturnValue({ isAdmin: false });
    render(<AppMarketplace />);

    const buttons = screen.getAllByRole('button', { name: /Organization admin required/i });
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it('renders "Forge New App" button', () => {
    render(<AppMarketplace />);
    // Component renders "Ignite Forge" button in the hero header
    expect(screen.getByText(/Ignite Forge/i)).toBeInTheDocument();
  });

  it('shows empty state message when no apps are installed', () => {
    setupQueryMocks({ fleet: [] });
    render(<AppMarketplace />);
    expect(screen.getByText(/No Fleet Assets/i)).toBeInTheDocument();
  });
});

