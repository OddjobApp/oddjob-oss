import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest }));
import { GranolaPrivateResultsCard } from './GranolaPrivateResultsCard';

const payload = { type: 'granola_private_results' as const, ownerUserId: 'u1', organizationId: 12, sessionKey: 'room-1', query: 'budget', count: 1 };
const json = (body: unknown) => ({ ok: true, json: async () => body });
const mount = (currentUserId: string | null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <GranolaPrivateResultsCard payload={payload} currentUserId={currentUserId} />
  </QueryClientProvider>,
);

beforeEach(() => apiRequest.mockReset());
afterEach(cleanup);

describe('GranolaPrivateResultsCard', () => {
  it('shows someone else only that the matches are private, and fetches nothing', () => {
    mount('u2');
    expect(screen.getByText(/Only the person who asked can see/)).toBeTruthy();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('lists the owner their own matches and shares the one they pick into the room', async () => {
    apiRequest.mockImplementation(async (method: string) => method === 'GET'
      ? json({ meetings: [{ id: 'm1', title: 'Budget review', meetingDate: '2026-10-01T10:00:00Z', attendees: ['Ana'] }] })
      : json({ shared: true, turnId: 9 }));
    mount('u1');
    expect(await screen.findByText('Budget review')).toBeTruthy();
    expect(apiRequest).toHaveBeenCalledWith('GET', '/api/me/connections/granola/meetings?orgId=12&query=budget');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Shared' })).toBeTruthy());
    expect(apiRequest).toHaveBeenCalledWith('POST', '/api/me/connections/granola/share?orgId=12', { sessionKey: 'room-1', meetingId: 'm1' });
  });
});
