import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import '@testing-library/jest-dom';

// Mock dependencies used inside AuthProvider
vi.mock('wouter', () => ({
  useLocation: () => ['/dashboard', vi.fn()],
}));

vi.mock('@domain-ui/core/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@domain-ui/core/ui/hooks/use-error-toast', () => ({
  useErrorToast: () => ({ notify: vi.fn() }),
}));

vi.mock('@/lib/queryClient', () => ({
  getQueryClient: vi.fn(),
  apiRequest: vi.fn(),
}));

import { getQueryClient } from '@/lib/queryClient';
import { AuthProvider, useAuth } from './use-auth.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test wrapper helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function makeWrapper(queryClient: QueryClient) {
  vi.mocked(getQueryClient).mockReturnValue(queryClient as any);
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('useAuth', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null user initially (no cached data, no network)', () => {
    const wrapper = makeWrapper(qc);
    const { result } = renderHook(() => useAuth(), { wrapper });
    // No cache seeded → user is null
    expect(result.current.user).toBeNull();
  });

  it('returns the user when the query cache is pre-seeded with an authenticated response', async () => {
    const mockUserData = {
      id: 'u-1',
      username: 'alice',
      email: 'alice@test.com',
      authenticated: true,
    };

    qc.setQueryData(['/api/user'], mockUserData);
    const wrapper = makeWrapper(qc);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.user).not.toBeNull();
    });

    expect(result.current.user?.username).toBe('alice');
  });

  it('does not treat cached identity as server-verified', async () => {
    qc.setQueryData(['/api/user'], {
      id: 'u-stale',
      username: 'cached-user',
      authenticated: true,
    });

    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));

    const wrapper = makeWrapper(qc);
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user?.username).toBe('cached-user');
    expect(result.current.isVerified).toBe(false);

    resolveFetch(new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await waitFor(() => expect(result.current.isVerified).toBe(true));
    expect(result.current.user).toBeNull();
  });

  it('returns null user when the API response has authenticated: false', () => {
    qc.setQueryData(['/api/user'], { authenticated: false });
    const wrapper = makeWrapper(qc);
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
  });

  it('exposes loginMutation, logoutMutation, and registerMutation', () => {
    const wrapper = makeWrapper(qc);
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.loginMutation).toBeDefined();
    expect(result.current.logoutMutation).toBeDefined();
    expect(result.current.registerMutation).toBeDefined();
  });

  it('can() returns false when user is null', () => {
    const wrapper = makeWrapper(qc);
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.can('read:jobs' as any)).toBe(false);
  });

  it('can() returns true for a basic permission when user is authenticated', async () => {
    qc.setQueryData(['/api/user'], {
      id: 'u-2',
      username: 'bob',
      authenticated: true,
    });
    const wrapper = makeWrapper(qc);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.user).not.toBeNull());

    // Basic authenticated users can view their own executions
    expect(result.current.can('exec:view_own' as any)).toBe(true);
  });

  it('exposes adminRole from the API response', async () => {
    qc.setQueryData(['/api/user'], {
      id: 'u-3',
      username: 'admin',
      authenticated: true,
      adminRole: { isSuperAdmin: true, isOrgAdmin: false },
    });
    const wrapper = makeWrapper(qc);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.adminRole).not.toBeNull());
    expect(result.current.adminRole?.isSuperAdmin).toBe(true);
  });

  it('throws if used outside of AuthProvider', () => {
    // Wrap in QueryClientProvider only — no AuthProvider
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    expect(() => renderHook(() => useAuth(), { wrapper })).toThrow();
  });
});

