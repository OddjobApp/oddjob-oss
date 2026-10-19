/**
 * Unit Tests for useDecisionFallbackPolling hook
 *
 * Verifies that the hook:
 * - Starts polling at 30-second intervals when connectionState is 'reconnecting' or 'polling'
 * - Updates pendingCount from the polling response
 * - Stops polling when connectionState returns to 'connected'
 *
 * Requirements: 1.7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDecisionStore } from '../../stores/decision.store';
import { useDecisionFallbackPolling } from '../use-decision-fallback-polling';

// ─── Helpers ────────────────────────────────────────────────────────────────

function resetStore() {
  useDecisionStore.setState({
    pendingCount: 0,
    pendingRequests: [],
    highRiskAgingRequests: [],
    connectionState: 'connected',
    bannerDismissedIds: new Set<number>(),
  });
}

function setConnectionState(state: 'connected' | 'reconnecting' | 'polling') {
  useDecisionStore.setState({ connectionState: state });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useDecisionFallbackPolling', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not poll when connectionState is connected', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    setConnectionState('connected');
    renderHook(() => useDecisionFallbackPolling());

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('polls immediately when connectionState transitions to reconnecting', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ count: 5 }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    setConnectionState('reconnecting');
    renderHook(() => useDecisionFallbackPolling());

    // Allow the immediate poll promise to resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/approvals/pending/count', {
      credentials: 'include',
    });
    expect(useDecisionStore.getState().pendingCount).toBe(5);
  });

  it('polls immediately when connectionState transitions to polling', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ count: 3 }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    setConnectionState('polling');
    renderHook(() => useDecisionFallbackPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/approvals/pending/count', {
      credentials: 'include',
    });
    expect(useDecisionStore.getState().pendingCount).toBe(3);
  });

  it('polls at 30-second intervals', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ count: callCount * 2 }),
      } as any;
    });

    setConnectionState('polling');
    renderHook(() => useDecisionFallbackPolling());

    // Initial poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(callCount).toBe(1);
    expect(useDecisionStore.getState().pendingCount).toBe(2);

    // Advance 30 seconds — second poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(callCount).toBe(2);
    expect(useDecisionStore.getState().pendingCount).toBe(4);

    // Advance another 30 seconds — third poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(callCount).toBe(3);
    expect(useDecisionStore.getState().pendingCount).toBe(6);
  });

  it('stops polling when connectionState returns to connected', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ count: 7 }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    setConnectionState('polling');
    const { rerender } = renderHook(() => useDecisionFallbackPolling());

    // Initial poll fires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Transition back to connected
    act(() => {
      setConnectionState('connected');
    });
    rerender();

    // Clear any pending timers and advance past the 30-second mark
    vi.spyOn(globalThis, 'fetch').mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // No further polling should have occurred
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not update pendingCount when fetch returns non-ok response', async () => {
    const mockResponse = { ok: false, status: 503 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    // Set initial count
    useDecisionStore.setState({ pendingCount: 10 });

    setConnectionState('reconnecting');
    renderHook(() => useDecisionFallbackPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Count should remain unchanged
    expect(useDecisionStore.getState().pendingCount).toBe(10);
  });

  it('does not update pendingCount when fetch throws a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    useDecisionStore.setState({ pendingCount: 8 });

    setConnectionState('polling');
    renderHook(() => useDecisionFallbackPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Count should remain unchanged
    expect(useDecisionStore.getState().pendingCount).toBe(8);
  });

  it('does not update pendingCount when response has no count field', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ highRiskAgingCount: 2 }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    useDecisionStore.setState({ pendingCount: 4 });

    setConnectionState('reconnecting');
    renderHook(() => useDecisionFallbackPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Count should remain unchanged since response had no 'count' field
    expect(useDecisionStore.getState().pendingCount).toBe(4);
  });

  it('cleans up interval on unmount', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ count: 1 }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    setConnectionState('polling');
    const { unmount } = renderHook(() => useDecisionFallbackPolling());

    // Initial poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Unmount and advance past interval
    unmount();
    vi.spyOn(globalThis, 'fetch').mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // No further polling after unmount
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
