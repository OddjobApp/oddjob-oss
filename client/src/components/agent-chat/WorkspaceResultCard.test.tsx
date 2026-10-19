import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceResultCard } from './WorkspaceResultCard';
import type { WorkspaceResultPayload } from '@shared/crew-workspace-results';
const base: WorkspaceResultPayload = { type: 'google_workspace_results', title: 'Email', presentation: 'cards', sourceTool: 'gmail_list_messages', sourceArgs: {}, items: [{ id: 'm1', kind: 'email', title: 'Invoice', sender: 'a@example.com', body: 'Invoice content' }, { id: 'm2', kind: 'email', title: 'Contract' }] };
afterEach(cleanup);
describe('Google result cards', () => {
  it('selects YouTube comments and opens their source without showing Gmail links', () => {
    const onDiscuss = vi.fn();
    const url = 'https://www.youtube.com/watch?v=v1&lc=comment1';
    render(<WorkspaceResultCard payload={{ ...base, title: 'YouTube', sourceTool: 'youtube_list_comments', items: [{ id: 'comment1', kind: 'video', platform: 'youtube', youtubeKind: 'comment', title: 'Viewer question', body: 'Question', url }] }} turnId={42} tool="youtube_list_comments" onDiscuss={onDiscuss} />);
    expect(screen.queryByRole('link', { name: 'Open in Gmail' })).toBeNull();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByRole('link', { name: /Open in YouTube/ }));
    expect(open).toHaveBeenCalledWith(url, '_blank', expect.stringContaining('popup=yes'));
    open.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Draft reply' }));
    expect(onDiscuss.mock.calls[0][0][0].item).toMatchObject({ platform: 'youtube', youtubeKind: 'comment', id: 'comment1' });
  });
  it('shows the creator profile first, then video cards with stats, captions and release dates', () => {
    const payload: WorkspaceResultPayload = { ...base, title: 'YouTube', sourceTool: 'youtube_get_channel', items: [
      { id: 'chan1', kind: 'video', platform: 'youtube', youtubeKind: 'channel', title: 'Studio', customUrl: '@studio', subscriberCount: 4200, videoCount: 87, thumbnailUrl: 'https://yt3.ggpht.com/avatar', preview: 'About the studio' },
      { id: 'v1', kind: 'video', platform: 'youtube', youtubeKind: 'video', title: 'Launch video', sender: 'Studio', duration: 253, viewCount: 12345, hasCaptions: true, date: '2026-09-20T12:00:00Z', thumbnailUrl: 'https://i.ytimg.com/vi/v1/mqdefault.jpg', preview: 'About the launch', url: 'https://www.youtube.com/watch?v=v1' },
    ] };
    render(<WorkspaceResultCard payload={payload} turnId={42} tool="youtube_get_channel" />);
    const articles = document.querySelectorAll('article');
    expect(articles[0].textContent).toContain('Studio');
    expect(articles[0].textContent).toContain('@studio');
    expect(articles[0].textContent).toContain('4.2K');
    expect(articles[1].textContent).toContain('Launch video');
    expect(articles[1].textContent).toContain('CC');
    expect(articles[1].textContent).toContain('4:13');
    expect(articles[1].textContent).toContain('12.3K views');
    expect(articles[1].textContent).toMatch(/Sep 2[01], 2026/);
    expect(screen.getByRole('link', { name: /Open in YouTube/ }).getAttribute('href')).toBe('https://www.youtube.com/watch?v=v1');
  });
  it('selects Microsoft documents with their drive identity and opens their source in a new window', () => {
    const onSelect = vi.fn();
    const url = 'https://tenant.sharepoint.com/sites/team/Plan.docx';
    render(<WorkspaceResultCard payload={{ ...base, title: 'Documents', sourceTool: 'm365_list_documents', items: [{ id: 'doc', kind: 'document', platform: 'microsoft365', driveId: 'library', title: 'Plan.docx', url }] }} turnId={42} tool="m365_list_documents" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Plan.docx' }));
    expect(onSelect.mock.calls[0][0][0].item).toMatchObject({ platform: 'microsoft365', driveId: 'library' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByRole('link', { name: /Open in Microsoft 365/ }));
    expect(open).toHaveBeenCalledWith(url, '_blank', expect.stringContaining('popup=yes'));
    open.mockRestore();
  });
  it('does not select another card containing the same message', () => {
    render(<WorkspaceResultCard payload={{ ...base, items: [base.items[0]] }} turnId={42} tool="gmail_get_message" resultIndex={1} selected={[{ turnId: 42, tool: 'gmail_get_message', itemId: 'm1', resultIndex: 0 }]} onSelect={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Select Invoice' }).getAttribute('aria-checked')).toBe('false');
  });
  it('opens the Gmail thread and selects the exact email for a summary', () => {
    const onDiscuss = vi.fn();
    render(<WorkspaceResultCard payload={{ ...base, items: [{ ...base.items[0], threadId: 'thread123' }] }} turnId={42} tool="gmail_get_message" onDiscuss={onDiscuss} />);
    expect(screen.getByRole('link', { name: 'Open in Gmail' }).getAttribute('href')).toBe('https://mail.google.com/mail/u/0/#all/thread123');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByRole('link', { name: 'Open in Gmail' }));
    expect(open).toHaveBeenCalledWith('https://mail.google.com/mail/u/0/#all/thread123', '_blank', expect.stringContaining('popup=yes'));
    open.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }));
    expect(onDiscuss.mock.calls[0]).toMatchObject([[{ itemId: 'm1', turnId: 42 }], 'summarize']);
  });
  it('keeps a single email collapsed until its content is requested', () => {
    render(<WorkspaceResultCard payload={{ ...base, items: [base.items[0]] }} turnId={1} tool="gmail_get_message" />);
    expect(screen.queryByText('Invoice content')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview content' }));
    expect(screen.getByText('Invoice content')).toBeTruthy();
    expect(screen.getByText('a@example.com')).toBeTruthy();
  });
  it('selects a specific email and drafts a reply without sending', () => {
    const onSelect = vi.fn(), onDiscuss = vi.fn();
    render(<WorkspaceResultCard payload={base} turnId={42} tool="gmail_list_messages" onSelect={onSelect} onDiscuss={onDiscuss} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Contract' }));
    expect(onSelect.mock.calls[0][0][0]).toMatchObject({ turnId: 42, itemId: 'm2', item: { title: 'Contract' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Draft reply' })[1]);
    expect(onDiscuss.mock.calls[0]).toMatchObject([[{ itemId: 'm2' }], 'respond']);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('discusses a chosen set of emails', () => {
    const onDiscuss = vi.fn();
    render(<WorkspaceResultCard payload={base} turnId={42} tool="gmail_list_messages" selected={base.items.map(i => ({ turnId: 42, tool: 'gmail_list_messages', itemId: i.id }))} onDiscuss={onDiscuss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discuss selected' }));
    expect(onDiscuss.mock.calls[0][0]).toHaveLength(2);
  });
  it('switches multiple events into a day-grouped agenda', () => {
    const payload: WorkspaceResultPayload = { ...base, title: 'Calendar', sourceTool: 'gcal_list_events', items: [{ id: 'e1', kind: 'calendar', title: 'First meeting', start: '2026-10-07T16:00:00Z', timeZone: 'America/Los_Angeles' }, { id: 'e2', kind: 'calendar', title: 'Second meeting', start: '2026-10-08T16:00:00Z', timeZone: 'America/Los_Angeles' }] };
    render(<WorkspaceResultCard payload={payload} turnId={42} tool="gcal_list_events" />);
    fireEvent.click(screen.getByRole('button', { name: 'Agenda view' }));
    expect(screen.getByRole('heading', { name: /Wednesday, October 7/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Thursday, October 8/ })).toBeTruthy();
  });
  it('renders documents and refuses unsafe external links', () => {
    render(<WorkspaceResultCard payload={{ ...base, title: 'Documents', items: [{ id: 'd1', kind: 'document', title: 'Plan', url: 'javascript:alert(1)' }] }} turnId={42} tool="gdrive_list_files" />);
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('renders Amazon products with price, Prime, rating and safe source links', () => {
    const payload: WorkspaceResultPayload = { ...base, title: 'Amazon', sourceTool: 'amazon_search_products', items: [{ id: 'B08XYZ1234', kind: 'product', platform: 'amazon', asin: 'B08XYZ1234', title: 'Acme Widget', brand: 'Acme', priceDisplay: '$99.99', listPriceDisplay: '$129.99', rating: 4.5, reviewCount: 1234, isPrime: true, availability: 'In Stock', thumbnailUrl: 'https://m.media-amazon.com/images/I/x.jpg', url: 'https://www.amazon.com/dp/B08XYZ1234?tag=mytag-20', cartUrl: 'https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B08XYZ1234&Quantity.1=1' }] };
    render(<WorkspaceResultCard payload={payload} turnId={42} tool="amazon_search_products" />);
    const article = document.querySelector('article')!;
    expect(article.textContent).toContain('Acme Widget');
    expect(article.textContent).toContain('$99.99');
    expect(article.textContent).toContain('$129.99');
    expect(article.textContent).toContain('Prime');
    expect(article.textContent).toContain('★ 4.5');
    expect(article.textContent).toContain('In Stock');
    expect(screen.getByRole('link', { name: /Open on Amazon/ }).getAttribute('href')).toBe('https://www.amazon.com/dp/B08XYZ1234?tag=mytag-20');
    expect(screen.getByRole('link', { name: /Add to Amazon cart/ }).getAttribute('href')).toContain('cart/add.html');
  });
  it('refuses non-Amazon product links', () => {
    render(<WorkspaceResultCard payload={{ ...base, title: 'Amazon', sourceTool: 'amazon_search_products', items: [{ id: 'B08XYZ1234', kind: 'product', platform: 'amazon', asin: 'B08XYZ1234', title: 'Widget', url: 'javascript:alert(1)', cartUrl: 'https://evil.example/x' }] }} turnId={42} tool="amazon_search_products" />);
    expect(screen.getByText('Widget')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('continues a paginated query with its original filter', () => {
    const onMore = vi.fn();
    render(<WorkspaceResultCard payload={{ ...base, nextPageToken: 'next', sourceArgs: { query: 'in:inbox' } }} turnId={42} tool="gmail_list_messages" onMore={onMore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onMore.mock.calls[0][0]).toContain('in:inbox');
    expect(onMore.mock.calls[0][0]).toContain('next');
  });
});
