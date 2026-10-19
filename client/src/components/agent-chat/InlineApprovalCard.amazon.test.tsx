import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', async original => ({ ...(await original<any>()), apiRequest: mocks.request }));
import { InlineApprovalCard } from './InlineApprovalCard';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('Amazon approval handoff', () => {
  it('restores the approved cart link on reload without claiming a purchase', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'approved', modifiedOutput: { kind: 'amazon_purchase', outcome: { success: true, result: { checkoutUrl: 'https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B08XYZ1234&Quantity.1=1' } } } }) });
    render(<InlineApprovalCard payload={{ kind: 'amazon_purchase', proposalId: 42, title: 'Widget', args: { items: [{ asin: 'B08XYZ1234', quantity: 1 }] } }} onArtifactSubmit={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open cart on Amazon' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Open cart on Amazon' }).getAttribute('target')).toBe('_blank');
    expect(screen.getByText(/Nothing is ordered/)).toBeTruthy();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByRole('link', { name: 'Open cart on Amazon' }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://www.amazon.com/gp/aws/cart/add.html'), '_blank', expect.stringContaining('noopener'));
  });
  it('rejects a look-alike destination in a persisted outcome', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'approved', modifiedOutput: { kind: 'amazon_purchase', outcome: { success: true, result: { checkoutUrl: 'https://www.amazon.evil.com/cart' } } } }) });
    render(<InlineApprovalCard payload={{ kind: 'amazon_purchase', proposalId: 42, title: 'Widget', args: {} }} onArtifactSubmit={vi.fn()} />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Open cart on Amazon' })).toBeNull();
  });
});
