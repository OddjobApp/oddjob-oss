import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getSessionTimeout, setSessionTimeout, useSessionTimeout } from './use-session-timeout.js';

// Mocks must be declared before imports that use them
const mockLogoutMutate = vi.fn();
const mockSetLocation = vi.fn();

vi.mock("@domain-ui/auth/ui/modules/auth/hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'user-1', username: 'testuser' },
    logoutMutation: { mutate: mockLogoutMutate },
  })),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/dashboard', mockSetLocation],
}));

/**
 * window.location is replaced so the redirect target can be asserted. The hook
 * must use a full page load rather than wouter navigation: /auth/* is served by
 * a separate SPA entry (login.html), so a client-side route change never loads
 * the login app.
 */
function stubLocation(pathname = '/dashboard', search = '') {
  const stub = { pathname, search, href: '' };
  Object.defineProperty(window, 'location', {
    value: stub,
    writable: true,
    configurable: true,
  });
  return stub;
}

import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";

// ──────────────────────────────────────────────────────────────────────────────
// Pure utility functions
// ──────────────────────────────────────────────────────────────────────────────

describe('getSessionTimeout', () => {
  beforeEach(() => localStorage.clear());

  it('returns the default 20 minutes when nothing is stored', () => {
    expect(getSessionTimeout()).toBe(20);
  });

  it('returns the stored value when it is >= 5', () => {
    setSessionTimeout(60);
    expect(getSessionTimeout()).toBe(60);
  });

  it('ignores stored values below 5 minutes and falls back to default', () => {
    setSessionTimeout(2);
    expect(getSessionTimeout()).toBe(20);
  });

  it('ignores NaN values', () => {
    localStorage.setItem('sessionTimeoutMinutes', 'not-a-number');
    expect(getSessionTimeout()).toBe(20);
  });
});

describe('setSessionTimeout', () => {
  beforeEach(() => localStorage.clear());

  it('persists the value to localStorage as a string', () => {
    setSessionTimeout(45);
    expect(localStorage.getItem('sessionTimeoutMinutes')).toBe('45');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Hook behaviour
// ──────────────────────────────────────────────────────────────────────────────

describe('useSessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mockLogoutMutate.mockClear();
    mockSetLocation.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exposes resetTimer and getRemainingTime', () => {
    const { result } = renderHook(() => useSessionTimeout());
    expect(typeof result.current.resetTimer).toBe('function');
    expect(typeof result.current.getRemainingTime).toBe('function');
  });

  it('returns 0 remaining time when user is not logged in', () => {
    vi.mocked(useAuth).mockReturnValueOnce({
      user: null,
      logoutMutation: { mutate: mockLogoutMutate },
    } as any);

    const { result } = renderHook(() => useSessionTimeout());
    expect(result.current.getRemainingTime()).toBe(0);
  });

  it('returns a positive remaining time when user is logged in', () => {
    setSessionTimeout(20);
    const { result } = renderHook(() => useSessionTimeout());
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.getRemainingTime()).toBeGreaterThan(0);
  });

  it('calls logoutMutation.mutate after the configured timeout elapses', () => {
    setSessionTimeout(5); // minimum: 5 minutes

    renderHook(() => useSessionTimeout());

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    });

    expect(mockLogoutMutate).toHaveBeenCalledTimes(1);
  });

  // ── The point of the whole hook: the user must end up on the login page. ──

  it('sends the user to the login page once logout resolves', () => {
    setSessionTimeout(5);
    const loc = stubLocation('/dashboard');
    mockLogoutMutate.mockImplementation((_v: unknown, opts: any) => opts?.onSettled?.());

    renderHook(() => useSessionTimeout());
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    });

    expect(loc.href).toContain('/auth/login');
  });

  it('still redirects when the logout request FAILS', () => {
    // The decisive case: the server session is already gone, so POST /api/logout
    // 401s and the mutation errors. A success-only redirect would strand the
    // user on a stale page — which is the bug this asserts against.
    setSessionTimeout(5);
    const loc = stubLocation('/dashboard');
    mockLogoutMutate.mockImplementation((_v: unknown, opts: any) => {
      opts?.onError?.(new Error('Unauthorized'));
      opts?.onSettled?.();
    });

    renderHook(() => useSessionTimeout());
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    });

    expect(loc.href).toContain('/auth/login');
  });

  it('pings the server so it does not expire a present-but-quiet user', () => {
    // react-query has refetchOnWindowFocus:false and a 30s staleTime, so a user
    // reading one page generates no traffic. Without this the server would see
    // an idle session and log out someone who is sitting right there.
    const fetchMock = vi.fn(() => Promise.resolve({} as Response));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useSessionTimeout());

    expect(fetchMock).toHaveBeenCalledWith('/api/user', { credentials: 'include' });
    vi.unstubAllGlobals();
  });

  it('throttles the keepalive rather than pinging on every event', () => {
    const fetchMock = vi.fn(() => Promise.resolve({} as Response));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSessionTimeout());
    act(() => {
      result.current.resetTimer();
      result.current.resetTimer();
      result.current.resetTimer();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('preserves the current page as returnTo', () => {
    setSessionTimeout(5);
    const loc = stubLocation('/projects/42', '?tab=files');
    mockLogoutMutate.mockImplementation((_v: unknown, opts: any) => opts?.onSettled?.());

    renderHook(() => useSessionTimeout());
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    });

    expect(loc.href).toBe(
      `/auth/login?returnTo=${encodeURIComponent('/projects/42?tab=files')}`
    );
  });

  it('does NOT fire logout before the timeout has elapsed', () => {
    setSessionTimeout(5);

    renderHook(() => useSessionTimeout());

    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes — still within window
    });

    expect(mockLogoutMutate).not.toHaveBeenCalled();
  });

  it('clears the timer when the component unmounts', () => {
    setSessionTimeout(5);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { unmount } = renderHook(() => useSessionTimeout());
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
