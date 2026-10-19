import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', async original => ({ ...(await original<any>()), apiRequest: mocks.request }));
import { InlineApprovalCard } from './InlineApprovalCard';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('FlightHub approval handoff', () => {
  it('restores the approved cart link on reload without claiming a purchase', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'approved', modifiedOutput: { kind: 'flighthub_booking', outcome: { success: true, result: { checkoutUrl: 'https://www.flighthub.com/results' } } } }) });
    render(<InlineApprovalCard payload={{ kind: 'flighthub_booking', proposalId: 42, title: 'Widget', args: { items: [{ asin: 'B08XYZ1234', quantity: 1 }] } }} onArtifactSubmit={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open FlightHub to book' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Open FlightHub to book' }).getAttribute('target')).toBe('_blank');
    expect(screen.getByText(/complete the booking on FlightHub/)).toBeTruthy();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByRole('link', { name: 'Open FlightHub to book' }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://www.flighthub.com/results'), '_blank', expect.stringContaining('noopener'));
  });
  it('rejects a look-alike destination in a persisted outcome', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'approved', modifiedOutput: { kind: 'flighthub_booking', outcome: { success: true, result: { checkoutUrl: 'https://www.flighthub.com.evil.test/results' } } } }) });
    render(<InlineApprovalCard payload={{ kind: 'flighthub_booking', proposalId: 42, title: 'Widget', args: {} }} onArtifactSubmit={vi.fn()} />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Open FlightHub to book' })).toBeNull();
  });
});
