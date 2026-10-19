import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@/lib/queryClient';
import { useCycleData } from './hooks';
import { useCycleStore } from './cycleStore';
import type { Cycle } from './types';

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
}));

const cycle: Cycle = {
  id: 95,
  name: 'Autonomous Code Generation Pipeline',
  objective: 'Build and verify a change',
  status: 'active',
  priority: 5,
  budgetLimitUsd: 10,
  requiresApproval: 0,
  recurrence: 'once',
  metadata: {
    blueprints: [
      { name: 'Repository Context Loading', objective: 'Load context', type: 'mission' },
      { name: 'Multi-File Change Planning', objective: 'Plan changes', type: 'mission' },
    ],
  },
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
};

describe('useCycleData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useCycleStore.setState({ currentCycle: null, apps: [] });
  });

  it('keeps cycle blueprints usable when app hydration times out', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    vi.mocked(apiRequest).mockRejectedValue(timeout);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useCycleData(cycle.id, {
      enabled: true,
      initialCycle: cycle,
    }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      'GET',
      '/api/cycles/95/apps',
      undefined,
      15_000,
    ));

    expect(result.current.apps.map(app => app.name)).toEqual([
      'Repository Context Loading',
      'Multi-File Change Planning',
    ]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isHydrated).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('replaces fallback blueprints with hydrated app data', async () => {
    const hydratedApps = [{
      ...cycle.metadata.blueprints![0],
      status: 'running' as const,
      workbenchApps: [],
    }];
    vi.mocked(apiRequest).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ apps: hydratedApps }),
    } as unknown as Response);

    const { result } = renderHook(() => useCycleData(cycle.id, {
      enabled: true,
      initialCycle: cycle,
    }));

    await waitFor(() => expect(result.current.apps).toEqual(hydratedApps));
    expect(useCycleStore.getState().apps).toEqual(hydratedApps);
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
