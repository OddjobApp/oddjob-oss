import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request, resolveActiveOrgId: () => 342 }));
vi.mock('@domain-ui/core/ui/hooks/use-org-context', () => ({ useOrgContextOptional: () => null }));

import { ReauthorizeConnectionsCard } from './ReauthorizeConnectionsCard';

function view(props: Parameters<typeof ReauthorizeConnectionsCard>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ReauthorizeConnectionsCard {...props} /></QueryClientProvider>);
}

const item = (over: Record<string, unknown> = {}) => ({
  kind: 'organization', platform: 'google', label: 'Google Drive', connectorId: 3, projectId: null,
  reason: 'refresh_rejected', since: null,
  reconnectUrl: '/api/saas/connectors/google/oauth/initiate?orgId=342&for=drive',
  opensDashboard: false, canReauthorize: true, ...over,
});

describe('ReauthorizeConnectionsCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when no connection needs reauthorization', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ items: [] }) });
    const { container } = view();
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="reauthorize-connections-card"]')).toBeNull());
  });

  it('links a Google item back through the OAuth initiate route with returnTo', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ items: [item()] }) });
    view();
    const link = await screen.findByRole('link', { name: 'Reauthorize Google Drive' });
    const href = link.getAttribute('href')!;
    expect(href).toContain('/api/saas/connectors/google/oauth/initiate');
    expect(href).toContain('for=drive');
    expect(href).toContain('returnTo=');
  });

  it('shows the admin note instead of a link when the caller cannot reauthorize', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ items: [item({ platform: 'quickbooks', label: 'QuickBooks Online', canReauthorize: false, reconnectUrl: '/api/saas/connectors/quickbooks/oauth/initiate?orgId=342' })] }) });
    view();
    expect(await screen.findByText('Ask an organization admin to reauthorize QuickBooks Online.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('reauthorize-quickbooks')).toBeTruthy();
  });

  it('renders an Open connectors link for dashboard targets', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ items: [item({ platform: 'slack', label: 'Slack', opensDashboard: true, reconnectUrl: '/admin/integrations?orgId=342&platform=slack' })] }) });
    view();
    const link = await screen.findByRole('link', { name: 'Open connectors' });
    expect(link.getAttribute('href')).toContain('/admin/integrations?');
    expect(link.getAttribute('href')).toContain('platform=slack');
  });

  it('requests the project scope when a projectKey is given', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ items: [] }) });
    view({ projectKey: 'books' });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('GET', '/api/me/connections/reauthorizations?projectKey=books'));
  });
});
