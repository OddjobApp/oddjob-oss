import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import React from 'react';

// Mock wouter
vi.mock('wouter', () => ({
  useLocation: () => ['/apps/forge', vi.fn()],
}));

// Mock toast
vi.mock('@domain-ui/core/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn() },
  apiRequest: vi.fn(),
}));

import { apiRequest as mockApiRequest } from '@/lib/queryClient';

// Mock react-query
const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: (args: any) => mockUseQuery(args),
  useMutation: (args: any) => mockUseMutation(args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// UI Stubs
vi.mock('@domain-ui/core/ui/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div data-testid="card" className={className}>{children}</div>,
  CardContent: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardHeader: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardTitle: ({ children, className }: any) => <h3 className={className}>{children}</h3>,
  CardDescription: ({ children, className }: any) => <p className={className}>{children}</p>,
  CardFooter: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock('@domain-ui/core/ui/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className, variant }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} data-variant={variant}>{children}</button>
  ),
}));

vi.mock('@domain-ui/core/ui/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@domain-ui/core/ui/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

vi.mock('@domain-ui/core/ui/components/ui/label', () => ({
  Label: ({ children, className }: any) => <label className={className}>{children}</label>,
}));

vi.mock('@domain-ui/core/ui/components/ui/select', () => ({
  Select: ({ children }: any) => (
    <div data-testid="select-wrapper">
      {children}
    </div>
  ),
  SelectTrigger: ({ children, 'aria-label': ariaLabel }: any) => (
    <button role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label={ariaLabel || "Select"} title={ariaLabel || "Select"}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => (
    <div data-testid="select-content">
      {children}
    </div>
  ),
  SelectItem: ({ children, value }: any) => (
    <div data-testid="select-item" data-value={value}>
      {children}
    </div>
  ),
}));

vi.mock('@domain-ui/core/ui/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Sparkles: () => <span>Sparkles</span>,
  ShieldCheck: () => <span>ShieldCheck</span>,
  ExternalLink: () => <span>ExternalLink</span>,
  Activity: () => <span>Activity</span>,
  Palette: () => <span>Palette</span>,
  ChevronDown: () => <span>ChevronDown</span>,
  ChevronUp: () => <span>ChevronUp</span>,
  CircuitBoard: () => <span>CircuitBoard</span>,
  Cpu: () => <span>Cpu</span>,
  Layers: () => <span>Layers</span>,
  Upload: () => <span>Upload</span>,
  FileText: () => <span>FileText</span>,
  ImageIcon: () => <span>ImageIcon</span>,
  Tag: () => <span>Tag</span>,
  X: () => <span>X</span>,
  Zap: () => <span>Zap</span>,
  Bot: () => <span>Bot</span>,
  Hammer: () => <span>Hammer</span>,
  ArrowLeft: () => <span>ArrowLeft</span>,
  ArrowRight: () => <span>ArrowRight</span>,
  Rocket: () => <span>Rocket</span>,
  AlertCircle: () => <span>AlertCircle</span>,
  CheckCircle2: () => <span>CheckCircle2</span>,
  XCircle: () => <span>XCircle</span>,
  AlertTriangle: () => <span>AlertTriangle</span>,
  Info: () => <span>Info</span>,
  RefreshCw: () => <span>RefreshCw</span>,
  Cloud: () => <span>Cloud</span>,
  LayoutGrid: () => <span>LayoutGrid</span>,
  Search: () => <span>Search</span>,
  ChevronLeft: () => <span>ChevronLeft</span>,
  MessageCircle: () => <span>MessageCircle</span>,
  Plug2: () => <span>Plug2</span>,
  Dna: () => <span>Dna</span>,
  Target: () => <span>Target</span>,
  ScanEye: () => <span>ScanEye</span>,
  LayoutTemplate: () => <span>LayoutTemplate</span>,
  Terminal: () => <span>Terminal</span>,
  Monitor: () => <span>Monitor</span>,
  Code2: () => <span>Code2</span>,
  Plus: () => <span>Plus</span>,
  Trash2: () => <span>Trash2</span>,
  Save: () => <span>Save</span>,
  Blocks: () => <span>Blocks</span>,
  Braces: () => <span>Braces</span>,
  Shield: () => <span>Shield</span>,
  MessageSquare: () => <span>MessageSquare</span>,
  Globe: () => <span>Globe</span>,
  Bell: () => <span>Bell</span>,
  BrainCircuit: () => <span>BrainCircuit</span>,
  GitBranch: () => <span>GitBranch</span>,
  Circle: () => <span>Circle</span>,
  Bug: () => <span>Bug</span>,
  Heart: () => <span>Heart</span>,
  Compass: () => <span>Compass</span>,
  Lightbulb: () => <span>Lightbulb</span>,
  Brain: () => <span>Brain</span>,
  Play: () => <span>Play</span>,
  Square: () => <span>Square</span>,
  Maximize2: () => <span>Maximize2</span>,
  FileCode2: () => <span>FileCode2</span>,
  FileJson: () => <span>FileJson</span>,
  FileCode: () => <span>FileCode</span>,
  BookOpen: () => <span>BookOpen</span>,
  Database: () => <span>Database</span>,
  Workflow: () => <span>Workflow</span>,
  Wrench: () => <span>Wrench</span>,
  Folder: () => <span>Folder</span>,
  FolderOpen: () => <span>FolderOpen</span>,
  Send: () => <span>Send</span>,
  Loader2: () => <span>Loader2</span>,
  ChevronRight: () => <span>ChevronRight</span>,
  ChevronsUpDown: () => <span>ChevronsUpDown</span>,
  Check: () => <span>Check</span>,
}));

