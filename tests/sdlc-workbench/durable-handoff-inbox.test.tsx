import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocked = vi.hoisted(() => ({ list: vi.fn(), pending: vi.fn(), acknowledge: vi.fn(), offer: vi.fn(), discardRetry: vi.fn(), prepare: vi.fn(), reconcileDeployment: vi.fn() }));
vi.mock('../../server/blueprints/apps/sdlc-workbench/lib/platform-client', () => ({ handoffs: mocked }));
vi.mock('../../server/blueprints/apps/sdlc-workbench/lib/workbench-bridge', () => ({ triggerCycle: mocked.prepare }));
import { DurableHandoffInboxView } from '../../server/blueprints/apps/sdlc-workbench/app/components/DurableHandoffInboxView';
const DurableHandoffInbox = () => <DurableHandoffInboxView pathname="/stakeholder-workbench" />;
const handoff = { id: 'receipt-1', target: 'stakeholder-workbench', label: 'QA → UAT', status: 'offered', createdAt: '2026-10-14T12:00:00Z', binding: { repositoryUrl: 'https://example.test/repo', branch: 'work', cycleId: 7 }, input: {} };
describe('destination handoff inbox', () => {
  it('checks an existing deployment attempt without preparing or launching work', async () => {
    window.history.replaceState({}, '', '/app/test/devops-workbench?crewRoom=room');
    mocked.list.mockResolvedValue({ items: [{ handoff: { ...handoff, target: 'devops-workbench', status: 'acknowledged' }, blocker: null }], nextCursor: null });
    mocked.reconcileDeployment.mockResolvedValue({ reconciled: true, runId: 21, runStatus: 'active', message: 'No new launch was started.' });
    render(<DurableHandoffInboxView pathname="/devops-workbench" />);
    fireEvent.click(await screen.findByText('Stage handoffs · 0 visible offers · 0 unconfirmed'));
    fireEvent.click(screen.getByRole('button', { name: 'Check deployment attempt' }));
    expect(await screen.findByText(/Matching run #21/)).toBeTruthy();
    expect(mocked.reconcileDeployment).toHaveBeenCalledWith('receipt-1');
    expect(mocked.prepare).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks(); window.history.replaceState({}, '', '/app/test/stakeholder-workbench?crewRoom=room');
    mocked.pending.mockReturnValue([]);
    mocked.prepare.mockReturnValue('request-1');
    mocked.list.mockResolvedValue({ items: [{ handoff, blocker: null }], nextCursor: null });
  });
  it('does not acknowledge when a destination is merely opened', async () => {
    render(<DurableHandoffInbox />);
    await screen.findByText('Stage handoffs · 1 visible offers · 0 unconfirmed');
    expect(mocked.acknowledge).not.toHaveBeenCalled();
  });
  it('disables acknowledgement for failed or stale source evidence', async () => {
    mocked.list.mockResolvedValue({ items: [{ handoff, blocker: 'A newer gate supersedes this source.' }], nextCursor: null });
    render(<DurableHandoffInbox />);
    fireEvent.click(await screen.findByText('Stage handoffs · 1 visible offers · 0 unconfirmed'));
    expect((screen.getByRole('button', { name: 'Acknowledge receipt' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocked.acknowledge).not.toHaveBeenCalled();
  });
  it('acknowledges only after an explicit action and shows the durable receipt', async () => {
    mocked.acknowledge.mockImplementation(async () => {
      mocked.list.mockResolvedValue({ items: [{ handoff: { ...handoff, status: 'acknowledged', receipt: { at: '2026-10-14T13:00:00Z' } }, blocker: null }], nextCursor: null });
    });
    render(<DurableHandoffInbox />);
    fireEvent.click(await screen.findByText('Stage handoffs · 1 visible offers · 0 unconfirmed'));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge receipt' }));
    await waitFor(() => expect(mocked.acknowledge).toHaveBeenCalledWith('receipt-1', 'stakeholder-workbench'));
    expect(await screen.findByText(/Destination acknowledged at/)).toBeTruthy();
  });
  it('prepares a source-linked CREW review without acknowledging again or launching work', async () => {
    mocked.list.mockResolvedValue({ items: [{ handoff: { ...handoff, status: 'acknowledged', receipt: { at: '2026-10-14T13:00:00Z' } }, blocker: null }], nextCursor: null });
    render(<DurableHandoffInbox />);
    fireEvent.click(await screen.findByText('Stage handoffs · 0 visible offers · 0 unconfirmed'));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare review in CREW' }));
    expect(mocked.prepare).toHaveBeenCalledWith('Review acknowledged SDLC handoff', { handoffId: handoff.id });
    expect(mocked.acknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Preparing review in CREW…');
  });
});
