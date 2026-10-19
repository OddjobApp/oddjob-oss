import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ request: vi.fn(), org: 342 }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request, resolveActiveOrgId: () => 342 }));
vi.mock('@domain-ui/core/ui/hooks/use-org-context', () => ({ useOrgContextOptional: () => ({ selectedOrgId: mocks.org }) }));
vi.mock('@/components/ui/copy-button', () => ({ CopyButton: () => null }));
import { QuickBooksConnectionOptions } from './QuickBooksConnectionOptions';
describe('QuickBooks disconnect and organization switching', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.org = 342; });
    it('disconnects the selected organization and refreshes its adapter list', async () => {
        let connected = true;
        mocks.request.mockImplementation(async (method: string) => {
            if (method === 'POST') { connected = false; return { json: async () => ({ success: true }) }; }
            return { json: async () => ({ configured: true, canManage: true, environment: 'sandbox', connection: { status: connected ? 'connected' : 'disconnected', inherited: false } }) };
        });
        const changed = vi.fn();
        render(<QueryClientProvider client={new QueryClient()}><QuickBooksConnectionOptions projectKey="billing" onConnectionChange={changed} /></QueryClientProvider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
        await waitFor(() => expect(changed).toHaveBeenCalledOnce());
        expect(mocks.request).toHaveBeenCalledWith('POST', '/api/saas/connectors/quickbooks/disconnect?orgId=342&projectKey=billing', {});
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull());
        expect(await screen.findByRole('status')).toHaveTextContent('QuickBooks disconnected');
    });
    it('loads fresh state when the active organization changes', async () => {
        mocks.request.mockResolvedValue({ json: async () => ({ configured: true, canManage: true, environment: 'sandbox', connection: null }) });
        const client = new QueryClient();
        const view = render(<QueryClientProvider client={client}><QuickBooksConnectionOptions /></QueryClientProvider>);
        await screen.findByRole('link', { name: 'Connect QuickBooks' });
        mocks.org = 473;
        view.rerender(<QueryClientProvider client={client}><QuickBooksConnectionOptions /></QueryClientProvider>);
        await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('GET', '/api/saas/connectors/quickbooks/oauth/status?orgId=473'));
        expect((await screen.findByRole('link', { name: 'Connect QuickBooks' })).getAttribute('href')).toContain('orgId=473');
    });
    it('offers a member no reconnect or disconnect, and says who can', async () => {
        mocks.request.mockResolvedValue({ json: async () => ({ configured: true, canManage: false, environment: 'sandbox', connection: { status: 'connected', inherited: false } }) });
        render(<QueryClientProvider client={new QueryClient()}><QuickBooksConnectionOptions /></QueryClientProvider>);
        expect(await screen.findByText('Only an organization admin can reconnect or disconnect QuickBooks.')).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'Reconnect QuickBooks' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Test connection' })).toBeTruthy();
    });
});
