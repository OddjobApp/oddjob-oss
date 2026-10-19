import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { marked, Renderer } from 'marked';
import type { ToolContext, ToolDefinition } from './types.js';
import { getGoogleWorkspaceToken, type GoogleAccess } from '@domain/integrations/google-workspace-connector-bridge.js';

const id = z.string().min(1).refine(s => !/[\r\n]/.test(s), 'Identifier must be one line.');
const enc = encodeURIComponent;
async function call(c: ToolContext, access: GoogleAccess, service: 'gmail' | 'docs' | 'drive', path: string, method = 'GET', body?: unknown) {
  const token = await getGoogleWorkspaceToken(c.organizationId, c.projectId, access);
  if (!token) throw new Error(`Google ${service} permission missing. Use connect_platform with platform ${service === 'gmail' ? 'gmail' : 'google_drive'} and grant the requested access.`);
  const root = service === 'gmail' ? 'https://gmail.googleapis.com/gmail/v1/users/me' : service === 'docs' ? 'https://docs.googleapis.com/v1' : 'https://www.googleapis.com/drive/v3';
  const response = await fetch(root + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.text();
    if (service === 'docs' && detail.includes('SERVICE_DISABLED')) throw new Error('Google Docs API is disabled in the OAuth client Google Cloud project. Enable docs.googleapis.com in Google Cloud APIs & Services. Drive export reading still works, but native Docs editing cannot run until the API is enabled.');
    throw new Error(`Google ${service} API error ${response.status}: ${detail}`);
  }
  return response.status === 204 ? { success: true } : response.json();
}
const recipients = z.array(z.string().email()).min(1);
const mail = { to: recipients, cc: z.array(z.string().email()).optional(), bcc: z.array(z.string().email()).optional(), subject: z.string().refine(s => !/[\r\n]/.test(s), 'Subject must be one line.'), body: z.string(), body_format: z.enum(['plain', 'markdown']).default('plain'), attachments: z.array(z.object({ filename: id, mime_type: z.string().regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/), data_base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(14000000) })).max(10).optional(), thread_id: id.optional(), in_reply_to: z.string().refine(s => !/[\r\n]/.test(s)).optional() };
const labels = { add_label_ids: z.array(id).default([]), remove_label_ids: z.array(id).default([]) };
const schema = {
  gmail_send_message: z.object(mail),
  gmail_create_draft: z.object(mail),
  gmail_update_draft: z.object({ draft_id: id, ...mail }),
  gmail_delete_draft: z.object({ draft_id: id }),
  gmail_send_draft: z.object({ draft_id: id }),
  gmail_reply: z.object({ ...mail, thread_id: id, in_reply_to: id }),
  gmail_modify_message: z.object({ message_id: id, ...labels }),
  gmail_modify_thread: z.object({ thread_id: id, ...labels }),
  gmail_trash_message: z.object({ message_id: id }),
  gmail_untrash_message: z.object({ message_id: id }),
  gmail_create_label: z.object({ name: id }),
  gmail_update_label: z.object({ label_id: id, name: id }),
  gmail_delete_label: z.object({ label_id: id }),
  gdocs_create_document: z.object({ title: id, text: z.string().default('') }),
  gdocs_update_document: z.object({ document_id: id, required_revision_id: id, requests: z.array(z.record(z.unknown())).min(1).max(100) }),
  gdocs_append_text: z.object({ document_id: id, required_revision_id: id, text: z.string().min(1), tab_id: id.optional() }),
  gdocs_replace_text: z.object({ document_id: id, required_revision_id: id, find: z.string().min(1), replace: z.string(), match_case: z.boolean().default(true), tab_ids: z.array(id).optional() }),
  gdocs_copy_document: z.object({ document_id: id, title: id, folder_id: id.optional() }),
  gdocs_trash_document: z.object({ document_id: id }),
};
export const MAIL_DOCS_WRITE_NAMES = Object.keys(schema);
function accessFor(name: string): GoogleAccess { return name.startsWith('gmail_') ? 'gmail_modify' : 'drive_write'; }
function mime(p: any) {
  const boundary = 'oddjob_' + randomBytes(16).toString('hex');
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const renderer = new Renderer();
  renderer.link = token => /^(https?:\/\/|mailto:)/i.test(token.href) ? `<a href="${escape(token.href)}">${escape(token.text)}</a>` : escape(token.text);
  renderer.image = token => escape(token.text);
  const formatted = p.body_format === 'markdown' ? marked.parse(escape(p.body), { async: false, renderer }) : null;
  const text = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(p.body).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''];
  const alternative = boundary + '_alternative';
  const body = formatted ? [`Content-Type: multipart/alternative; boundary="${alternative}"`, '', `--${alternative}`, ...text, `--${alternative}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(formatted).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '', `--${alternative}--`] : text;
  const content = p.attachments?.length ? [`Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, ...body, ...p.attachments.flatMap((a: any) => [`--${boundary}`, `Content-Type: ${a.mime_type}`, `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`, 'Content-Transfer-Encoding: base64', '', a.data_base64.match(/.{1,76}/g)?.join('\r\n') ?? '']), `--${boundary}--`] : body;
  return Buffer.from([`To: ${p.to.join(', ')}`, ...(p.cc ? [`Cc: ${p.cc.join(', ')}`] : []), ...(p.bcc ? [`Bcc: ${p.bcc.join(', ')}`] : []), `Subject: =?UTF-8?B?${Buffer.from(p.subject).toString('base64')}?=`, ...(p.in_reply_to ? [`In-Reply-To: ${p.in_reply_to}`, `References: ${p.in_reply_to}`] : []), 'MIME-Version: 1.0', ...content].join('\r\n')).toString('base64url');
}
/** Executes locked, stored arguments only after the approval service authorizes a decision. */
export async function executeMailDocsApproval(name: string, args: unknown, c: ToolContext) {
  if (!Object.hasOwn(schema, name)) throw new Error('Unsupported Google Workspace action.');
  const p = schema[name as keyof typeof schema].parse(args) as any;
  const gmail = (path: string, method = 'POST', body?: unknown) => call(c, 'gmail_modify', 'gmail', path, method, body);
  switch (name) {
    case 'gmail_send_message': return gmail('/messages/send', 'POST', { raw: mime(p), threadId: p.thread_id });
    case 'gmail_create_draft': return gmail('/drafts', 'POST', { message: { raw: mime(p), threadId: p.thread_id } });
    case 'gmail_update_draft': return gmail(`/drafts/${enc(p.draft_id)}`, 'PUT', { message: { raw: mime(p), threadId: p.thread_id } });
    case 'gmail_delete_draft': return gmail(`/drafts/${enc(p.draft_id)}`, 'DELETE');
    case 'gmail_send_draft': {
      const current = await gmail(`/drafts/${enc(p.draft_id)}?format=raw`, 'GET');
      if (current.message?.raw !== (args as any).reviewed_raw) throw new Error('Draft changed after review. Read it and propose sending again.');
      return gmail('/drafts/send', 'POST', { id: p.draft_id, message: { raw: (args as any).reviewed_raw } });
    }
    case 'gmail_reply': return gmail('/messages/send', 'POST', { raw: mime(p), threadId: p.thread_id });
    case 'gmail_modify_message': return gmail(`/messages/${enc(p.message_id)}/modify`, 'POST', { addLabelIds: p.add_label_ids, removeLabelIds: p.remove_label_ids });
    case 'gmail_modify_thread': return gmail(`/threads/${enc(p.thread_id)}/modify`, 'POST', { addLabelIds: p.add_label_ids, removeLabelIds: p.remove_label_ids });
    case 'gmail_trash_message': return gmail(`/messages/${enc(p.message_id)}/trash`);
    case 'gmail_untrash_message': return gmail(`/messages/${enc(p.message_id)}/untrash`);
    case 'gmail_create_label': return gmail('/labels', 'POST', { name: p.name });
    case 'gmail_update_label': return gmail(`/labels/${enc(p.label_id)}`, 'PATCH', { name: p.name });
    case 'gmail_delete_label': return gmail(`/labels/${enc(p.label_id)}`, 'DELETE');
    case 'gdocs_create_document': {
      const doc = await call(c, 'drive_write', 'docs', '/documents', 'POST', { title: p.title });
      try { if (p.text) await call(c, 'drive_write', 'docs', `/documents/${enc(doc.documentId)}:batchUpdate`, 'POST', { requests: [{ insertText: { endOfSegmentLocation: {}, text: p.text } }] }); }
      catch (error: any) { throw new Error(`Document ${doc.documentId} was created, but inserting text failed: ${error.message}`); }
      return { ...doc, url: `https://docs.google.com/document/d/${doc.documentId}/edit` };
    }
    case 'gdocs_update_document': return call(c, 'drive_write', 'docs', `/documents/${enc(p.document_id)}:batchUpdate`, 'POST', { requests: p.requests, writeControl: { requiredRevisionId: p.required_revision_id } });
    case 'gdocs_append_text': return call(c, 'drive_write', 'docs', `/documents/${enc(p.document_id)}:batchUpdate`, 'POST', { requests: [{ insertText: { endOfSegmentLocation: { ...(p.tab_id ? { tabId: p.tab_id } : {}) }, text: p.text } }], writeControl: { requiredRevisionId: p.required_revision_id } });
    case 'gdocs_replace_text': return call(c, 'drive_write', 'docs', `/documents/${enc(p.document_id)}:batchUpdate`, 'POST', { requests: [{ replaceAllText: { containsText: { text: p.find, matchCase: p.match_case }, replaceText: p.replace, ...(p.tab_ids ? { tabsCriteria: { tabIds: p.tab_ids } } : {}) } }], writeControl: { requiredRevisionId: p.required_revision_id } });
    case 'gdocs_copy_document': return call(c, 'drive_write', 'drive', `/files/${enc(p.document_id)}/copy`, 'POST', { name: p.title, ...(p.folder_id ? { parents: [p.folder_id] } : {}) });
    case 'gdocs_trash_document': return call(c, 'drive_write', 'drive', `/files/${enc(p.document_id)}`, 'PATCH', { trashed: true });
  }
}
async function propose(name: string, args: any, c: ToolContext) {
  if (c.organizationId == null) throw new Error('Organization context is required.');
  if (!await getGoogleWorkspaceToken(c.organizationId, c.projectId, accessFor(name))) throw new Error(`Google editing permission missing. Use connect_platform with platform ${name.startsWith('gmail_') ? 'gmail' : 'google_drive'}.`);
  if (name === 'gmail_send_draft') {
    const draft = await call(c, 'gmail_read', 'gmail', `/drafts/${enc(args.draft_id)}?format=raw`);
    if (!draft.message?.raw) throw new Error('Draft content unavailable; sending cannot be reviewed.');
    const full = await call(c, 'gmail_read', 'gmail', `/drafts/${enc(args.draft_id)}?format=full`);
    if (draft.message.historyId !== full.message?.historyId) throw new Error('Draft changed while loading. Read it again before proposing sending.');
    args = { ...args, reviewed_raw: draft.message.raw, reviewed_message: decodeMessage(full.message) };
  }
  const { db } = await import('@server/database_service.js');
  const { approvalRequests } = await import('@shared/schema/index.js');
  const actor = String(c.userId ?? 'crew');
  const meta = { type: 'approval_request', kind: 'google_workspace_action', actionName: name, args, projectId: c.projectId ?? null, sessionKey: c.sessionKey ?? null, title: name.replaceAll('_', ' ') + ': ' + (args.subject ?? args.title ?? args.message_id ?? args.document_id ?? args.draft_id ?? args.name ?? args.thread_id), reason: 'Review the exact Google Workspace change before applying it.', status: 'pending' };
  const [row] = await db.insert(approvalRequests).values({ executionId: `google_${randomBytes(16).toString('hex')}`, toolName: name, toolArgs: meta, organizationId: c.organizationId, approverType: 'user', approverEmail: actor, ...(/^[0-9a-f-]{36}$/i.test(actor) ? { approverId: actor } : {}), token: randomBytes(24).toString('hex'), status: 'pending' }).returning({ id: approvalRequests.id });
  if (!row) throw new Error('Approval could not be saved.');
  return JSON.stringify({ ...meta, proposalId: row.id, message: 'Pending approval. No external change has been applied.' });
}
function read(name: string, description: string, parameters: z.ZodTypeAny, run: (p: any, c: ToolContext) => Promise<any>): ToolDefinition { return { name, description, parameters, idempotency: 'read-safe', group: 'Google Workspace', execute: async (p, c) => JSON.stringify(await run(p, c)) }; }
const page = { page_token: z.string().optional(), max_results: z.number().int().min(1).max(100).default(20) };
function pageQuery(p: any) { return new URLSearchParams({ maxResults: String(p.max_results ?? 20), ...(p.page_token ? { pageToken: p.page_token } : {}) }); }
// Pages in one tool context share the same export snapshot, avoiding repeated downloads.
const documentExports = new WeakMap<object, Map<string, Promise<string>>>();
function decodeMessage(message: any): any {
  const decode = (part: any): any => ({ ...part, ...(part.body?.data && /^text\//.test(part.mimeType ?? '') ? { decodedText: Buffer.from(part.body.data, 'base64url').toString('utf8') } : {}), ...(part.parts ? { parts: part.parts.map(decode) } : {}) });
  return { ...message, ...(message.payload ? { payload: decode(message.payload) } : {}) };
}
export const GOOGLE_MAIL_DOCS_TOOLS: Record<string, ToolDefinition> = {
  ...Object.fromEntries(Object.entries(schema).map(([name, parameters]) => [name, { name, parameters, idempotency: 'none', riskLevel: 'medium', group: 'Google Workspace', description: name.startsWith('gdocs_') ? 'Propose a Google Docs change for approval. For editing, read the document first, preserve its tabs and formatting, and supply required_revision_id. requests supports native Docs batchUpdate operations for text, formatting, tables, lists, images and headers.' : 'Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), star (add STARRED), or apply labels. Reply requires actual thread ID and Message-ID header. Never claim a send until approval succeeds.', execute: (p: any, c: ToolContext) => propose(name, parameters.parse(p), c) }] as [string, ToolDefinition])),
  gmail_list_messages: read('gmail_list_messages', 'Search or list Gmail messages with query syntax and pagination. Each result carries id, subject, sender, date and snippet (metadata is fetched for up to 10 hits, the rest return IDs only); use gmail_get_message to read full content.', z.object({ query: z.string().optional(), ...page }), async (p, c) => {
    // The Gmail list endpoint returns ids alone — a bare id list is all an
    // agent can then report ("I found two emails: 19ef…, 19ef…"). Enrich the
    // first page with metadata headers so a listing answers the actual
    // question: what arrived, from whom, when.
    const list = await call(c, 'gmail_read', 'gmail', `/messages?${pageQuery(p)}${p.query ? `&q=${enc(p.query)}` : ''}`);
    const ids: any[] = list.messages ?? [];
    const details = await Promise.all(ids.slice(0, 10).map((m: any) =>
      call(c, 'gmail_read', 'gmail', `/messages/${enc(m.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`).catch(() => null)));
    const messages = ids.map((m: any, i: number) => {
      const detail: any = details[i];
      if (!detail) return { id: m.id, threadId: m.threadId };
      const headers: Record<string, string> = {};
      for (const h of detail.payload?.headers ?? []) headers[h.name] = h.value;
      return { id: m.id, threadId: m.threadId, subject: headers.Subject, from: headers.From, date: headers.Date, snippet: detail.snippet };
    });
    return { messages, nextPageToken: list.nextPageToken ?? null, resultSizeEstimate: list.resultSizeEstimate };
  }),
  gmail_get_message: read('gmail_get_message', 'Read a Gmail message including decoded text, full MIME payload, headers, body and attachment IDs.', z.object({ message_id: id }), async (p, c) => decodeMessage(await call(c, 'gmail_read', 'gmail', `/messages/${enc(p.message_id)}?format=full`))),
  gmail_list_threads: read('gmail_list_threads', 'List Gmail conversations with pagination and optional search.', z.object({ query: z.string().optional(), ...page }), (p, c) => call(c, 'gmail_read', 'gmail', `/threads?${pageQuery(p)}${p.query ? `&q=${enc(p.query)}` : ''}`)),
  gmail_get_thread: read('gmail_get_thread', 'Read every message in a Gmail thread including decoded bodies and Message-ID headers for replies.', z.object({ thread_id: id }), async (p, c) => { const thread = await call(c, 'gmail_read', 'gmail', `/threads/${enc(p.thread_id)}?format=full`); return { ...thread, messages: thread.messages?.map(decodeMessage) }; }),
  gmail_get_attachment: read('gmail_get_attachment', 'Fetch a Gmail attachment by message and attachment IDs. Returns base64url bytes and size; binary bytes are not extracted text.', z.object({ message_id: id, attachment_id: id }), (p, c) => call(c, 'gmail_read', 'gmail', `/messages/${enc(p.message_id)}/attachments/${enc(p.attachment_id)}`)),
  gmail_list_drafts: read('gmail_list_drafts', 'List saved Gmail drafts with pagination.', z.object(page), (p, c) => call(c, 'gmail_read', 'gmail', `/drafts?${pageQuery(p)}`)),
  gmail_get_draft: read('gmail_get_draft', 'Read a saved Gmail draft with decoded body and recipients.', z.object({ draft_id: id }), async (p, c) => { const draft = await call(c, 'gmail_read', 'gmail', `/drafts/${enc(p.draft_id)}?format=full`); return { ...draft, message: decodeMessage(draft.message) }; }),
  gmail_list_labels: read('gmail_list_labels', 'List available Gmail labels and their IDs.', z.object({}), (_p, c) => call(c, 'gmail_read', 'gmail', '/labels')),
  gdocs_get_document: read('gdocs_get_document', 'Read native Google Docs structure, all tabs, text, tables, styles, images and revisionId. Use gdrive_list_files to discover documents.', z.object({ document_id: id }), (p, c) => call(c, 'drive_read', 'docs', `/documents/${enc(p.document_id)}?includeTabsContent=true`)),
  gdocs_read_text: read('gdocs_read_text', 'Read Google Docs exported text through Drive, even when the native Docs API is disabled. Reports truncation and next_offset; continue until next_offset is null. This text export does not supply editing revision IDs.', z.object({ document_id: id, offset: z.number().int().min(0).default(0), max_characters: z.number().int().min(100).max(30000).default(12000) }), async (p, c) => {
    const token = await getGoogleWorkspaceToken(c.organizationId, c.projectId, 'drive_read');
    if (!token) throw new Error('Google Drive reading permission missing. Use connect_platform with platform google_drive.');
    let exports = documentExports.get(c);
    if (!exports || (p.offset ?? 0) === 0) { exports = new Map(); documentExports.set(c, exports); }
    let snapshot = exports.get(p.document_id);
    if (!snapshot) {
      snapshot = (async () => {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${enc(p.document_id)}/export?mimeType=text%2Fplain`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(`Google Docs export error ${response.status}`);
        return response.text();
      })();
      exports.set(p.document_id, snapshot);
      snapshot.catch(() => exports!.delete(p.document_id));
    }
    const text = await snapshot;
    const offset = p.offset ?? 0, end = offset + (p.max_characters ?? 12000);
    return { text: text.slice(offset, end), total_characters: text.length, offset, truncated: end < text.length, next_offset: end < text.length ? end : null };
  }),
};
