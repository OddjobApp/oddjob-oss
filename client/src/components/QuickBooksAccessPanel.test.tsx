import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request }));
import { QuickBooksAccessPanel } from './QuickBooksAccessPanel';

const members = [
    { userId: 'u1', displayName: 'Alex Rivera', secondary: null, projectRole: 'editor', financeRoles: ['ar'] },
    { userId: 'u2', displayName: 'Jo Park', secondary: null, projectRole: 'viewer', financeRoles: [] },
];
const view = () => render(<QueryClientProvider client={new QueryClient()}><QuickBooksAccessPanel projectKey="books" /></QueryClientProvider>);

describe('QuickBooks access panel', () => {
    beforeEach(() => vi.clearAllMocks());
    it('lets an owner add a finance role, keeping the ones already held', async () => {
        mocks.request.mockImplementation(async (method: string) => ({ json: async () => method === 'GET' ? { canManage: true, members } : {} }));
        view();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Executive for Alex Rivera' }));
        await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('PUT', '/api/projects/books/finance-roles/u1', { roles: ['ar', 'executive'] }));
        expect(screen.getByText(/no QuickBooks access/)).toBeTruthy();
    });
    it('shows a member the roles but not the controls', async () => {
        mocks.request.mockResolvedValue({ json: async () => ({ canManage: false, members }) });
        view();
        const box = await screen.findByRole('checkbox', { name: 'Accounts receivable for Alex Rivera' });
        expect(box.hasAttribute('disabled')).toBe(true);
        expect(screen.getByText(/Only a project owner can change these/)).toBeTruthy();
    });
    it('shows the matrix the server enforces', async () => {
        mocks.request.mockResolvedValue({ json: async () => ({ canManage: false, members }) });
        view();
        const matrix = await screen.findByTestId('quickbooks-permission-matrix');
        expect(matrix.textContent).toContain('CRUD†');
        expect(matrix.textContent).toContain('Journal Entry');
    });
});
