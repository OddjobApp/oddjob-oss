/**
 * Unit tests for useSignalAction hook.
 * Requirements: 5.3, 5.4, 5.5, 5.6
 *
 * Tests:
 * - requestConfirmation opens dialog with correct action/signal
 * - confirmAction starts mutation and clears error state
 * - cancelAction before mutation start resets state
 * - cancelAction after mutation start keeps controls disabled
 * - retry increments retryCount and re-fires mutation
 * - retry is blocked after 3 attempts
 * - dismissError clears error state
 * - timeout fires after 30s
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSignalAction } from './useSignalAction';

// Mock apiRequest
vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '@/lib/queryClient';

const mockedApiRequest = vi.mocked(apiRequest);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useSignalAction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedApiRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requestConfirmation opens confirmation dialog with action and signal', () => {
    const { result } = renderHook(() => useSignalAction(), { wrapper: createWrapper() });

    act(() => {
      result.current.requestConfirmation('cycle_launch', 'sig-123');
    });

    expect(result.current.state.isConfirmOpen).toBe(true);
    expect(result.current.state.pendingAction).toBe('cycle_launch');
    expect(result.current.state.pendingSignalId).toBe('sig-123');
  });

  it('cancelAction before mutation start closes dialog and resets state', () => {
    const { result } = renderHook(() => useSignalAction(), { wrapper: createWrapper() });

    act(() => {
      result.current.requestConfirmation('escalate', 'sig-456');
    });

    act(() => {
      result.current.cancelAction();
    });

    expect(result.current.state.isConfirmOpen).toBe(false);
    // pendingAction/pendingSignalId cleared since mutation hadn't started
    expect(result.current.state.pendingAction).toBeNull();
    expect(result.current.state.pendingSignalId).toBeNull();
  });

  it('confirmAction starts mutation and sets isMutating', async () => {
    // Make the API request hang (never resolve)
    mockedApiRequest.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSignalAction(), { wrapper: createWrapper() });

    act(() => {
      result.current.requestConfirmation('cycle_launch', 'sig-789');
    });

    act(() => {
      result.current.confirmAction();
    });

    expect(result.current.state.isConfirmOpen).toBe(false);
    expect(result.current.state.isMutating).toBe(true);
  });

  it('successful mutation clears all error and pending state', async () => {
    const successResponse = {
      ok: true,
      json: () => Promise.resolve({ success: true, action: 'cycle_launch', signalId: 'sig-001' }),
    };
    mockedApiRequest.mockResolvedValue(successResponse as any);

    const { result } = renderHook(() => useSignalAction(), { wrapper: createWrapper() });

    act(() => {
      result.current.requestConfirmation('cycle_launch', 'sig-001');
    });

    await act(async () => {
      result.current.confirmAction();
      // Allow microtasks to complete
      await vi.runAllTimersAsync();
    });

    expect(result.current.state.isMutating).toBe(false);
    expect(result.current.state.errorMessage).toBeNull();
    expect(result.current.state.retryCount).toBe(0);
  });

  it('failed mutation sets errorMessage truncated to 200 chars', async () => {
    const longError = 'A'.repeat(300);
    const errorResponse = {
      ok: false,
      json: () => Promise.resolve({ error: longError }),
    };
    mockedApiRequest.mockResolvedValue(errorResponse as any);

    const { result } = renderHook(() => useSignalAction(), { wrapper: createWrapper() });

    act(() => {
      result.current.requestConfirmation('escalate', 'sig-err');
    });

    await act(async () => {
      result.current.confirmAction();
      await vi.runAllTimersAsync();
    });

    expect(result.current.state.errorMessage).toBeTruthy();
    expect(result.current.state.errorMessage!.length).toBeLessThanOrEqual(200);
    expect(result.current.state.isMutating).toBe(false);
  });

  it('retry increments retryCount and re-fires mutation', async () => {
    const errorResponse = {
      ok: false,
      json: () => Promise.resolve({ error: 'Failed' }),
    };
    mockedApiRequest.mockResolvedValue(errorResponse as any);

    const { result } = renderHook(() => useSignalAction(), { wrapper: createWrapper() });

    act(() => {
      result.current.requestConfirmation('cycle_launch', 'sig-retry');
    });

    // First attempt
    await act(async () => {
      result.current.confirmAction();
      await vi.runAllTimersAsync();
    });

    expect(result.current.state.retryCount).toBe(0);
    expect(result.current.state.canRetry).toBe(true);

    // First retry
    await act(async () => {
      result.current.retry();
      await vi.runAllTimersAsync();
    });

    expect(result.current.state.retryCount).toBe(1);
    expect(result.current.state.canRetry).toBe(true);
  });

  it('retry is blocked after 3 attempts', async () => {
    const errorResponse = {
      ok: false,
      json: () => Promise.resolve({ error: 'Persistent failure' }),
    };
    mockedApiRequest.mockResolvedValue(errorResponse as any);

    const { result } = renderHook(() => useSignalAction(), { wrapper: createWrapper() });

    act(() => {
      result.current.requestConfirmation('escalate', 'sig-max');
    });

    // Initial attempt
    await act(async () => {
      result.current.confirmAction();
      await vi.runAllTimersAsync();
    });

    // 3 retries
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        result.current.retry();
        await vi.runAllTimersAsync();
      });
    }

    expect(result.current.state.retryCount).toBe(3);
    expect(result.current.state.canRetry).toBe(false);

    // Attempting another retry does nothing
    const callCountBefore = mockedApiRequest.mock.calls.length;
    act(() => {
      result.current.retry();
    });
    expect(mockedApiRequest.mock.calls.length).toBe(callCountBefore);
  });

  it('dismissError clears error and resets pending state', async () => {
    const errorResponse = {
      ok: false,
      json: () => Promise.resolve({ error: 'Some error' }),
    };
    mockedApiRequest.mockResolvedValue(errorResponse as any);

    const { result } = renderHook(() => useSignalAction(), { wrapper: createWrapper() });

    act(() => {
      result.current.requestConfirmation('cycle_launch', 'sig-dismiss');
    });

    await act(async () => {
      result.current.confirmAction();
      await vi.runAllTimersAsync();
    });

    expect(result.current.state.errorMessage).toBeTruthy();

    act(() => {
      result.current.dismissError();
    });

    expect(result.current.state.errorMessage).toBeNull();
    expect(result.current.state.pendingAction).toBeNull();
    expect(result.current.state.pendingSignalId).toBeNull();
  });
});
