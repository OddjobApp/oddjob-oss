import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SourcesView, type FeedDto } from './SourcesView';

const MOCK_FEEDS: FeedDto[] = [
  {
    id: 101,
    name: 'TechCrunch Technology RSS',
    sourceType: 'rss',
    url: 'https://techcrunch.com/feed/',
    status: 'active',
    enabled: true,
    pollingIntervalSeconds: 900,
    lastPollAt: new Date(Date.now() - 120000).toISOString(),
    consecutiveFailures: 0,
  },
  {
    id: 102,
    name: 'Geospatial H3 Vessel Tracking',
    sourceType: 'geo_spatial',
    url: 'https://api.geospatial.internal/v1/telemetry/stream',
    status: 'active',
    enabled: false,
    pollingIntervalSeconds: 300,
    lastPollAt: new Date(Date.now() - 3600000).toISOString(),
    consecutiveFailures: 0,
  },
];

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(async (method: string, url: string) => {
    if (url === '/api/signal-feeds') {
      return { json: async () => MOCK_FEEDS };
    }
    if (url.startsWith('/api/event-primitives')) {
      return { json: async () => [] };
    }
    return { json: async () => ({}) };
  }),
}));

function renderSourcesView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SourcesView, { organizationId: 1 }),
    ),
  );
}

describe('SourcesView', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders metrics banner with real calculations', async () => {
    renderSourcesView();
    await waitFor(() => {
      expect(screen.getByText('Configured Feeds')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy(); // 2 feeds
      expect(screen.getByText('1 currently active')).toBeTruthy();
      expect(screen.getByText('Automated pollers')).toBeTruthy();
      expect(screen.getByText('Telemetry endpoints')).toBeTruthy();
    });
  });

  it('renders quick pre-fill sample feed buttons and fills form when clicked', async () => {
    renderSourcesView();
    const presetButton = screen.getByRole('button', { name: /TechCrunch Technology RSS/i });
    fireEvent.click(presetButton);

    const nameInput = screen.getByPlaceholderText('e.g. Industry Regulations Feed') as HTMLInputElement;
    expect(nameInput.value).toBe('TechCrunch Technology RSS');

    const urlInput = screen.getByDisplayValue('https://techcrunch.com/feed/') as HTMLInputElement;
    expect(urlInput.value).toBe('https://techcrunch.com/feed/');
  });

  it('renders polling schedule options and allows interval selection', () => {
    renderSourcesView();
    expect(screen.getByText('Every 15 minutes (900s - recommended)')).toBeTruthy();
  });

  it('renders active feed list with details and actions', async () => {
    renderSourcesView();
    await waitFor(() => {
      expect(screen.getByText('Geospatial H3 Vessel Tracking')).toBeTruthy();
      expect(screen.getByText('Active')).toBeTruthy();
      expect(screen.getByText('Paused')).toBeTruthy();
    });
  });

  it('filters feeds by search input', async () => {
    renderSourcesView();
    await waitFor(() => {
      expect(screen.getByText('Geospatial H3 Vessel Tracking')).toBeTruthy();
    });

    const filterInput = screen.getByPlaceholderText('Filter feeds…');
    fireEvent.change(filterInput, { target: { value: 'Geospatial' } });

    expect(screen.queryByRole('cell', { name: /TechCrunch Technology RSS/i })).toBeNull();
    expect(screen.getByText('Geospatial H3 Vessel Tracking')).toBeTruthy();
  });

  it('shows confirmation when delete button is clicked', async () => {
    renderSourcesView();
    await waitFor(() => {
      expect(screen.getByText('Geospatial H3 Vessel Tracking')).toBeTruthy();
    });

    const deleteBtns = screen.getAllByTitle('Disable and remove feed');
    fireEvent.click(deleteBtns[0]);

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('allows collapsing and expanding the Add Source form', async () => {
    renderSourcesView();
    const collapseBtn = screen.getByRole('button', { name: /Collapse Form/i });
    fireEvent.click(collapseBtn);

    // Form body is collapsed
    expect(screen.queryByPlaceholderText('e.g. Industry Regulations Feed')).toBeNull();
    expect(screen.getByText(/Form is collapsed/i)).toBeTruthy();

    // Expand form again
    const expandBtn = screen.getByRole('button', { name: /Expand Form/i });
    fireEvent.click(expandBtn);

    expect(screen.getByPlaceholderText('e.g. Industry Regulations Feed')).toBeTruthy();
  });

  it('shows duplicate URL warning when matching an existing feed URL', async () => {
    renderSourcesView();
    await waitFor(() => {
      expect(screen.getByText('TechCrunch Technology RSS')).toBeTruthy();
    });

    const urlInput = screen.getByPlaceholderText('https://news.example.com/rss.xml');
    fireEvent.change(urlInput, { target: { value: 'https://techcrunch.com/feed/' } });

    expect(screen.getByText(/A configured feed with this URL already exists/i)).toBeTruthy();
  });
});
