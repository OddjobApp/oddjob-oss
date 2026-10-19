import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', async (original) => ({
  ...(await original<any>()),
  apiRequest: mocks.request,
}));

import { InlineApprovalCard } from './InlineApprovalCard';

afterEach(cleanup);

const basePayload = {
  kind: 'app_record_action',
  proposalId: 101,
  app: { id: 805, name: 'BudgetMaster Workbench', slug: 'budgetmaster-workbench' },
  collection: 'transactions',
  action: 'create_record',
  data: {
    amount: 450.75,
    payee_raw: 'Acme Corp Cloud',
    category: 'Hosting & Infrastructure',
  },
  reason: 'Agent verified server bill invoice against monthly budget.',
};

describe('InlineApprovalCard App Action Proposal', () => {
  it('renders a structured app action proposal card with humanized fields and zero raw JSON', async () => {
    mocks.request.mockClear();
    const submit = vi.fn();

    render(<InlineApprovalCard payload={basePayload} onArtifactSubmit={submit} />);

    // Check header info
    expect(screen.getByText('BudgetMaster Workbench')).toBeInTheDocument();
    expect(screen.getByText('transactions')).toBeInTheDocument();
    expect(screen.getByText('Create Record')).toBeInTheDocument();

    // Check data fields
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('450.75')).toBeInTheDocument();
    expect(screen.getByText('Payee raw')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp Cloud')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('Hosting & Infrastructure')).toBeInTheDocument();

    // Ensure no raw JSON blobs are shown
    expect(screen.queryByText(/"amount": 450.75/)).toBeNull();
    expect(screen.queryByText(/"payee_raw"/)).toBeNull();

    // Check action button
    expect(screen.getByRole('button', { name: /Approve action/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument();
  });

  it('submits decision and updates outcome badge when approved', async () => {
    mocks.request.mockClear();
    mocks.request.mockResolvedValueOnce({
      json: async () => ({
        appRecordAction: {
          success: true,
          action: 'create_record',
          recordId: 'rec_txn_999',
          collection: 'transactions',
        },
      }),
    });

    const submit = vi.fn();
    render(<InlineApprovalCard payload={basePayload} onArtifactSubmit={submit} />);

    fireEvent.click(screen.getByRole('button', { name: /Approve action/i }));

    expect(mocks.request).toHaveBeenCalledWith('POST', '/api/approvals/101/decision', {
      decision: 'approved',
      modifiedOutput: undefined,
    });

    await screen.findByText(/Record created successfully \(rec_txn_999\)/);
    expect(submit).toHaveBeenCalledWith(
      expect.stringContaining('I approved the app action (create record) in "transactions" of BudgetMaster Workbench.'),
    );
  });

  it('renders update record action with record ID badge cleanly', async () => {
    const updatePayload = {
      ...basePayload,
      action: 'update_record',
      recordId: 'txn_existing_42',
      data: {
        category: 'R&D',
      },
    };

    render(<InlineApprovalCard payload={updatePayload} onArtifactSubmit={vi.fn()} />);

    expect(screen.getByText('Update Record')).toBeInTheDocument();
    expect(screen.getByText('txn_existing_42')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('R&D')).toBeInTheDocument();
  });
});
