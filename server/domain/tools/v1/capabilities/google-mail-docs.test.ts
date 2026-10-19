import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn(), values: vi.fn(() => ({ returning: async () => [{ id: 99 }] })) }));
vi.mock('@domain/integrations/google-workspace-connector-bridge.js', () => ({ getGoogleWorkspaceToken: mocks.token }));
vi.mock('@server/database_service.js', () => ({ db: { insert: () => ({ values: mocks.values }) } }));
vi.mock('@shared/schema/index.js', () => ({ approvalRequests: { id: 'id' } }));
import { GOOGLE_MAIL_DOCS_TOOLS, executeMailDocsApproval } from './google-mail-docs.js';
const c = { organizationId: 473, projectId: 44 };
describe('Google mail and document tools', () => {
  it('preserves formatted reply content as HTML with a plain text alternative', async () => {
    mocks.token.mockResolvedValue('test-token');
    await executeMailDocsApproval('gmail_reply', { to: ['sender@example.com'], subject: 'Re: Test', body: '**Thank you**\n\n- First point', body_format: 'markdown', thread_id: 'thread', in_reply_to: '<original@example.com>' }, c);
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    const raw = Buffer.from(request.raw, 'base64url').toString();
    expect(request.threadId).toBe('thread');
    expect(raw).toContain('multipart/alternative');
    expect(raw).toContain('Content-Type: text/html');
    expect(raw).toContain(Buffer.from('<p><strong>Thank you</strong></p>\n<ul>\n<li>First point</li>\n</ul>\n').toString('base64').slice(0, 40));
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.token.mockResolvedValue('test-token'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })); });
  it('reads full Gmail bodies as decoded text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ payload: { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Invoice details').toString('base64url') } }] } }) } as Response);
    const result = JSON.parse(await GOOGLE_MAIL_DOCS_TOOLS.gmail_get_message.execute({ message_id: 'a/b' }, c));
    expect(result.payload.parts[0].decodedText).toBe('Invoice details');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('a%2Fb?format=full'), expect.anything());
    expect(mocks.token).toHaveBeenCalledWith(473, 44, 'gmail_read');
  });
  it('preserves query and pagination when listing mail', async () => {
    await GOOGLE_MAIL_DOCS_TOOLS.gmail_list_messages.execute({ query: 'after:2026/10/07', page_token: 'next&more', max_results: 50 }, c);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get('pageToken')).toBe('next&more');
    expect(url.searchParams.get('q')).toBe('after:2026/10/07');
  });
  it('enriches listed messages with subject, sender and date instead of bare ids', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }], nextPageToken: 'nxt', resultSizeEstimate: 2 }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'm1', threadId: 't1', snippet: 'hi', payload: { headers: [{ name: 'Subject', value: 'Hello' }, { name: 'From', value: 'a@b.c' }, { name: 'Date', value: 'Wed, 7 Oct 2026' }] } }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'm2', threadId: 't2', snippet: 'yo', payload: { headers: [{ name: 'Subject', value: 'Second' }] } }) } as Response);
    const result = JSON.parse(await GOOGLE_MAIL_DOCS_TOOLS.gmail_list_messages.execute({ max_results: 20 }, c));
    expect(result.messages[0]).toMatchObject({ id: 'm1', subject: 'Hello', from: 'a@b.c', date: 'Wed, 7 Oct 2026', snippet: 'hi' });
    expect(result.messages[1]).toMatchObject({ id: 'm2', subject: 'Second' });
    expect(result.nextPageToken).toBe('nxt');
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain('/messages/m1?format=metadata');
  });
  it('reads every Google Docs tab with the native API', async () => {
    await GOOGLE_MAIL_DOCS_TOOLS.gdocs_get_document.execute({ document_id: 'doc' }, c);
    expect(fetch).toHaveBeenCalledWith('https://docs.googleapis.com/v1/documents/doc?includeTabsContent=true', expect.anything());
    expect(mocks.token).toHaveBeenCalledWith(473, 44, 'drive_read');
  });
  it('pages exported Docs text without silently dropping the rest', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => 'x'.repeat(250) } as Response);
    const result = JSON.parse(await GOOGLE_MAIL_DOCS_TOOLS.gdocs_read_text.execute({ document_id: 'doc', offset: 0, max_characters: 100 }, c));
    expect(result).toMatchObject({ total_characters: 250, truncated: true, next_offset: 100 });
    expect(result.text).toHaveLength(100);
    const next = JSON.parse(await GOOGLE_MAIL_DOCS_TOOLS.gdocs_read_text.execute({ document_id: 'doc', offset: 100, max_characters: 100 }, c));
    expect(next).toMatchObject({ offset: 100, next_offset: 200 });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('stores the exact proposed edit without executing it', async () => {
    const args = { document_id: 'doc', required_revision_id: 'revision', requests: [{ insertText: { endOfSegmentLocation: {}, text: 'Hello' } }] };
    const result = JSON.parse(await GOOGLE_MAIL_DOCS_TOOLS.gdocs_update_document.execute(args, c));
    expect(result).toMatchObject({ proposalId: 99, kind: 'google_workspace_action', args });
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 473, toolArgs: expect.objectContaining({ projectId: 44, args }) }));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses revision preconditions when applying an approved edit', async () => {
    await executeMailDocsApproval('gdocs_update_document', { document_id: 'doc', required_revision_id: 'revision', requests: [{ replaceAllText: { containsText: { text: 'old', matchCase: true }, replaceText: 'new' } }] }, c);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).writeControl).toEqual({ requiredRevisionId: 'revision' });
    expect(mocks.token).toHaveBeenCalledWith(473, 44, 'drive_write');
  });
  it('requires modify permission for mailbox actions and prevents header injection', async () => {
    mocks.token.mockResolvedValue(null);
    await expect(GOOGLE_MAIL_DOCS_TOOLS.gmail_create_draft.execute({ to: ['a@example.com'], subject: 'Draft', body: 'Text' }, c)).rejects.toThrow('permission');
    expect(fetch).not.toHaveBeenCalled();
    expect(GOOGLE_MAIL_DOCS_TOOLS.gmail_reply.parameters.safeParse({ to: ['a@example.com'], subject: 'Re: test', body: 'Hi', thread_id: 'thread', in_reply_to: 'id\r\nBcc: other@example.com' }).success).toBe(false);
  });
  it('refuses sending a draft that changed after review', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: { raw: 'different' } }) } as Response);
    await expect(executeMailDocsApproval('gmail_send_draft', { draft_id: 'draft', reviewed_raw: 'original' }, c)).rejects.toThrow('changed after review');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('sends approved recipients and attachments with UTF-8 MIME', async () => {
    await executeMailDocsApproval('gmail_send_message', { to: ['a@example.com'], subject: 'Résumé', body: 'Hello', attachments: [{ filename: 'report.txt', mime_type: 'text/plain', data_base64: Buffer.from('report').toString('base64') }] }, c);
    const raw = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).raw;
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    expect(decoded).toContain('multipart/mixed');
    expect(decoded).toContain('To: a@example.com');
    expect(decoded).toContain('filename*=UTF-8\'\'report.txt');
  });
});
