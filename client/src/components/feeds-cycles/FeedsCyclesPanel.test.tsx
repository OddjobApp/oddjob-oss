/**
 * Tests for the Feeds & Cycles mode panel.
 *
 * The panel is a thin read/act surface over two APIs, so the things worth
 * asserting are the ones that were actually wrong or are easy to get wrong:
 * which cycle statuses count as "live", drizzle decimals arriving as STRINGS,
 * and not offering an action the API will reject.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

import { FeedsCyclesPanel } from './FeedsCyclesPanel';

// ---------------------------------------------------------------------------

function cycle(over: Partial<Record<string, unknown>> & { id: number }) {
  return {
    name: `Cycle ${over.id}`,
    objective: 'Do the thing',
    status: 'running',
    priority: 5,
    budgetLimitUsd: null,
    currentSpendUsd: null,
    startDate: null,
    endDate: null,
    nextRunAt: null,
    lastRunAt: null,
    ...over,
  };
}

function feed(over: Partial<Record<string, unknown>> & { id: number }) {
  return {
    name: `Feed ${over.id}`,
    sourceType: 'rss',
    url: 'https://example.test/rss.xml',
    pollingIntervalSeconds: 900,
    enabled: true,
    status: 'active',
    consecutiveFailures: 0,
    lastPollAt: null,
    lastSuccessAt: null,
    ...over,
  };
}

function mission(over: Partial<Record<string, unknown>> & { id: number }) {
  return {
    name: `Mission ${over.id}`,
    objective: 'Advance the objective',
    status: 'active',
    type: 'supervisor_led',
    executionStrategy: 'pre_planned',
    organizationId: 291,
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function workstream(over: Partial<Record<string, unknown>> & { id: string }) {
  return {
    name: `Run ${over.id}`,
    type: 'mission',
    status: 'active',
    lastActivity: '2026-08-01T00:00:00.000Z',
    nodes: [],
    ...over,
  };
}

let queryClient: QueryClient;

/** Routes the default queryFn's apiRequest by URL. */
function stubApi({
  cycles = [] as any[],
  feeds = [] as any[],
  missions = [] as any[],
  workstreams = [] as any[],
} = {}) {
  apiRequest.mockImplementation(async (method: string, url: string) => {
    if (url.startsWith('/api/cycles')) {
      return { json: async () => ({ cycles, total: cycles.length }) };
    }
    if (url.startsWith('/api/signal-feeds')) {
      return { json: async () => feeds };
    }
    if (url.startsWith('/api/missions')) {
      return { json: async () => missions };
    }
    if (url.startsWith('/api/workstreams')) {
      return { json: async () => workstreams };
    }
    return { json: async () => ({}) };
  });
}

function renderPanel() {
  return render(
    <QueryClientProvider client={queryClient}>
      <FeedsCyclesPanel />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        // Mirror the app's default fetcher: the query key IS the URL.
        queryFn: async ({ queryKey }) => {
          const res = await apiRequest('GET', queryKey[0] as string);
          return res.json();
        },
      },
      mutations: { retry: false },
    },
  });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe('rendering', () => {
  it('lists cycles and feeds from the API', async () => {
    stubApi({
      cycles: [cycle({ id: 1, name: 'Vulnerability Patching' })],
      feeds: [feed({ id: 7, name: 'Tech' })],
    });
    renderPanel();

    expect(await screen.findByTestId('cycle-card-1')).toBeInTheDocument();
    expect(await screen.findByTestId('feed-row-7')).toBeInTheDocument();
    expect(screen.getByText('Vulnerability Patching')).toBeInTheDocument();
    expect(screen.getByText('Tech')).toBeInTheDocument();
  });

  it('counts "running" cycles as live', async () => {
    // The defect this guards: the schema comment documents
    // active/planning/paused/... but the API (and DemoSeedService) serve
    // "running". Recognising only the documented set made the panel report
    // "0 live cycles" with two of them listed directly underneath.
    stubApi({ cycles: [cycle({ id: 1, status: 'running' }), cycle({ id: 2, status: 'running' })] });
    renderPanel();

    await screen.findByTestId('cycle-card-1');
    const tile = screen.getByText('Live cycles').closest('div')!.parentElement!;
    expect(within(tile).getByText('2')).toBeInTheDocument();
  });

  it('does not count terminal cycles as live', async () => {
    stubApi({
      cycles: [cycle({ id: 1, status: 'closed' }), cycle({ id: 2, status: 'cancelled' })],
    });
    renderPanel();

    await screen.findByTestId('cycle-card-1');
    const tile = screen.getByText('Live cycles').closest('div')!.parentElement!;
    expect(within(tile).getByText('0')).toBeInTheDocument();
  });

  it('sorts live cycles above dormant ones', async () => {
    stubApi({
      cycles: [
        cycle({ id: 1, name: 'Dormant', status: 'closed' }),
        cycle({ id: 2, name: 'Live', status: 'running' }),
      ],
    });
    renderPanel();

    await screen.findByTestId('cycle-card-1');
    const cards = screen.getAllByTestId(/^cycle-card-/);
    expect(cards[0]).toHaveAttribute('data-testid', 'cycle-card-2');
  });
});

