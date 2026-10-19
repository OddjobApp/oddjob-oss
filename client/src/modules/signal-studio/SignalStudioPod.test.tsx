import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SignalStudioPod } from './SignalStudioPod';
import { INDUSTRY_PACKS } from './industry-packs';

// Events the next render's /api/event-primitives query returns; null keeps the default fixture.
const eventsOverride = vi.hoisted(() => ({ events: null as any[] | null }));

// Mock dependencies
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/modules/operations/pages/PredictionIntelligenceDashboard', () => ({
  SpatialH3MapPanel: () => <div data-testid="spatial-h3-map-panel">Spatial H3 Map Panel</div>,
}));

vi.mock('./SignalsDecisionsWorkbench', () => ({
  SignalsDecisionsWorkbench: () => <div data-testid="signals-decisions-workbench">Signals & Decisions Workbench</div>,
}));

vi.mock('@/components/signal-intelligence/spatial/SourcesView', () => ({
  SourcesView: () => <div data-testid="sources-view">Sources View</div>,
}));

vi.mock('@/components/signal-intelligence/spatial/RuleBuilder', () => ({
  RuleBuilder: () => <div data-testid="rule-builder">Rule Builder</div>,
}));

vi.mock('@/components/signal-intelligence/spatial/SubscriptionsView', () => ({
  SubscriptionsView: () => <div data-testid="subscriptions-view">Subscriptions View</div>,
}));

vi.mock('./JsonPathSchemaMapper', () => ({
  JsonPathSchemaMapper: () => <div data-testid="jsonpath-schema-mapper">JSONPath Schema Mapper</div>,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
    useQuery: ({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0]?.startsWith('/api/event-primitives')) {
        if (eventsOverride.events) return { data: eventsOverride.events, isLoading: false };
        return {
          data: [
            {
              id: 'sig-test-1',
              title: 'Red Sea Maritime Corridor Bottleneck',
              eventType: 'corridor_bottleneck',
              severity: 'critical',
              domain: 'supply_chain',
              jurisdiction: 'Global',
              status: 'active',
              detectedAt: new Date().toISOString(),
              confidence: 0.95,
              exposureScore: 82,
              affectedEntitiesCount: 14,
              summary: 'Significant dwell time increase at Bab-el-Mandeb strait affecting container schedules.',
              recommendedAction: 'Re-route via Cape of Good Hope or purchase rail freight alternatives.',
              sourceChannel: 'Maritime AIS Corridors & Port Congestion',
            },
          ],
          isLoading: false,
        };
      }
      if (queryKey[0] === '/api/signal-feeds') {
        return {
          data: [
            {
              id: 1,
              name: 'Maritime AIS Corridors',
              feedType: 'geo_spatial',
              status: 'active',
              failureCount: 0,
              enabled: true,
              lastPolledAt: new Date().toISOString(),
            },
          ],
          isLoading: false,
        };
      }
      return { data: [], isLoading: false };
    },
    useMutation: ({ mutationFn }: any = {}) => ({
      mutate: (arg: any) => mutationFn?.(arg),
      isPending: false,
    }),
  };
});

