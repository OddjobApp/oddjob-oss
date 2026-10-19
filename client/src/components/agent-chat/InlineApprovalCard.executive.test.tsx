import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', async original => ({ ...(await original<any>()), apiRequest: mocks.request }));
import { InlineApprovalCard } from './InlineApprovalCard';
afterEach(cleanup);

// A void is routed to the project's Executives; its proposer cannot approve it.
const voidCard = {
  type: 'approval_request', kind: 'quickbooks_action', actionName: 'quickbooks_void_invoice', proposalId: 7,
  title: 'Void invoice 1001', needsExecutiveApproval: true, proposedBy: 'u-ar', status: 'pending',
  summary: { company: 'Books Co', customer: 'Acme', invoice: '1001', total: 50, balance: 50, currency: 'USD' },
};

describe('QuickBooks requests that need an Executive', () => {
  it('tells the proposer it is waiting instead of offering Approve', () => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'pending' }) });
    render(<InlineApprovalCard payload={voidCard} onArtifactSubmit={vi.fn()} currentUserId="u-ar" />);
    expect(screen.getByTestId('quickbooks-executive-approval')).toBeTruthy();
    expect(screen.getByTestId('awaiting-executive-approval')).toHaveTextContent('Waiting for an Executive');
    expect(screen.queryByTestId('approve-proposal-button')).toBeNull();
  });
  it('offers an Executive the decision', () => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'pending' }) });
    render(<InlineApprovalCard payload={voidCard} onArtifactSubmit={vi.fn()} currentUserId="u-exec" />);
    expect(screen.getByTestId('approve-proposal-button')).toBeTruthy();
    expect(screen.getByTestId('quickbooks-executive-approval')).toBeTruthy();
  });
});