describe('budget rendering', () => {
  it('parses drizzle decimals, which arrive as STRINGS', async () => {
    stubApi({
      cycles: [cycle({ id: 1, budgetLimitUsd: '200.00', currentSpendUsd: '50.00' })],
    });
    renderPanel();

    await screen.findByTestId('cycle-card-1');
    const bar = screen.getByRole('progressbar');
    // 50/200 — Number('50.00') would be NaN only if treated as a non-numeric
    // string, and the width would silently vanish.
    expect(bar).toHaveAttribute('aria-valuenow', '25');
  });

  it('omits the budget bar when the API sends no budget at all', async () => {
    // Demo cycles carry no budget fields; rendering NaN% here was the risk.
    stubApi({ cycles: [cycle({ id: 1, budgetLimitUsd: null, currentSpendUsd: null })] });
    renderPanel();

    await screen.findByTestId('cycle-card-1');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it('omits the bar rather than dividing by a zero limit', async () => {
    stubApi({ cycles: [cycle({ id: 1, budgetLimitUsd: '0.00', currentSpendUsd: '10.00' })] });
    renderPanel();

    await screen.findByTestId('cycle-card-1');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Infinity/);
  });

  it('clamps an over-budget bar to 100% but still reports the real figures', async () => {
    stubApi({
      cycles: [cycle({ id: 1, budgetLimitUsd: '100.00', currentSpendUsd: '250.00' })],
    });
    renderPanel();

    await screen.findByTestId('cycle-card-1');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/\$250/)).toBeInTheDocument();
  });
});

describe('feed actions', () => {
  it('will not offer Poll on a disabled feed — the API 409s', async () => {
    stubApi({ feeds: [feed({ id: 3, enabled: false, status: 'disabled' })] });
    renderPanel();

    expect(await screen.findByTestId('feed-poll-3')).toBeDisabled();
  });

  it('polls an enabled feed and reports what it ingested', async () => {
    stubApi({ feeds: [feed({ id: 3 })] });
    renderPanel();
    await screen.findByTestId('feed-row-3');

    apiRequest.mockImplementationOnce(async () => ({
      json: async () => ({ entries: 4, events: 2 }),
    }));
    await userEvent.click(screen.getByTestId('feed-poll-3'));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('POST', '/api/signal-feeds/3/poll')
    );
    expect(await screen.findByText(/4 entries, 2 events extracted/)).toBeInTheDocument();
  });

  it('toggles a feed via PATCH', async () => {
    stubApi({ feeds: [feed({ id: 3, enabled: true })] });
    renderPanel();
    await screen.findByTestId('feed-row-3');

    await userEvent.click(screen.getByTestId('feed-toggle-3'));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('PATCH', '/api/signal-feeds/3', { enabled: false })
    );
  });

  it('surfaces a failed action instead of silently doing nothing', async () => {
    stubApi({ feeds: [feed({ id: 3 })] });
    renderPanel();
    await screen.findByTestId('feed-row-3');

    apiRequest.mockImplementationOnce(async () => {
      throw new Error('Feed is disabled');
    });
    await userEvent.click(screen.getByTestId('feed-poll-3'));

    expect(await screen.findByText('Feed is disabled')).toBeInTheDocument();
  });

  it('flags consecutive failures on a feed', async () => {
    stubApi({ feeds: [feed({ id: 3, consecutiveFailures: 1, status: 'degraded' })] });
    renderPanel();

    expect(await screen.findByText('1 consecutive failure')).toBeInTheDocument();
    const tile = screen.getByText('Needs attention').closest('div')!.parentElement!;
    expect(within(tile).getByText('1')).toBeInTheDocument();
    expect(within(tile).getByText('1 feed')).toBeInTheDocument();
  });
});