describe('Industry Intelligence Packs', () => {
  it('defines 7 curated enterprise industry packs including residential distress', () => {
    expect(INDUSTRY_PACKS).toHaveLength(7);
    const ids = INDUSTRY_PACKS.map(p => p.id);
    expect(ids).toContain('residential_distress');
    expect(ids).toContain('supply_chain');
    expect(ids).toContain('regulatory');
    expect(ids).toContain('macroeconomic');
    expect(ids).toContain('cyber_cloud');
    expect(ids).toContain('weather_grid');
    expect(ids).toContain('competitor_corp');
  });

  it('each pack provides business value, default playbook, and valid feeds', () => {
    for (const pack of INDUSTRY_PACKS) {
      expect(pack.name).toBeTruthy();
      expect(pack.targetRole).toBeTruthy();
      expect(pack.businessValue).toBeTruthy();
      expect(pack.defaultPlaybook).toBeTruthy();
      expect(pack.feeds.length).toBeGreaterThan(0);
      for (const feed of pack.feeds) {
        expect(feed.name).toBeTruthy();
        expect(feed.sourceType).toBeTruthy();
        expect(feed.url).toBeTruthy();
        expect(feed.expectedSignals.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('SignalStudioPod', () => {
  it('renders Signal Studio Pod header with business metrics', () => {
    render(<SignalStudioPod />);
    expect(screen.getByText('Signal Studio')).toBeInTheDocument();
    expect(screen.getByText(/Market Sensing & Exposure Triage/i)).toBeInTheDocument();
    expect(screen.getByText(/Intelligence Intake/i)).toBeInTheDocument();
  });

  it('displays the active critical signal card with business exposure metric', () => {
    render(<SignalStudioPod />);
    expect(screen.getAllByText('Red Sea Maritime Corridor Bottleneck')[0]).toBeInTheDocument();
    expect(screen.getByText(/critical exposure/i)).toBeInTheDocument();
    expect(screen.getByText(/Exposure Footprint/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommended Response Playbook/i)).toBeInTheDocument();
  });

  it('invokes onFocusInChat when "Discuss in CREW" is clicked', () => {
    const onFocusInChat = vi.fn();
    render(<SignalStudioPod onFocusInChat={onFocusInChat} />);

    const discussBtn = screen.getByRole('button', { name: /discuss in crew/i });
    fireEvent.click(discussBtn);

    expect(onFocusInChat).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'signal:sig-test-1',
        label: 'Red Sea Maritime Corridor Bottleneck',
        type: 'signal',
      }),
      expect.stringContaining('Red Sea Maritime Corridor Bottleneck')
    );
  });

  it('invokes onFocusInChat with playbook initiative when "Launch Initiative" is clicked', () => {
    const onFocusInChat = vi.fn();
    render(<SignalStudioPod onFocusInChat={onFocusInChat} />);

    const launchBtn = screen.getByRole('button', { name: /launch initiative/i });
    fireEvent.click(launchBtn);

    expect(onFocusInChat).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'signal:sig-test-1',
        type: 'signal',
      }),
      expect.stringContaining('Initiate response playbook')
    );
  });

  it('renders close button and triggers onClose', () => {
    const onClose = vi.fn();
    render(<SignalStudioPod onClose={onClose} />);

    const closeBtn = screen.getByTitle('Close Signal Studio');
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it('renders "Show Chat" when in focus mode and toggles focus mode on click', () => {
    const onToggleFocusMode = vi.fn();
    render(<SignalStudioPod isFocusMode={true} onToggleFocusMode={onToggleFocusMode} />);

    const showChatBtn = screen.getByRole('button', { name: /Show Chat/i });
    expect(showChatBtn).toBeDefined();
    fireEvent.click(showChatBtn);
    expect(onToggleFocusMode).toHaveBeenCalled();
  });

  it('renders "Focus Studio" when in split mode and toggles focus mode on click', () => {
    const onToggleFocusMode = vi.fn();
    render(<SignalStudioPod isFocusMode={false} onToggleFocusMode={onToggleFocusMode} />);

    const focusBtn = screen.getByRole('button', { name: /Focus Studio/i });
    expect(focusBtn).toBeDefined();
    fireEvent.click(focusBtn);
    expect(onToggleFocusMode).toHaveBeenCalled();
  });

  it('supports switching between all 8 studio tabs', () => {
    render(<SignalStudioPod />);

    // Spatial Map tab
    fireEvent.click(screen.getByRole('button', { name: /spatial map/i }));
    expect(screen.getByTestId('spatial-h3-map-panel')).toBeInTheDocument();

    // Signals & Decisions tab
    fireEvent.click(screen.getByRole('button', { name: /signals & decisions/i }));
    expect(screen.getByTestId('signals-decisions-workbench')).toBeInTheDocument();

    // Sources tab
    fireEvent.click(screen.getByRole('button', { name: /sources/i }));
    expect(screen.getByTestId('sources-view')).toBeInTheDocument();

    // Rules tab
    fireEvent.click(screen.getByRole('button', { name: /rules/i }));
    expect(screen.getByTestId('rule-builder')).toBeInTheDocument();
    expect(screen.getByTestId('subscriptions-view')).toBeInTheDocument();

    // Filters tab
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByText(/Custom Signal Filter Builder/i)).toBeInTheDocument();

    // Packs tab
    fireEvent.click(screen.getByRole('button', { name: /packs/i }));
    expect(screen.getByText(/Curated Industry Intelligence Packs/i)).toBeInTheDocument();

    // Ingress Mapper tab
    fireEvent.click(screen.getByRole('button', { name: /ingress mapper/i }));
    expect(screen.getByTestId('jsonpath-schema-mapper')).toBeInTheDocument();
  });

  it('toggles true full-screen mode and responds to Escape key', () => {
    const { container } = render(<SignalStudioPod />);

    const fullScreenBtn = screen.getByTestId('signal-pod-fullscreen-toggle');
    fireEvent.click(fullScreenBtn);

    // Should now contain fixed inset-0 z-50
    expect(container.firstChild).toHaveClass('fixed');
    expect(container.firstChild).toHaveClass('inset-0');
    expect(container.firstChild).toHaveClass('z-50');

    // Press Escape to restore
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(container.firstChild).not.toHaveClass('fixed');
    expect(container.firstChild).not.toHaveClass('inset-0');
  });
});

describe('SignalStudioPod — structured signal for CREW', () => {
  // `event_primitives` rows: no title column, optional location.
  const locatedRow = {
    id: 'evt-located',
    eventType: 'port_congestion',
    targetSector: 'Logistics',
    jurisdiction: 'SG',
    severity: 'High',
    confidenceScore: 0.82,
    extractionTimestamp: new Date().toISOString(),
    sourceUrl: 'https://example.test/feed/9',
    rawText: 'Berth waits reached 4 days. Carriers divert.',
    h3Index: '872830828ffffff',
    dwellMinutes: 5760,
  };
  const unlocatedRow = { ...locatedRow, id: 'evt-plain', h3Index: null, dwellMinutes: null, jurisdiction: undefined };

  afterEach(() => {
    eventsOverride.events = null;
    cleanup();
  });

  it('hands "Discuss in CREW" the event fields, without inventing a jurisdiction', () => {
    eventsOverride.events = [unlocatedRow];
    const onFocusInChat = vi.fn();
    render(<SignalStudioPod onFocusInChat={onFocusInChat} />);
    fireEvent.click(screen.getByRole('button', { name: /discuss in crew/i }));

    const [selection, prompt] = onFocusInChat.mock.calls[0];
    expect(selection).toMatchObject({ id: 'signal:evt-plain', label: 'port congestion', type: 'signal' });
    expect(selection.signal).toMatchObject({ signalId: 'evt-plain', eventType: 'port_congestion', severity: 'High', sector: 'Logistics' });
    expect(selection.signal).not.toHaveProperty('jurisdiction');
    expect(prompt).not.toContain('Global');
  });

  it('disables the spatial send when no signal has a location', () => {
    eventsOverride.events = [unlocatedRow];
    const onFocusInChat = vi.fn();
    render(<SignalStudioPod initialView="spatial" onFocusInChat={onFocusInChat} />);
    const send = screen.getByTitle('No signal has a location yet');
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(onFocusInChat).not.toHaveBeenCalled();
  });

  it('sends the longest-dwelling located signal instead of a fixed alert', () => {
    eventsOverride.events = [unlocatedRow, { ...locatedRow, id: 'evt-short', dwellMinutes: 5 }, locatedRow];
    const onFocusInChat = vi.fn();
    render(<SignalStudioPod initialView="spatial" onFocusInChat={onFocusInChat} />);
    fireEvent.click(screen.getByTitle('Send the longest-dwelling located signal to CREW chat'));

    const [selection, prompt] = onFocusInChat.mock.calls[0];
    expect(selection.id).toBe('signal:evt-located');
    expect(selection.signal).toMatchObject({ h3Index: '872830828ffffff', dwellMinutes: 5760 });
    expect(prompt).toContain('dwell 5760 min');
    expect(prompt).not.toMatch(/anomaly detected/i);
  });
});

describe('SignalStudioPod — Resilient Overview & Intake Triage', () => {
  const unstructuredRow1 = {
    id: 'evt-raw-1',
    eventType: 'unknown',
    targetSector: 'finance',
    jurisdiction: 'unknown',
    severity: 'Medium',
    confidenceScore: 0.6,
    extractionTimestamp: new Date().toISOString(),
    sourceUrl: 'https://finance.example.com/rss',
    rawText: 'September 9 Finance and Pension Advisory Committee meeting agenda is now available. Committee reviews capital allocations.',
  };

  const unstructuredRow2 = {
    id: 'evt-raw-2',
    eventType: 'unknown',
    targetSector: 'supply_chain',
    jurisdiction: 'unknown',
    severity: 'Critical',
    confidenceScore: 0.91,
    extractionTimestamp: new Date().toISOString(),
    sourceUrl: 'https://maritime.example.com/alerts',
    rawText: 'Suez canal traffic halted after container vessel grounded near kilometer 151.',
    h3Index: '8828308281fffff',
  };

  afterEach(() => {
    eventsOverride.events = null;
    cleanup();
  });

  it('resiliently derives clean headlines from rawText instead of rendering "Unknown"', () => {
    eventsOverride.events = [unstructuredRow1, unstructuredRow2];
    render(<SignalStudioPod />);

    // Hero card should show derived title and Finance sector
    expect(screen.getAllByText(/September 9 Finance and Pension Advisory Committee meeting agenda/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Finance/i).length).toBeGreaterThan(0);

    // Should NOT show raw "unknown" pills
    expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(unknown\)/i)).not.toBeInTheDocument();
  });

  it('allows clicking an intake item to update the focused signal in Hero card', () => {
    eventsOverride.events = [unstructuredRow1, unstructuredRow2];
    render(<SignalStudioPod />);

    // Click on Suez canal signal
    const suezItem = screen.getByText(/Suez canal traffic halted/i);
    fireEvent.click(suezItem);

    // Hero card now displays Suez canal signal details and critical exposure
    expect(screen.getAllByText(/Suez canal traffic halted/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Critical Exposure/i)).toBeInTheDocument();
  });

  it('filters signals by search query in the intake list', () => {
    eventsOverride.events = [unstructuredRow1, unstructuredRow2];
    render(<SignalStudioPod />);

    const searchInput = screen.getByPlaceholderText(/Filter signals by headline/i);
    fireEvent.change(searchInput, { target: { value: 'suez' } });

    expect(screen.getByTestId('intake-item-evt-raw-2')).toBeInTheDocument();
    expect(screen.queryByTestId('intake-item-evt-raw-1')).not.toBeInTheDocument();
  });
});

