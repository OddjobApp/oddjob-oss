import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/queryClient', async original => ({ ...(await original<any>()), apiRequest: mocks.request }));
import { InlineApprovalCard } from './InlineApprovalCard';
afterEach(cleanup);
const payload = { kind: 'calendar_action', actionName: 'gcal_create_event', proposalId: 42, title: 'Hackathon', args: {} };
describe('Calendar execution confirmation', () => {
  it('uses the room organization when restoring and verifying without scheduling again', async () => {
    mocks.request.mockClear();
    mocks.request.mockImplementation(async (_method: string, url: string) => ({ json: async () => url.includes('calendar-verification')
      ? { found: true, verifiedAt: '2026-10-10T00:00:00Z' }
      : { status: 'approved', modifiedOutput: { kind: 'calendar_action', outcome: { success: true, result: { id: 'event1', summary: 'Hackathon' } } } } }));
    const submit = vi.fn();
    render(<InlineApprovalCard payload={{ ...payload, workflow: { organizationId: 342 } }} onArtifactSubmit={submit} />);
    await screen.findByText('Calendar event added');
    fireEvent.click(screen.getByRole('button', { name: 'Verify in Google' }));
    await screen.findByText(/Verified in Google at/);
    expect(mocks.request).toHaveBeenCalledWith('GET', '/api/approvals/42?organizationId=342');
    expect(mocks.request).toHaveBeenCalledWith('GET', '/api/approvals/42/calendar-verification?organizationId=342');
    expect(mocks.request.mock.calls.every(call => call[0] === 'GET')).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });
  it('shows the saved confirmation without starting another scheduling turn or dumping provider metadata', async () => {
    mocks.request.mockImplementation(async method => ({ json: async () => method === 'GET' ? { status: 'pending' } : { calendarAction: { success: true, state: 'succeeded', result: { id: 'event1', etag: 'private-etag', summary: 'Hackathon', start: { dateTime: '2026-10-10T16:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-10-10T20:00:00Z' }, location: 'Zoom' } } } }));
    const submit = vi.fn();
    render(<InlineApprovalCard payload={payload} onArtifactSubmit={submit} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Approve/ }));
    await screen.findByText('Calendar event added');
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByText('Review calendar change')).toBeNull();
    expect(screen.getByTestId('calendar-event-confirmation')).not.toHaveTextContent('2026-10-10T16:00:00Z');
    expect(screen.getByTestId('calendar-event-confirmation')).not.toHaveTextContent('private-etag');
  });
  it('offers read-only reconciliation after an uncertain outcome and confirms the recovered event', async () => {
    mocks.request.mockImplementation(async (method: string) => ({ ok: true, json: async () => method === 'GET'
      ? { status: 'approved', modifiedOutput: { kind: 'calendar_action', outcome: { success: false, state: 'outcome_unknown', error: 'Connection lost' } } }
      : { calendarAction: { success: true, state: 'succeeded', recovered: true, result: { id: 'event1', summary: 'Hackathon' } } } }));
    render(<InlineApprovalCard payload={payload} onArtifactSubmit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check calendar outcome' }));
    await screen.findByText('Calendar event added');
    expect(mocks.request).toHaveBeenCalledWith('POST', '/api/approvals/42/decision', { decision: 'approved' });
  });
  it('restores actual created-event details after reloading', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'approved', modifiedOutput: { kind: 'calendar_action', outcome: { success: true, result: { id: 'event1', summary: 'Hackathon', start: { dateTime: '2026-10-10T09:00:00-07:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-10-10T13:00:00-07:00' }, location: 'Zoom', htmlLink: 'https://calendar.google.com/calendar/event?eid=event1' } } } }) });
    render(<InlineApprovalCard payload={payload} onArtifactSubmit={vi.fn()} />);
    await screen.findByText('Calendar event added');
    expect(screen.getByTestId('calendar-event-confirmation')).toHaveTextContent('America/Los_Angeles');
    expect(screen.getByRole('link', { name: 'Open calendar event' })).toHaveAttribute('href', 'https://calendar.google.com/calendar/event?eid=event1');
  });
  it.each([{ success: false, error: 'Permission denied' }, { success: true, discarded: true }])('does not claim a failed or discarded change succeeded', async outcome => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'rejected', modifiedOutput: { kind: 'calendar_action', outcome } }) });
    render(<InlineApprovalCard payload={payload} onArtifactSubmit={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull());
    expect(screen.queryByTestId('calendar-event-confirmation')).toBeNull();
  });
  it('renders a structured event proposal card without raw JSON when event args are present', async () => {
    mocks.request.mockResolvedValue({ json: async () => ({ status: 'pending' }) });
    const eventPayload = {
      kind: 'calendar_action',
      actionName: 'gcal_create_event',
      proposalId: 527,
      title: 'create event: Oneday × Replit GTM Hackathon — 2 days to go ⚡',
      args: {
        calendar_id: 'admin@oddjob.app',
        add_meet: false,
        send_updates: 'none',
        event: {
          summary: 'Oneday × Replit GTM Hackathon — 2 days to go ⚡',
          start: { dateTime: '2026-10-10T12:00:00-04:00' },
          end: { dateTime: '2026-10-10T16:00:00-04:00' },
          location: 'Zoom',
          description: 'Saturday, Oct 10, 2026 schedule',
          attendees: [{ email: 'participant@example.com', displayName: 'Participant' }],
        },
      },
    };
    render(<InlineApprovalCard payload={eventPayload} onArtifactSubmit={vi.fn()} />);

    const proposalCard = screen.getByTestId('calendar-event-proposal');
    expect(proposalCard).toBeInTheDocument();
    expect(proposalCard).toHaveTextContent('Oneday × Replit GTM Hackathon — 2 days to go ⚡');
    expect(proposalCard).toHaveTextContent('Zoom');
    expect(proposalCard).toHaveTextContent('admin@oddjob.app');
    expect(proposalCard).toHaveTextContent('Participant <participant@example.com>');
    expect(proposalCard).toHaveTextContent('Saturday, Oct 10, 2026 schedule');

    expect(proposalCard).not.toHaveTextContent('{"dateTime":');
    expect(proposalCard).not.toHaveTextContent('{"email":');
    expect(proposalCard).not.toHaveTextContent('"summary":');

    expect(screen.getByRole('button', { name: 'Approve and add to calendar' })).toBeInTheDocument();
  });
});
