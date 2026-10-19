import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ retrieve: vi.fn(async () => [
  { metadata: { attachmentId: 1 }, pageContent: 'Detached file' },
  { metadata: { attachmentId: 2 }, pageContent: 'Current room file' },
]) }));
vi.mock('@server/database_service.js', () => ({ db: { select: () => ({ from: () => ({ where: async () => [{ id: 2 }] }) }) } }));
vi.mock('./rag-langchain.service.js', () => ({ DEFAULT_SECURITY_CLASSIFICATION: 'internal', retrieveSimilarDocuments: mocks.retrieve }));
import { attachmentIndexService } from './attachment-index.service';
describe('Attachment search membership', () => {
  it('excludes detached files even when stale vector chunks remain', async () => {
    const result = await attachmentIndexService.search({ orgId: 342, sessionId: 19, query: 'file' });
    expect(result.map(item => item.attachmentId)).toEqual([2]);
    expect(mocks.retrieve).toHaveBeenCalledWith('file', expect.objectContaining({ organizationId: 342, filter: { must: [
      { key: 'assetType', match: { value: 'attachment' } }, { key: 'sessionId', match: { value: 19 } },
    ] } }));
  });
  it('refuses an unscoped search', async () => {
    await expect(attachmentIndexService.search({ orgId: 342, query: 'file' })).rejects.toThrow('requires a project or room');
  });
});
