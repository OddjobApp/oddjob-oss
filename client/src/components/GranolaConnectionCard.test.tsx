import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request }));
import { GranolaConnectionCard } from './GranolaConnectionCard';

function view() { return render(<QueryClientProvider client={new QueryClient()}><GranolaConnectionCard /></QueryClientProvider>); }

describe('Granola connection card', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows the connected user, workspace, and explicit shared-sync warning', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ configured: true, connection: { status: 'connected', accountEmail: 'alex@example.com', workspaceName: 'Oddjob', sync: { enabled: false } } }) });
    view();
    expect(await screen.findByText(/Connected as alex@example.com · Oddjob/)).toBeTruthy();
    expect(screen.getByText(/Everyone with access to that project may find them/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconnect Granola' }).getAttribute('href')).toContain('/api/me/connections/granola/oauth/initiate');
  });
  it('offers personal OAuth connection when disconnected', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ configured: true, connection: null }) });
    view();
    expect(await screen.findByRole('link', { name: 'Connect Granola' })).toBeTruthy();
    expect(screen.queryByText(/Sync notes to project knowledge/)).toBeNull();
  });
});
