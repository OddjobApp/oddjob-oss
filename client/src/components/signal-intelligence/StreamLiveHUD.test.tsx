/**
 * Unit tests for StreamLiveHUD component.
 * Validates: Requirements 18.2, 18.3, 18.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StreamLiveHUD } from './StreamLiveHUD';
import { __resetSharedStreams } from '@domain-ui/core/ui/services/shared-event-source';

// ---------------------------------------------------------------------------
// Mock EventSource
// ---------------------------------------------------------------------------

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(url: string, _options?: { withCredentials?: boolean }) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
    }
  }

  close() {
    this.listeners = {};
  }

  // Test helper — simulate a message
  simulateMessage(data: object) {
    const event = new MessageEvent('message', { data: JSON.stringify(data) });
    this.onmessage?.(event);
    (this.listeners['message'] || []).forEach((h) => h(event));
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockEvents = [
  {
    id: 'evt-1',
    organizationId: 1,
    sourceEntryId: 'src-1',
    eventType: 'Tariff_Updated',
    targetSector: 'Semiconductor',
    jurisdiction: 'US',
    severity: 'Critical',
    sourceUrl: 'https://example.com/1',
    extractionTimestamp: new Date(Date.now() - 60000).toISOString(),
    confidenceScore: 0.92,
    rawText: 'US announces new tariff on chips',
    flags: [],
    contentHash: 'hash-1',
    createdAt: new Date(Date.now() - 60000).toISOString(),
    blastRadius: 12,
  },
  {
    id: 'evt-2',
    organizationId: 1,
    sourceEntryId: 'src-2',
    eventType: 'Regulation_Enacted',
    targetSector: 'Finance',
    jurisdiction: 'EU',
    severity: 'High',
    sourceUrl: 'https://example.com/2',
    extractionTimestamp: new Date(Date.now() - 120000).toISOString(),
    confidenceScore: 0.78,
    rawText: 'EU enacts new financial regulation',
    flags: [],
    contentHash: 'hash-2',
    createdAt: new Date(Date.now() - 120000).toISOString(),
    blastRadius: 5,
  },
  {
    id: 'evt-3',
    organizationId: 1,
    sourceEntryId: 'src-3',
    eventType: 'Sanction_Imposed',
    targetSector: 'Energy',
    jurisdiction: 'CN',
    severity: 'Medium',
    sourceUrl: 'https://example.com/3',
    extractionTimestamp: new Date(Date.now() - 300000).toISOString(),
    confidenceScore: 0.55,
    rawText: null,
    flags: [],
    contentHash: 'hash-3',
    createdAt: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: 'evt-4',
    organizationId: 1,
    sourceEntryId: 'src-4',
    eventType: 'Central_Bank_Rate_Change',
    targetSector: 'Finance',
    jurisdiction: 'US',
    severity: 'Low',
    sourceUrl: 'https://example.com/4',
    extractionTimestamp: new Date(Date.now() - 600000).toISOString(),
    confidenceScore: 0.4,
    rawText: null,
    flags: ['low_confidence'],
    contentHash: 'hash-4',
    createdAt: new Date(Date.now() - 600000).toISOString(),
    blastRadius: 0,
  },
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let queryClient: QueryClient;

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource);
  MockEventSource.instances = [];
  __resetSharedStreams();

  // Mock fetch
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockEvents),
  }));

  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamLiveHUD Component', () => {
  // ─── Requirement 18.2: Displays events as real-time scrolling feed ────────

  describe('Requirement 18.2: Real-time scrolling feed with color coding', () => {
    it('renders event cards from fetched data', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('hud-event-card')).toHaveLength(4);
      });
    });

    it('displays event_type for each entry', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        expect(screen.getByText('Tariff Updated')).toBeInTheDocument();
        expect(screen.getByText('Regulation Enacted')).toBeInTheDocument();
        expect(screen.getByText('Sanction Imposed')).toBeInTheDocument();
        expect(screen.getByText('Central Bank Rate Change')).toBeInTheDocument();
      });
    });

    it('displays jurisdiction for each entry', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        const jurisdictionEls = screen.getAllByTitle('Jurisdiction');
        expect(jurisdictionEls.length).toBeGreaterThanOrEqual(3);
        const allText = jurisdictionEls.map((el) => el.textContent || '').join('|');
        expect(allText).toContain('US');
        expect(allText).toContain('EU');
        expect(allText).toContain('CN');
      });
    });

    it('displays confidence_score as percentage', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        const confidenceEls = screen.getAllByTitle('Confidence Score');
        expect(confidenceEls.length).toBeGreaterThanOrEqual(4);
        // Check that 92% and 78% are present somewhere
        const allText = confidenceEls.map((el) => el.textContent || '').join(' ');
        expect(allText).toContain('92%');
        expect(allText).toContain('78%');
      });
    });

    it('displays blast_radius count when present', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        const blastEls = screen.getAllByTitle('Blast Radius');
        expect(blastEls.length).toBeGreaterThanOrEqual(2);
        const allText = blastEls.map((el) => el.textContent || '').join(' ');
        expect(allText).toContain('12 affected');
        expect(allText).toContain('5 affected');
      });
    });

    it('color-codes Critical events with red border', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        const cards = screen.getAllByTestId('hud-event-card');
        const criticalCard = cards.find(
          (c) => c.getAttribute('data-severity') === 'Critical'
        );
        expect(criticalCard).toBeDefined();
        expect(criticalCard!.className).toContain('border-red-500');
      });
    });

    it('color-codes High events with orange border', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        const cards = screen.getAllByTestId('hud-event-card');
        const highCard = cards.find(
          (c) => c.getAttribute('data-severity') === 'High'
        );
        expect(highCard).toBeDefined();
        expect(highCard!.className).toContain('border-orange-500');
      });
    });

    it('color-codes Medium events with yellow border', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        const cards = screen.getAllByTestId('hud-event-card');
        const mediumCard = cards.find(
          (c) => c.getAttribute('data-severity') === 'Medium'
        );
        expect(mediumCard).toBeDefined();
        expect(mediumCard!.className).toContain('border-yellow-500');
      });
    });

    it('color-codes Low events with blue border', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        const cards = screen.getAllByTestId('hud-event-card');
        const lowCard = cards.find(
          (c) => c.getAttribute('data-severity') === 'Low'
        );
        expect(lowCard).toBeDefined();
        expect(lowCard!.className).toContain('border-blue-500');
      });
    });
  });

  // ─── Requirement 18.3: Appends new events within 3s via SSE ───────────────

  describe('Requirement 18.3: Real-time SSE subscription', () => {
    it('connects to SSE endpoint on mount', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThan(0);
        // One unfiltered stream shared by the page; the HUD filters client-side.
        expect(MockEventSource.instances[0].url).toContain('/api/events/stream');
      });
    });

    it('ignores events that are not signal events', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThan(0);
      });

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      MockEventSource.instances[0].simulateMessage({
        eventType: 'mission.completed',
        payload: { id: 7 },
      });

      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['/api/event-primitives'] })
      );
    });

    it('invalidates query cache when SSE signal event is received', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThan(0);
      });

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      MockEventSource.instances[0].simulateMessage({
        eventType: 'signal.event_primitive.created',
        data: { id: 'evt-new' },
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['/api/event-primitives'],
        })
      );
    });

    it('closes SSE connection on unmount', async () => {
      const { unmount } = renderWithProviders(
        <StreamLiveHUD organizationId={1} />
      );

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThan(0);
      });

      const closeSpy = vi.spyOn(MockEventSource.instances[0], 'close');
      unmount();
      // The shared stream closes once its last subscriber is gone, a microtask
      // later, so a remount in the same commit can keep it.
      await waitFor(() => expect(closeSpy).toHaveBeenCalled());
    });
  });

  // ─── Requirement 18.4: Filters ────────────────────────────────────────────

  describe('Requirement 18.4: Filters panel', () => {
    it('opens and closes the filters panel', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      // Filters panel should not be visible initially
      expect(screen.queryByTestId('hud-filters')).not.toBeInTheDocument();

      // Click filter button
      const filterBtn = screen.getByLabelText('Toggle filters');
      await user.click(filterBtn);

      expect(screen.getByTestId('hud-filters')).toBeInTheDocument();

      // Close filters
      await user.click(filterBtn);
      expect(screen.queryByTestId('hud-filters')).not.toBeInTheDocument();
    });

    it('renders severity filter buttons', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await user.click(screen.getByLabelText('Toggle filters'));

      const filtersPanel = screen.getByTestId('hud-filters');
      expect(within(filtersPanel).getByText('Critical')).toBeInTheDocument();
      expect(within(filtersPanel).getByText('High')).toBeInTheDocument();
      expect(within(filtersPanel).getByText('Medium')).toBeInTheDocument();
      expect(within(filtersPanel).getByText('Low')).toBeInTheDocument();
    });

    it('renders target sector dropdown', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await user.click(screen.getByLabelText('Toggle filters'));

      const filtersPanel = screen.getByTestId('hud-filters');
      const sectorSelect = within(filtersPanel).getByDisplayValue('All Sectors');
      expect(sectorSelect).toBeInTheDocument();
    });

    it('renders jurisdiction text input', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await user.click(screen.getByLabelText('Toggle filters'));

      const filtersPanel = screen.getByTestId('hud-filters');
      expect(
        within(filtersPanel).getByPlaceholderText('e.g., US, EU, CN...')
      ).toBeInTheDocument();
    });

    it('renders time range preset buttons (1h, 6h, 24h, 7d)', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await user.click(screen.getByLabelText('Toggle filters'));

      const filtersPanel = screen.getByTestId('hud-filters');
      expect(within(filtersPanel).getByText('1h')).toBeInTheDocument();
      expect(within(filtersPanel).getByText('6h')).toBeInTheDocument();
      expect(within(filtersPanel).getByText('24h')).toBeInTheDocument();
      expect(within(filtersPanel).getByText('7d')).toBeInTheDocument();
    });

    it('highlights the active time range button', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await user.click(screen.getByLabelText('Toggle filters'));

      // Default is 24h
      const filtersPanel = screen.getByTestId('hud-filters');
      const btn24h = within(filtersPanel).getByText('24h');
      expect(btn24h.className).toContain('bg-primary');
    });

    it('severity multi-select filters events client-side', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      // Wait for events to load
      await waitFor(() => {
        expect(screen.getAllByTestId('hud-event-card')).toHaveLength(4);
      });

      // Open filters and select Critical + High
      await user.click(screen.getByLabelText('Toggle filters'));
      const filtersPanel = screen.getByTestId('hud-filters');

      await user.click(within(filtersPanel).getByText('Critical'));
      await user.click(within(filtersPanel).getByText('High'));

      // Should only show Critical and High events (2 cards)
      await waitFor(() => {
        expect(screen.getAllByTestId('hud-event-card')).toHaveLength(2);
      });
    });
  });

  // ─── Auto-scroll behavior ─────────────────────────────────────────────────

  describe('Auto-scroll behavior', () => {
    it('shows resume auto-scroll button when user scrolls down', async () => {
      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('hud-event-card')).toHaveLength(4);
      });

      const feed = screen.getByTestId('hud-event-feed');

      // Simulate user scrolling down
      Object.defineProperty(feed, 'scrollTop', { value: 50, writable: true });
      fireEvent.scroll(feed);

      expect(screen.getByText('Resume auto-scroll')).toBeInTheDocument();
    });
  });

  // ─── Loading state ────────────────────────────────────────────────────────

  describe('Loading state', () => {
    it('shows loading indicator while fetching', () => {
      // Override fetch to be pending
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });

      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      expect(screen.getByText('Loading events...')).toBeInTheDocument();
    });
  });

  // ─── Empty state ──────────────────────────────────────────────────────────

  describe('Empty state', () => {
    it('shows empty message when no events match', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }));
      queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });

      renderWithProviders(<StreamLiveHUD organizationId={1} />);

      await waitFor(() => {
        expect(
          screen.getByText('No events match current filters.')
        ).toBeInTheDocument();
      });
    });
  });
});
