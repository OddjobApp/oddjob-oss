import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TurnRow } from './TurnRow';
import { workspaceContextMessage } from '@shared/crew-workspace-results';
afterEach(cleanup);
const artifact = (id: string, title: string) => ({ tool: 'gmail_get_message', payload: { type: 'google_workspace_results', title: 'Email', presentation: 'cards', sourceTool: 'gmail_get_message', sourceArgs: { message_id: id }, items: [{ id, kind: 'email', title, body: 'Email content' }] } });
describe('Workspace results in mounted CREW turn rows', () => {
  it('copies the inner directive details from the card and includes them in response copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const payload = { type: 'gmail_directive', sender: 'sender@example.com', status: 'active', mailbox: 'me@example.com', browserPushReady: true, intervalSeconds: 30 };
    render(<TurnRow turn={{ id: 44, speakerType: 'supervisor', speakerName: 'Room', content: 'Rule saved.', artifacts: [{ tool: 'gmail_directive', payload }], toolsUsed: [] } as any} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy card' }));
    expect(writeText.mock.calls[0][0]).toContain('Connected mailbox: me@example.com');
    expect(writeText.mock.calls[0][0]).not.toContain('Rule saved.');
    expect(writeText.mock.calls[0][0]).not.toContain('Check status');
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(writeText.mock.calls[1][0]).toContain('Rule saved.');
    expect(writeText.mock.calls[1][0]).toContain('From: sender@example.com');
  });
  it('renders old provider JSON failures as a readable action card', () => {
    const content = 'Nobody could answer. Anthropic API error (400): {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}';
    render(<TurnRow turn={{ id: 4089, speakerType: 'supervisor', speakerName: 'Room', content, artifacts: [], toolsUsed: [] } as any} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    expect(screen.getByRole('alert').textContent).toContain('Model account needs credit');
    expect(screen.getByText('Action needed')).toBeTruthy();
    expect(screen.queryByText(/"type"/)).toBeNull();
  });
  it('keeps multiple results from the same tool and selects their exact source', () => {
    const select = vi.fn();
    render(<TurnRow turn={{ id: 42, speakerType: 'agent', speakerName: 'Copilot', content: 'Read two emails.', artifacts: [artifact('m1', 'Invoice'), artifact('m2', 'Contract')], toolsUsed: [] } as any} onArtifactSubmit={vi.fn()} currentUserId={null} onSelectWorkspaceItems={select} />);
    expect(screen.getByText('Invoice')).toBeTruthy();
    expect(screen.getByText('Contract')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Contract' }));
    expect(select.mock.calls[0]).toMatchObject([[{ itemId: 'm2' }], 'gmail_get_message', 42, ['m2'], 1]);
  });
  it('shows selected item labels instead of internal context JSON on persisted user turns', () => {
    const content = workspaceContextMessage('Draft a reply', [{ id: 'm1', kind: 'email', title: 'Invoice' }]);
    render(<TurnRow turn={{ id: 43, speakerType: 'user', speakerName: 'You', content, artifacts: [], toolsUsed: [] } as any} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    expect(screen.getByText('Invoice')).toBeTruthy();
    expect(screen.getByText('Draft a reply')).toBeTruthy();
    expect(screen.queryByText(/CREW selected Google items/)).toBeNull();
  });
  it('renders a calendar change receipt as a card, with the provider dump collapsed', () => {
    const dump = 'Kind: calendar#event\nEtag: "priv"\nStatus: confirmed\nHtml link: https://calendar.google.com/calendar/event?eid=abc\nSummary: Hackathon\nStart: Date time: 2026-10-10T16:00:00Z Time zone: UTC\nEnd: Date time: 2026-10-10T20:00:00Z Time zone: UTC\nLocation: Zoom\nExtended properties: Private: {"crewApprovalId":"527"}';
    const content = `Calendar change applied: create event: Hackathon. Result: ${dump}`;
    render(<TurnRow turn={{ id: 45, speakerType: 'user', speakerName: 'Ana', content, artifacts: [], toolsUsed: [] } as any} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    const receipt = screen.getByTestId('calendar-change-receipt');
    expect(receipt).toHaveTextContent('Hackathon');
    expect(receipt).toHaveTextContent('Event added');
    expect(receipt).toHaveTextContent('Zoom');
    expect(screen.getByRole('link', { name: 'Open calendar event' })).toHaveAttribute('href', 'https://calendar.google.com/calendar/event?eid=abc');
    expect(receipt.querySelector('details')?.hasAttribute('open')).toBe(false);
  });
  it('shows an all-day event as all day, not as a range from midnight UTC', () => {
    const payload = { type: 'google_workspace_results', title: 'Calendar', presentation: 'cards', sourceTool: 'calendar_list_events', sourceArgs: {},
      items: [{ id: 'd1', kind: 'calendar', title: 'Offsite', start: '2026-10-07', end: '2026-10-08' }] };
    render(<TurnRow turn={{ id: 47, speakerType: 'agent', speakerName: 'Ops', content: '', artifacts: [{ tool: 'calendar_list_events', payload }], toolsUsed: [] } as any} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    expect(screen.getByText('Offsite')).toBeTruthy();
    // The plain all-day form, not a timed range.
    expect(screen.getByText(/exclusive end/)).toBeTruthy();
    expect(screen.queryByText(/\d{1,2}:\d{2}\s?(AM|PM)/)).toBeNull();
  });

  it('uses the selected calendar item for the receipt and drops the duplicate chip', () => {
    const content = workspaceContextMessage('Calendar change applied: create event: Hackathon. Result: Kind: calendar#event', [
      { id: 'e1', kind: 'calendar', title: 'Oneday Hackathon', start: '2026-10-10T16:00:00Z', end: '2026-10-10T20:00:00Z', timeZone: 'UTC', location: 'Zoom', url: 'https://calendar.google.com/calendar/event?eid=e1', calendarId: 'primary' },
      { id: 'm1', kind: 'email', title: 'Source invite' },
    ]);
    render(<TurnRow turn={{ id: 46, speakerType: 'user', speakerName: 'Ana', content, artifacts: [], toolsUsed: [] } as any} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    const receipt = screen.getByTestId('calendar-change-receipt');
    expect(receipt).toHaveTextContent('Oneday Hackathon');
    expect(receipt).toHaveTextContent('Zoom');
    expect(screen.getByRole('link', { name: 'Open calendar event' })).toHaveAttribute('href', 'https://calendar.google.com/calendar/event?eid=e1');
    // The event appears once, in the card; the unrelated source email keeps its chip.
    expect(screen.getAllByText('Oneday Hackathon').length).toBe(1);
    expect(screen.getByText('Source invite')).toBeTruthy();
  });
});
