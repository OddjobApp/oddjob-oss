import { z } from 'zod';
import type { ToolContext, ToolDefinition } from './types.js';
import { getMicrosoftDocumentToken } from '@domain/integrations/microsoft-document-bridge.js';
import { FileParser } from '@domain/core/infrastructure/file-parser.service.js';

const snapshots = new WeakMap<ToolContext, Map<string, Promise<{ text: string; title: string; url: string }>>>();
async function graph(token: string, path: string) {
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Microsoft document request failed (HTTP ${response.status}). Check the Microsoft connection and Files.Read permissions.`);
    return response.json();
}
const driveBase = (driveId?: string) => driveId ? `/drives/${encodeURIComponent(driveId)}` : '/me/drive';
export const MICROSOFT_DOCUMENT_TOOLS: Record<string, ToolDefinition> = {
    m365_search_sites: {
        name: 'm365_search_sites', label: 'Find SharePoint sites', group: 'Microsoft 365', idempotency: 'read-safe',
        description: 'Find accessible SharePoint sites by name. Use a returned site ID with m365_list_drives to find document libraries.',
        parameters: z.object({ query: z.string().min(1).max(200) }),
        execute: async (params, context) => {
            const token = await getMicrosoftDocumentToken(context.organizationId, context.projectId);
            return JSON.stringify(await graph(token, `/sites?${new URLSearchParams({ search: params.query })}`));
        },
    },
    m365_list_documents: {
        name: 'm365_list_documents', label: 'Find Microsoft documents', group: 'Microsoft 365', idempotency: 'read-safe',
        description: 'Find OneDrive or SharePoint drive files. Omit drive_id for personal OneDrive. Results include drive identifiers needed to read selected documents.',
        parameters: z.object({ drive_id: z.string().optional(), query: z.string().max(200).optional(), folder_id: z.string().optional(), skip_token: z.string().optional(), max_results: z.number().int().min(1).max(100).default(20) }),
        execute: async (params, context) => {
            const token = await getMicrosoftDocumentToken(context.organizationId, context.projectId);
            const base = driveBase(params.drive_id);
            const path = params.query ? `${base}/root/search(q='${encodeURIComponent(params.query.replace(/'/g, "''"))}')` : `${base}/${params.folder_id ? `items/${encodeURIComponent(params.folder_id)}` : 'root'}/children`;
            const query = new URLSearchParams({ '$top': String(params.max_results ?? 20) });
            if (params.skip_token) query.set('$skiptoken', params.skip_token);
            const data = await graph(token, `${path}?${query}`);
            const next = data['@odata.nextLink'];
            return JSON.stringify({ files: (data.value ?? []).filter((item: any) => !item.folder).map((item: any) => ({ id: item.id, name: item.name, mimeType: item.file?.mimeType, webUrl: item.webUrl, driveId: item.parentReference?.driveId ?? params.drive_id, modifiedTime: item.lastModifiedDateTime })), next_skip_token: next ? new URL(next).searchParams.get('$skiptoken') : null });
        },
    },
    m365_list_drives: {
        name: 'm365_list_drives', label: 'List Microsoft document libraries', group: 'Microsoft 365', idempotency: 'read-safe',
        description: 'List OneDrive drives, or SharePoint document libraries for a site_id. Use returned drive IDs to find and read documents.',
        parameters: z.object({ site_id: z.string().optional() }),
        execute: async (params, context) => {
            const token = await getMicrosoftDocumentToken(context.organizationId, context.projectId);
            return JSON.stringify(await graph(token, params.site_id ? `/sites/${encodeURIComponent(params.site_id)}/drives` : '/me/drives'));
        },
    },
    m365_read_document: {
        name: 'm365_read_document', label: 'Read Microsoft document', group: 'Microsoft 365', idempotency: 'read-safe',
        description: 'Read Word DOCX or text documents from OneDrive/SharePoint in character pages. Reuses one download per turn. Continue with next_offset until null; report partial reads. Does not edit documents.',
        parameters: z.object({ document_id: z.string().min(1), drive_id: z.string().optional(), offset: z.number().int().min(0).default(0), max_characters: z.number().int().min(100).max(30000).default(2000) }),
        execute: async (params, context) => {
            const token = await getMicrosoftDocumentToken(context.organizationId, context.projectId);
            const offset = params.offset ?? 0, key = `${params.drive_id ?? 'me'}:${params.document_id}`;
            let cache = snapshots.get(context);
            if (!cache) { cache = new Map(); snapshots.set(context, cache); }
            if (offset === 0) cache.delete(key);
            let snapshot = cache.get(key);
            if (!snapshot) {
                snapshot = (async () => {
                    const base = `${driveBase(params.drive_id)}/items/${encodeURIComponent(params.document_id)}`;
                    const item = await graph(token, base);
                    if (!/\.(docx|txt|md)$/i.test(item.name ?? '')) throw new Error('This reader supports Word DOCX, TXT and Markdown files. This file type requires a different reader.');
                    if (Number(item.size) > 20 * 1024 * 1024) throw new Error('Document exceeds the 20 MB reading limit.');
                    const response = await fetch(`https://graph.microsoft.com/v1.0${base}/content`, { headers: { Authorization: `Bearer ${token}` } });
                    if (!response.ok) throw new Error(`Microsoft document download failed (HTTP ${response.status}).`);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    if (buffer.length > 20 * 1024 * 1024) throw new Error('Document exceeds the 20 MB reading limit.');
                    const parsed = await FileParser.parse(buffer, item.file?.mimeType ?? 'application/octet-stream', item.name);
                    if (parsed.type !== 'text' || typeof parsed.content !== 'string') throw new Error('Document could not be extracted as full text; no complete read is available.');
                    return { text: parsed.content, title: item.name, url: item.webUrl };
                })();
                cache.set(key, snapshot);
                snapshot.catch(() => cache!.delete(key));
            }
            const document = await snapshot;
            const end = Math.min(document.text.length, offset + (params.max_characters ?? 2000));
            return JSON.stringify({ documentId: params.document_id, driveId: params.drive_id, title: document.title, webUrl: document.url, text: document.text.slice(offset, end), total_characters: document.text.length, next_offset: end < document.text.length ? end : null });
        },
    },
};
