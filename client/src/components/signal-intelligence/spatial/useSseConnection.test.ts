/**
 * Unit tests for useSseConnection hook.
 * Requirements: 7.6, 7.7, 7.8, 7.9, 7.10
 *
 * Tests:
 * - Opens an EventSource on mount
 * - onReconnect closes existing connection, opens a new one, disables button (7.6)
 * - If reconnect succeeds within 10s, resets elapsed and restores Live badge (7.10)
 * - If reconnect fails within 10s, re-enables button, keeps Disconnected badge (7.7)
 * - onRefresh refetches all spatial queries and disables button until complete (7.8)
 * - On refresh failure, shows error identifying failed queries (7.9)
 * - On refresh success, resets elapsed to zero (7.10)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSseConnection } from './useSseConnection';

// ─── Mock EventSource ─────────────────────────────────────────────────────────

type ESListener = (event: Event | MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  withCredentials: boolean;
  readyState: number = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private listeners: Map<string, ESListener[]> = new Map();
  private closed = false;

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: ESListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: ESListener): void {
    const arr = this.listeners.get(type);
    if (arr) {
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    }
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ─── Test helpers ─────────────────────────────────────────────────────────

  simulateOpen(): void {
    this.readyState = 1;
    const event = new Event('open');
    if (this.onopen) this.onopen(event);
    this.listeners.get('open')?.forEach((l) => l(event));
  }

  simulateMessage(data: string = '{}'): void {
    const event = new MessageEvent('message', { data });
    if (this.onmessage) this.onmessage(event);
    this.listeners.get('message')?.forEach((l) => l(event));
  }

  simulateError(): void {
    const event = new Event('error');
    if (this.onerror) this.onerror(event);
    this.listeners.get('error')?.forEach((l) => l(event));
  }

  static reset(): void {
    MockEventSource.instances = [];
  }

  static latest(): MockEventSource | undefined {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

// ─── Test Setup ───────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    },
    queryClient,
  };
}

describe('useSseConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    (globalThis as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens an EventSource on mount', () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSseConnection(), { wrapper });

    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.latest()!.url).toContain('/api/events/stream');
  });

  it('derives sseStatus as "live" when last event is recent', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    // Simulate open (sets lastEventTime to now)
    const es = MockEventSource.latest()!;
    act(() => { es.simulateOpen(); });

    expect(result.current.sseStatus).toBe('live');
  });

  it('derives sseStatus as "reconnecting" when gap >10s', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es = MockEventSource.latest()!;
    act(() => { es.simulateOpen(); });

    // Advance time beyond 10s
    act(() => { vi.advanceTimersByTime(11_000); });

    expect(result.current.sseStatus).toBe('reconnecting');
  });

  it('derives sseStatus as "disconnected" when gap >30s', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es = MockEventSource.latest()!;
    act(() => { es.simulateOpen(); });

    // Advance time beyond 30s
    act(() => { vi.advanceTimersByTime(31_000); });

    expect(result.current.sseStatus).toBe('disconnected');
  });

  // ─── Reconnect tests (Req 7.6, 7.7, 7.10) ─────────────────────────────────

  it('onReconnect closes existing EventSource and opens a new one (7.6)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    act(() => { result.current.onReconnect(); });

    expect(es1.isClosed).toBe(true);
    expect(MockEventSource.instances.length).toBe(2);
    expect(result.current.isReconnecting).toBe(true);
  });

  it('onReconnect success resets elapsed and restores Live badge (7.10)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    // Advance time so elapsed is not zero
    act(() => { vi.advanceTimersByTime(5_000); });

    act(() => { result.current.onReconnect(); });

    const es2 = MockEventSource.latest()!;

    // Simulate successful open
    act(() => { es2.simulateOpen(); });

    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.sseStatus).toBe('live');
    // lastFetchTime should be reset (recent)
    expect(Date.now() - result.current.lastFetchTime).toBeLessThan(1000);
  });

  it('onReconnect failure within 10s re-enables button, keeps Disconnected badge (7.7)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    act(() => { result.current.onReconnect(); });

    const es2 = MockEventSource.latest()!;

    // Simulate error
    act(() => { es2.simulateError(); });

    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.sseStatus).toBe('disconnected');
    expect(es2.isClosed).toBe(true);
  });

  it('onReconnect timeout after 10s re-enables button and keeps Disconnected badge (7.7)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    // Advance time so the original lastEventTime gap will be >30s by the time timeout fires
    act(() => { vi.advanceTimersByTime(25_000); });

    act(() => { result.current.onReconnect(); });

    expect(result.current.isReconnecting).toBe(true);

    // Advance 10s — timeout fires (total gap from original open is now 35s)
    act(() => { vi.advanceTimersByTime(10_000); });

    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.sseStatus).toBe('disconnected');
  });

  it('onReconnect is no-op while already reconnecting', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    act(() => { result.current.onReconnect(); });
    const countAfterFirst = MockEventSource.instances.length;

    act(() => { result.current.onReconnect(); });
    expect(MockEventSource.instances.length).toBe(countAfterFirst);
  });

  // ─── Refresh tests (Req 7.8, 7.9, 7.10) ──────────────────────────────────

  it('onRefresh refetches queries and disables button until complete (7.8)', async () => {
    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    // Spy on refetchQueries
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue();

    await act(async () => {
      result.current.onRefresh();
    });

    expect(refetchSpy).toHaveBeenCalled();
    expect(result.current.isRefreshing).toBe(false);
  });

  it('onRefresh success resets elapsed to zero (7.10)', async () => {
    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    // Advance time so there's elapsed
    act(() => { vi.advanceTimersByTime(5_000); });

    vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue();

    await act(async () => {
      result.current.onRefresh();
    });

    expect(Date.now() - result.current.lastFetchTime).toBeLessThan(1000);
    expect(result.current.refreshError).toBeNull();
  });

  it('onRefresh failure shows error identifying failed queries (7.9)', async () => {
    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    // Make refetchQueries reject for signal-feeds key
    vi.spyOn(queryClient, 'refetchQueries').mockImplementation(async (options: any) => {
      const key = options?.queryKey?.[0];
      if (key === '/api/signal-feeds') {
        throw new Error('Network error');
      }
    });

    await act(async () => {
      result.current.onRefresh();
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.refreshError).toContain('Feeds');
  });

  it('onRefresh is no-op while already refreshing', async () => {
    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useSseConnection(), { wrapper });

    const es1 = MockEventSource.latest()!;
    act(() => { es1.simulateOpen(); });

    let resolveRefetch: () => void;
    const refetchPromise = new Promise<void>((r) => { resolveRefetch = r; });

    vi.spyOn(queryClient, 'refetchQueries').mockReturnValue(refetchPromise);

    // Start first refresh
    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.current.onRefresh() as unknown as Promise<void>;
    });

    expect(result.current.isRefreshing).toBe(true);

    // Second call should be no-op
    act(() => {
      result.current.onRefresh();
    });

    // Resolve
    await act(async () => {
      resolveRefetch!();
      await refreshPromise!;
    });

    expect(result.current.isRefreshing).toBe(false);
  });
});
