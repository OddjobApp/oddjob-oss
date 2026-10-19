import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CrewAttachmentBar, type CrewAttachment } from './CrewAttachmentBar';

/**
 * Two states have to stay distinguishable here, because collapsing either turns
 * an unknown into a claim: whether a file could be READ, and whether it is yet
 * SEARCHABLE. Indexing runs after the upload responds, so "pending" is the
 * common case rather than an edge one.
 */

const apiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: any[]) => apiRequest(...args) }));

const file = (over: Partial<CrewAttachment> = {}): CrewAttachment => ({
  id: 1,
  displayName: 'contract.pdf',
  mimeType: 'application/pdf',
  byteSize: 2048,
  parseStatus: 'parsed',
  parseType: 'text',
  textLength: 48000,
  indexStatus: 'indexed',
  uploadedBy: 'admin',
  createdAt: new Date().toISOString(),
  preview: 'Payment terms…',
  ...over,
});

const respondWith = (attachments: CrewAttachment[]) =>
  apiRequest.mockResolvedValue({ ok: true, json: async () => ({ attachments }) });

beforeEach(() => apiRequest.mockReset());

describe('CrewAttachmentBar', () => {
  it('removes the room link and updates the parent after success', async () => {
    apiRequest.mockImplementation(async (method: string) => ({ ok: true, json: async () => ({ attachments: method === 'DELETE' ? [] : [file()] }) }));
    const onLoaded = vi.fn();
    render(<CrewAttachmentBar roomKey="crew-1" onLoaded={onLoaded} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove contract.pdf from room' }));
    await waitFor(() => expect(screen.queryByText('contract.pdf')).toBeNull());
    expect(apiRequest).toHaveBeenCalledWith('DELETE', '/api/crew/crew-1/attachments/1');
    expect(onLoaded).toHaveBeenLastCalledWith([]);
  });
  it('keeps the file visible when removal fails', async () => {
    apiRequest.mockImplementation(async (method: string) => {
      if (method === 'DELETE') throw new Error('Permission denied');
      return { ok: true, json: async () => ({ attachments: [file()] }) };
    });
    render(<CrewAttachmentBar roomKey="crew-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove contract.pdf from room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
    expect(screen.getByText('contract.pdf')).toBeInTheDocument();
  });
  it('renders nothing when the room has no project to scope files to', () => {
    respondWith([]);
    const { container } = render(<CrewAttachmentBar roomKey="crew-1" projectScoped={false} />);

    // An attachment with no project has no scope; offering the control would
    // promise something the server correctly refuses.
    expect(container).toBeEmptyDOMElement();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('offers the control once the room is in a project', async () => {
    respondWith([]);
    render(<CrewAttachmentBar roomKey="crew-1" projectScoped />);

    expect(await screen.findByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    expect(screen.queryByText('Attach files')).toBeNull();
  });

  it('places the icon in the composer and still opens the room file picker', async () => {
    respondWith([file()]);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const view = render(<CrewAttachmentBar roomKey="crew-1" triggerContainer={target} />);
    const picker = screen.getByTestId('crew-attachment-input');
    const click = vi.spyOn(picker, 'click');
    const button = await screen.findByRole('button', { name: 'Attach files' });
    expect(target).toContainElement(button);
    expect(view.container).not.toContainElement(button);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
    view.unmount();
    target.remove();
  });

  it('shows a searchable file as searchable', async () => {
    respondWith([file()]);
    render(<CrewAttachmentBar roomKey="crew-1" projectScoped />);

    expect(await screen.findByText('contract.pdf')).toBeInTheDocument();
    expect(screen.getByText('searchable')).toBeInTheDocument();
  });

  it('says a file is still indexing rather than implying it is ready', async () => {
    respondWith([file({ indexStatus: 'pending' })]);
    render(<CrewAttachmentBar roomKey="crew-1" projectScoped />);

    // Not "searchable", and not silently absent either.
    expect(await screen.findByText('indexing…')).toBeInTheDocument();
    expect(screen.queryByText('searchable')).not.toBeInTheDocument();
  });

  it('distinguishes a file that could not be read from an empty one', async () => {
    respondWith([file({ parseStatus: 'unsupported', parseType: null, textLength: null, indexStatus: 'skipped' })]);
    render(<CrewAttachmentBar roomKey="crew-1" projectScoped />);

    const chip = await screen.findByTestId('crew-attachment-1');
    expect(chip).toHaveAttribute('title', expect.stringContaining('unsupported'));
    expect(screen.getByText('not searchable')).toBeInTheDocument();
  });

  it('reports a failed index instead of leaving it looking pending', async () => {
    respondWith([file({ indexStatus: 'failed' })]);
    render(<CrewAttachmentBar roomKey="crew-1" projectScoped />);

    expect(await screen.findByText('index failed')).toBeInTheDocument();
  });

  it('hands the loaded list up so the rail shows the same files', async () => {
    const onLoaded = vi.fn();
    respondWith([file()]);
    render(<CrewAttachmentBar roomKey="crew-1" projectScoped onLoaded={onLoaded} />);

    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(onLoaded.mock.calls[0][0][0].displayName).toBe('contract.pdf');
  });

  it('does not refetch endlessly when the parent passes an inline callback', async () => {
    respondWith([file()]);
    const { rerender } = render(
      <CrewAttachmentBar roomKey="crew-1" projectScoped onLoaded={() => {}} />,
    );
    await screen.findByText('contract.pdf');
    // A new function identity each render must not re-trigger the load effect.
    rerender(<CrewAttachmentBar roomKey="crew-1" projectScoped onLoaded={() => {}} />);
    rerender(<CrewAttachmentBar roomKey="crew-1" projectScoped onLoaded={() => {}} />);

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
  });
});
