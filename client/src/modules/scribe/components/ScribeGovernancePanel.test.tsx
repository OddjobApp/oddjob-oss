import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { apiRequest } from '@/lib/queryClient';
import { ScribeGovernancePanel } from './ScribeGovernancePanel';

vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const revision = { id: 7, revisionNumber: 3, kind: 'commit', actor: 'Editor', scope: 'document' };
const props = { document: { id: 42 } as any, nodes: [], activeNode: null, onChanged: vi.fn() };
const mutations = () => request.mock.calls.filter(([method]) => method === 'POST');
beforeEach(() => {
    vi.clearAllMocks();
    request.mockImplementation(async (_method, url) => ({ json: async () => String(url).includes('/revisions?') ? { revisions: [revision] } : String(url).endsWith('/reviews') ? { reviews: [] } : [] }) as Response);
});
async function openRestore() {
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    return screen.getByRole('alertdialog');
}
describe('Scribe revision restore confirmation', () => {
    it('makes no mutation until confirmed and allows cancellation', async () => {
        render(<ScribeGovernancePanel {...props} />);
        const dialog = await openRestore();
        expect(within(dialog).getByText('Restore revision r3?')).toBeTruthy();
        expect(mutations()).toHaveLength(0);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(mutations()).toHaveLength(0);
    });
    it('restores the selected revision only after confirmation', async () => {
        render(<ScribeGovernancePanel {...props} />);
        const dialog = await openRestore();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Restore revision' }));
        await waitFor(() => expect(mutations()).toEqual([['POST', '/api/scribe/documents/42/revisions/7/rollback']]));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(props.onChanged).toHaveBeenCalledTimes(1);
    });
    it('keeps a failed restore visible for retry and clears it when changing documents', async () => {
        const original = request.getMockImplementation()!;
        request.mockImplementation(async (method, url, ...rest) => {
            if (method === 'POST') throw new Error('Restore failed');
            return original(method, url, ...rest);
        });
        const view = render(<ScribeGovernancePanel {...props} />);
        const dialog = await openRestore();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Restore revision' }));
        await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Restore failed'));
        expect(props.onChanged).not.toHaveBeenCalled();
        view.rerender(<ScribeGovernancePanel {...props} document={{ id: 43 } as any} />);
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });
});
