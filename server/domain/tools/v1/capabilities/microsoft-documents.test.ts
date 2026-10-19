import { afterEach, describe, expect, it, vi } from 'vitest';
const token = vi.hoisted(() => vi.fn());
vi.mock('@domain/integrations/microsoft-document-bridge.js', () => ({ getMicrosoftDocumentToken: token }));
import { MICROSOFT_DOCUMENT_TOOLS } from './microsoft-documents.js';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('Microsoft document reads', () => {
    it('paginates a full extracted snapshot with one download and carries project scope', async () => {
        token.mockResolvedValue('test-token');
        const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ name: 'Plan.txt', webUrl: 'https://tenant.sharepoint.com/Plan.txt', size: 10000, file: { mimeType: 'text/plain' } })))
            .mockResolvedValueOnce(new Response('a'.repeat(9000) + 'FINAL SECTION'));
        vi.stubGlobal('fetch', fetcher);
        const context = { organizationId: 342, projectId: 3 };
        const first = JSON.parse(await MICROSOFT_DOCUMENT_TOOLS.m365_read_document.execute({ document_id: 'doc', drive_id: 'library', offset: 0, max_characters: 2000 }, context));
        const last = JSON.parse(await MICROSOFT_DOCUMENT_TOOLS.m365_read_document.execute({ document_id: 'doc', drive_id: 'library', offset: 8000, max_characters: 2000 }, context));
        expect(first.next_offset).toBe(2000);
        expect(last.text).toContain('FINAL SECTION');
        expect(last.next_offset).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/drives/library/items/doc');
        expect(token).toHaveBeenLastCalledWith(342, 3);
    });
    it('rejects unsupported binaries without pretending to read their contents', async () => {
        token.mockResolvedValue('test-token');
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'movie.mp4' })));
        vi.stubGlobal('fetch', fetcher);
        await expect(MICROSOFT_DOCUMENT_TOOLS.m365_read_document.execute({ document_id: 'doc' }, { organizationId: 342 })).rejects.toThrow('file type');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('preserves drive identity and search continuation without following arbitrary URLs', async () => {
        token.mockResolvedValue('test-token');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: [{ id: 'doc', name: 'Plan.docx', parentReference: { driveId: 'library' } }, { id: 'folder', folder: {} }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=next' }))));
        const result = JSON.parse(await MICROSOFT_DOCUMENT_TOOLS.m365_list_documents.execute({}, { organizationId: 342 }));
        expect(result.files).toHaveLength(1);
        expect(result.files[0].driveId).toBe('library');
        expect(result.next_skip_token).toBe('next');
    });
});