vi.mock('@/modules/missions/components/widgets/WaveGovernancePanel', () => ({
  default: ({ jobId }: any) => <div data-testid="wave-governance-panel">Wave Governance for {jobId}</div>
}));

// Helper Components
vi.mock('../components/BlueprintGallery', () => ({
  BlueprintGallery: ({ onSelect, selectedSlug }: any) => (
    <div data-testid="blueprint-gallery">
      <button onClick={() => onSelect('chat-assistant')}>Select Chat</button>
      {selectedSlug && <span>Selected: {selectedSlug}</span>}
    </div>
  ),
}));

vi.mock('../components/ForgeConsole', () => ({
  ForgeConsole: ({ logs, status }: any) => (
    <div data-testid="forge-console">
      <span>Status: {status}</span>
      <ul>{logs.map((l: any, i: number) => <li key={i}>{l.message}</li>)}</ul>
    </div>
  ),
}));

import AppForge from './AppForge.js';

describe('AppForge Hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks
    mockUseQuery.mockImplementation((opts: any) => {
        const key = opts.queryKey?.[0];
        if (key === '/api/missions') {
            return { data: [{ id: 1, name: 'Mission Alpha' }], isLoading: false };
        }
        if (key === '/api/apps/blueprints') {
            return { data: ['chat-assistant', 'forensic-audit'], isLoading: false };
        }
        return { data: undefined, isLoading: false };
    });

    mockUseMutation.mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        data: undefined
    });
  });

  it('renders correctly on the first step (Blueprint Selection)', () => {
    render(<AppForge />);
    expect(screen.getAllByText(/App Forge/i)[0]).toBeInTheDocument();
    expect(screen.getByTestId('blueprint-gallery')).toBeInTheDocument();
    expect(screen.getByText(/Build with AI/i)).toBeEnabled();
  });

  it('selects a blueprint and shows config step', async () => {
    const user = userEvent.setup();
    render(<AppForge />);
    
    const selectBtn = screen.getByText('Select Chat');
    fireEvent.click(selectBtn);
    
    expect(screen.getByText(/Selected: chat-assistant/i)).toBeInTheDocument();
  });

  it('navigates to the configuration step', async () => {
    const user = userEvent.setup();
    render(<AppForge />);
    
    fireEvent.click(screen.getByText('Select Chat'));
    await user.click(screen.getByText(/Continue to Config/i));
    
    expect(screen.getByText(/Logic Configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/Ignite Forge/i)).toBeDisabled(); // Name missing
  });

  it('transitions to forge ignition when config is valid', async () => {
    const user = userEvent.setup();
    render(<AppForge />);
    
    // Step 1
    fireEvent.click(screen.getByText('Select Chat'));
    await user.click(screen.getByText(/Continue to Config/i));
    
    // Step 2
    const nameInput = screen.getByPlaceholderText(/Finance GPT Assistant/i);
    await user.type(nameInput, 'Test App');
    
    // Slug is auto-generated and readOnly
    const slugInput = screen.getByDisplayValue('test-app');
    expect(slugInput).toBeInTheDocument();
    
    const igniteBtn = screen.getByText(/Ignite Forge/i);
    expect(igniteBtn).not.toBeDisabled();
  });

  it('shows the console when forging starts', async () => {
    const mockMutate = vi.fn();
    mockUseMutation.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
        data: { success: true, jobId: 'job-123' }
    });
    
    const user = userEvent.setup();
    render(<AppForge />);
    
    // Move to step 2
    fireEvent.click(screen.getByText('Select Chat'));
    await user.click(screen.getByText(/Continue to Config/i));
    
    // Fill config
    await user.type(screen.getByPlaceholderText(/Finance GPT Assistant/i), 'Test App');
    
    // Click Ignite
    await user.click(screen.getByText(/Ignite Forge/i));
    
    expect(mockMutate).toHaveBeenCalled();
  });

  it('renders WaveGovernancePanel when status is awaiting_wave_approval', async () => {
    // Mock recovery of an active job awaiting wave approval
    mockUseQuery.mockImplementation((opts: any) => {
        const key = opts.queryKey?.[0];
        if (key === '/api/apps/forge/active') {
            return { data: { active: true, jobId: 'job-active-wave' }, isLoading: false };
        }
        if (key === '/api/apps/forge/status/job-active-wave') {
            return { 
                data: { 
                    status: 'awaiting_wave_approval', 
                    currentWaveId: 'wave_1',
                    nextWaveId: 'wave_2',
                    canFinishEarly: true
                }, 
                isLoading: false 
            };
        }
        return { data: undefined, isLoading: false };
    });

    // Mock apiRequest for recovery bootstrap
    (mockApiRequest as any).mockImplementation((method: string, url: string) => {
        if (url === '/api/apps/forge/active') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ active: true, jobId: 'job-active-wave' })
            });
        }
        if (url === '/api/apps/forge/status/job-active-wave') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ 
                    status: 'awaiting_wave_approval', 
                    currentWaveId: 'wave_1',
                    nextWaveId: 'wave_2',
                    canFinishEarly: true
                })
            });
        }
        return Promise.resolve({ ok: false });
    });

    render(<AppForge />);

    await waitFor(() => {
        expect(screen.getByTestId('wave-governance-panel')).toBeInTheDocument();
    });
    expect(screen.getByText(/Wave Governance for job-active-wave/i)).toBeInTheDocument();
  });
});