describe('missions', () => {
  it('lists missions and separates live from idle', async () => {
    stubApi({
      missions: [
        mission({ id: 1, status: 'active' }),
        mission({ id: 2, status: 'draft' }),
        mission({ id: 3, status: 'draft' }),
      ],
    });
    renderPanel();

    expect(await screen.findByTestId('mission-row-1')).toBeInTheDocument();
    // Observed live statuses are draft|active — a draft is not doing work.
    expect(screen.getByText('1 live · 2 idle')).toBeInTheDocument();
  });

  it('ranks live missions above idle ones, then by recency', async () => {
    stubApi({
      missions: [
        mission({ id: 1, status: 'draft', updatedAt: '2026-08-09T00:00:00.000Z' }),
        mission({ id: 2, status: 'active', updatedAt: '2026-07-01T00:00:00.000Z' }),
        mission({ id: 3, status: 'active', updatedAt: '2026-08-08T00:00:00.000Z' }),
      ],
    });
    renderPanel();

    await screen.findByTestId('mission-row-2');
    const rows = screen.getAllByTestId(/^mission-row-/);
    // Newest ACTIVE first, then the older active, and the newer draft last.
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'mission-row-3',
      'mission-row-2',
      'mission-row-1',
    ]);
  });

  it('truncates a long mission list instead of rendering a wall of drafts', async () => {
    // The endpoint has no pagination and returned 88 for one org in dev.
    stubApi({ missions: Array.from({ length: 20 }, (_, i) => mission({ id: i + 1 })) });
    renderPanel();

    await screen.findByTestId('mission-overflow');
    expect(screen.getAllByTestId(/^mission-row-/)).toHaveLength(6);
    expect(screen.getByTestId('mission-overflow')).toHaveTextContent('+ 14 more');
  });

  it('survives a mission with no objective or updatedAt', async () => {
    stubApi({ missions: [mission({ id: 1, objective: null, updatedAt: null })] });
    renderPanel();

    expect(await screen.findByTestId('mission-row-1')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Invalid Date|null/);
  });
});

describe('workstreams', () => {
  it('lists workstreams with their trace excerpt', async () => {
    stubApi({
      workstreams: [
        workstream({
          id: '126',
          name: 'Valid Run',
          nodes: [
            { id: 'n1', type: 'activity', label: 'Planning step', sourceType: 'system', createdAt: '' },
            { id: 'n2', type: 'activity', label: 'Execution step', sourceType: 'system', createdAt: '' },
          ],
        }),
      ],
    });
    renderPanel();

    // `id` is a STRING on this endpoint, not a number.
    expect(await screen.findByTestId('workstream-row-126')).toBeInTheDocument();
    expect(screen.getByText('Planning step')).toBeInTheDocument();
  });

  it('renders a workstream whose nodes array is empty', async () => {
    // Most runs have no trace; this is the common case, not an edge case.
    stubApi({ workstreams: [workstream({ id: '1', nodes: [] })] });
    renderPanel();

    expect(await screen.findByTestId('workstream-row-1')).toBeInTheDocument();
  });

  it('tolerates a missing nodes field entirely', async () => {
    const w = workstream({ id: '1' }) as Record<string, unknown>;
    delete w.nodes;
    stubApi({ workstreams: [w] });
    renderPanel();

    expect(await screen.findByTestId('workstream-row-1')).toBeInTheDocument();
  });

  it('counts failed workstreams into "needs attention" alongside degraded feeds', async () => {
    stubApi({
      feeds: [feed({ id: 1, status: 'degraded' })],
      workstreams: [
        workstream({ id: '1', status: 'failed' }),
        workstream({ id: '2', status: 'failed' }),
        workstream({ id: '3', status: 'active' }),
      ],
    });
    renderPanel();

    await screen.findByTestId('workstream-row-1');
    const tile = screen.getByText('Needs attention').closest('div')!.parentElement!;
    // 1 degraded feed + 2 failed workstreams.
    expect(within(tile).getByText('3')).toBeInTheDocument();
    expect(within(tile).getByText(/1 feed · 2 workstreams/)).toBeInTheDocument();
  });

  it('reports all healthy when nothing needs attention', async () => {
    stubApi({ feeds: [feed({ id: 1 })], workstreams: [workstream({ id: '1' })] });
    renderPanel();

    await screen.findByTestId('workstream-row-1');
    const tile = screen.getByText('Needs attention').closest('div')!.parentElement!;
    expect(within(tile).getByText('all healthy')).toBeInTheDocument();
  });
});

describe('states', () => {
  it('shows an empty note when there is nothing configured', async () => {
    stubApi({ cycles: [], feeds: [] });
    renderPanel();

    expect(await screen.findByText(/No cycles yet/)).toBeInTheDocument();
    expect(await screen.findByText(/No signal feeds configured/)).toBeInTheDocument();
  });

  it('reports a failed load rather than rendering an empty panel', async () => {
    stubApi();
    const base = apiRequest.getMockImplementation()!;
    apiRequest.mockImplementation(async (m: string, url: string) => {
      if (url.startsWith('/api/cycles')) throw new Error('boom');
      return base(m, url);
    });
    renderPanel();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Could not load operational cycles/);
    expect(alert).toHaveTextContent(/boom/);
  });

  it('keeps the other sections usable when only cycles fail', async () => {
    // Route by URL rather than returning feeds for everything: each section
    // owns an independent query, and one failing must not blank the rest.
    stubApi({ feeds: [feed({ id: 9 })], missions: [mission({ id: 4 })] });
    const base = apiRequest.getMockImplementation()!;
    apiRequest.mockImplementation(async (m: string, url: string) => {
      if (url.startsWith('/api/cycles')) throw new Error('boom');
      return base(m, url);
    });
    renderPanel();

    expect(await screen.findByTestId('feed-row-9')).toBeInTheDocument();
    expect(await screen.findByTestId('mission-row-4')).toBeInTheDocument();
  });
});
