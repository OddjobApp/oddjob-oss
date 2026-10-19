/**
 * Alert Auto-Rescue Config UI Tests
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApiRequest = vi.fn();

// Mock values that can be changed per-test
let mockConfigData: any = {};
let mockStatsData: any = {};
let mockHistoryData: any = [];

const mockFetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes('/api/alerts/auto-rescue/config')) {
    return Promise.resolve({
      json: async () => mockConfigData,
      ok: true,
    });
  }
  if (url.includes('/api/alerts/auto-rescue/stats')) {
    return Promise.resolve({
      json: async () => mockStatsData,
      ok: true,
    });
  }
  if (url.includes('/api/alerts/auto-rescue/history')) {
    return Promise.resolve({
      json: async () => mockHistoryData,
      ok: true,
    });
  }
  return Promise.resolve({
    json: async () => ({}),
    ok: true,
  });
});

vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock('@domain-ui/core/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// React Context for robust Radix UI Tabs simulation
const TabsContext = React.createContext<any>(null);

vi.mock('@domain-ui/core/ui/components/ui/tabs', () => {
  const Tabs = ({ children, value, onValueChange }: any) => (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div data-testid="mock-tabs" data-value={value}>
        {children}
      </div>
    </TabsContext.Provider>
  );

  const TabsList = ({ children }: any) => <div role="tablist">{children}</div>;
 
  const TabsTrigger = ({ children, value }: any) => {
    const context = React.useContext(TabsContext);
    const active = context?.value === value;
    return (
      <button 
        role="tab" 
        {...{ "aria-selected": active }}
        onClick={() => context?.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  };
 
  const TabsContent = ({ children, value }: any) => {
    const context = React.useContext(TabsContext);
    return context?.value === value ? <div role="tabpanel">{children}</div> : null;
  };
 
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});
 
vi.mock('@domain-ui/core/ui/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, id }: any) => (
    <button 
      role="switch" 
      {...{ "aria-checked": !!checked }} 
      id={id}
      title="Switch Toggle"
      aria-label="Switch Toggle"
      onClick={() => onCheckedChange?.(!checked)}
    >
      Toggle
    </button>
  ),
}));

import AlertAutoRescueConfig from '../../../server/domain/core/ui/modules/components/AlertAutoRescueConfig';

describe('AlertAutoRescueConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;

    // Reset default mock data
    mockConfigData = {
      enabled: true,
      autoRescueCategories: ['system_error', 'pipeline_failure'],
      minSeverity: 'error',
      cooldownMinutes: 5,
      maxPerHour: 10,
      autoApprove: false,
    };

    mockStatsData = {
      totalAutoRescues: 5,
      successfulRescues: 4,
      avgResolutionTime: 300,
      topCategories: [{ category: 'system_error', count: 3 }],
    };

    mockHistoryData = [];
  });

  const renderComponent = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <AlertAutoRescueConfig />
      </QueryClientProvider>
    );
  };

  describe('Settings Tab', () => {
    it('should render master toggle', async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText('Enable Auto-Rescue')).toBeInTheDocument();
      });
    });

    it('should display category toggles', async () => {
      mockConfigData = {
        enabled: true,
        autoRescueCategories: ['system_error'],
        minSeverity: 'error',
        cooldownMinutes: 5,
        maxPerHour: 10,
        autoApprove: false,
      };

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('System Errors')).toBeInTheDocument();
        expect(screen.getByText('Pipeline Failures')).toBeInTheDocument();
      });
    });

    it('should show auto-approval warning', async () => {
      mockConfigData = {
        enabled: true,
        autoRescueCategories: [],
        minSeverity: 'critical',
        cooldownMinutes: 5,
        maxPerHour: 10,
        autoApprove: false,
      };

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Enable Auto-Approval')).toBeInTheDocument();
        expect(screen.getByText(/Warning: This bypasses human review/)).toBeInTheDocument();
      });
    });
  });

  describe('Analytics Tab', () => {
    it('should display statistics cards', async () => {
      mockConfigData = {
        enabled: true,
        autoRescueCategories: [],
        minSeverity: 'error',
        cooldownMinutes: 5,
        maxPerHour: 10,
        autoApprove: false,
      };

      mockStatsData = {
        totalAutoRescues: 10,
        successfulRescues: 8,
        avgResolutionTime: 450,
        topCategories: [
          { category: 'system_error', count: 5 },
          { category: 'pipeline_failure', count: 3 },
        ],
      };

      renderComponent();

      // Switch to analytics tab
      const analyticsTab = await screen.findByRole('tab', { name: /Analytics/i });
      fireEvent.click(analyticsTab);

      await waitFor(() => {
        expect(screen.getByText('Total Auto-Rescues')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
        expect(screen.getByText('Success Rate')).toBeInTheDocument();
        expect(screen.getByText('80%')).toBeInTheDocument();
      });
    });
  });

  describe('History Tab', () => {
    it('should display rescue history', async () => {
      mockConfigData = {
        enabled: true,
        autoRescueCategories: [],
        minSeverity: 'error',
        cooldownMinutes: 5,
        maxPerHour: 10,
        autoApprove: false,
      };

      mockStatsData = {
        totalAutoRescues: 1,
        successfulRescues: 1,
        avgResolutionTime: 300,
        topCategories: [],
      };

      mockHistoryData = [
        {
          id: 1,
          alertId: 101,
          category: 'system_error',
          severity: 'critical',
          message: 'Database connection lost',
          rescueSessionId: 201,
          missionId: 301,
          status: 'RESOLVED',
          createdAt: new Date().toISOString(),
        },
      ];

      renderComponent();

      // Switch to history tab
      const historyTab = await screen.findByRole('tab', { name: /History/i });
      fireEvent.click(historyTab);

      await waitFor(() => {
        expect(screen.getByText('Auto-Rescue History')).toBeInTheDocument();
        expect(screen.getByText('Database connection lost')).toBeInTheDocument();
      });
    });

    it('should show empty state when no history', async () => {
      mockConfigData = {
        enabled: true,
        autoRescueCategories: [],
        minSeverity: 'error',
        cooldownMinutes: 5,
        maxPerHour: 10,
        autoApprove: false,
      };

      mockStatsData = {
        totalAutoRescues: 0,
        successfulRescues: 0,
        avgResolutionTime: 0,
        topCategories: [],
      };

      mockHistoryData = [];

      renderComponent();

      // Switch to history tab
      const historyTab = await screen.findByRole('tab', { name: /History/i });
      fireEvent.click(historyTab);

      await waitFor(() => {
        expect(screen.getByText('No auto-rescue history found')).toBeInTheDocument();
        expect(screen.getByText('Auto-rescue missions will appear here once triggered')).toBeInTheDocument();
      });
    });
  });

  describe('Configuration Changes', () => {
    it('should save configuration changes', async () => {
      mockConfigData = {
        enabled: false,
        autoRescueCategories: [],
        minSeverity: 'error',
        cooldownMinutes: 12,
        maxPerHour: 10,
        autoApprove: false,
      };

      mockStatsData = {
        totalAutoRescues: 0,
        successfulRescues: 0,
        avgResolutionTime: 0,
        topCategories: [],
      };

      mockHistoryData = [];

      mockApiRequest.mockResolvedValueOnce({
        success: true,
        message: 'Auto-rescue configuration updated',
      });

      const { container } = renderComponent();

      await waitFor(() => {
        expect(screen.getByText('12 minutes')).toBeInTheDocument();
      });

      // Toggle the master switch
      const masterToggle = container.querySelector('#master-toggle') as HTMLElement;
      fireEvent.click(masterToggle);

      await waitFor(() => {
        expect(masterToggle).toHaveAttribute('aria-checked', 'true');
      });

      // Save the configuration
      const saveButton = screen.getByRole('button', { name: /Save Configuration/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockApiRequest).toHaveBeenCalledWith(
          'POST',
          '/api/alerts/auto-rescue/config',
          expect.any(Object)
        );
      });
    });
  });
});
