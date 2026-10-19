// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
const retrieve = vi.hoisted(() => vi.fn());
vi.mock('../../knowledge/core/rag/graph-rag.service.js', () => ({ graphRagService: { retrieveWithGraphTraversal: retrieve } }));
import { GraphRAGService } from './graph-rag.service.js';
describe('Supervisor GraphRAG adapter', () => {
  beforeEach(() => { retrieve.mockReset(); });
  it('uses production retrieval with organization, mission and limits and preserves evidence', async () => {
    retrieve.mockResolvedValue([
      { nodeId: 1, content: 'Alpha evidence', confidence: .9, metadata: { name: 'Alpha', label: 'Topic' } },
      { nodeId: 2, content: 'Beta evidence', confidence: .8, metadata: { name: 'Beta', label: 'Topic' }, path: [{ from: 'Alpha', to: 'Beta', relation: 'RELATED_TO' }] },
    ]);
    const result = await GraphRAGService.query({ query: 'test', organizationId: 4, missionId: 8, depth: 1, limit: 3 });
    expect(retrieve).toHaveBeenCalledWith('test', expect.objectContaining({ organizationId: 4, isSuperAdmin: false }), { maxHops: 1, maxResults: 3, includePaths: true, missionId: 8 });
    expect(result.entities[0].provenance.evidence).toBe('Alpha evidence');
    expect(result.relationships).toEqual([{ sourceId: '1', targetId: '2', type: 'RELATED_TO', confidence: .8 }]);
    expect(GraphRAGService.formatForPrompt(result)).toContain('Alpha evidence');
  });
  it('reports an empty result without invented discoveries', async () => {
    retrieve.mockResolvedValue([]);
    expect(await GraphRAGService.query({ query: 'test', organizationId: 1 })).toEqual({ entities: [], relationships: [], summary: 'No matching knowledge records were retrieved.' });
  });
  it('propagates retrieval errors to the supervisor error handler', async () => {
    retrieve.mockRejectedValue(new Error('offline'));
    await expect(GraphRAGService.query({ query: 'test', organizationId: 1 })).rejects.toThrow('offline');
  });
  it('rejects a missing organization before retrieval', async () => {
    await expect(GraphRAGService.query({ query: 'test', organizationId: null as any })).rejects.toThrow('organization');
    expect(retrieve).not.toHaveBeenCalled();
  });
  it('does not guess IDs for ambiguous path labels', async () => {
    retrieve.mockResolvedValue([1,2].map(nodeId => ({ nodeId, content: 'evidence', confidence: .5, metadata: { name: 'Same' }, path: [{ from: 'Same', to: 'Same', relation: 'RELATED_TO' }] })));
    expect((await GraphRAGService.query({ query: 'test', organizationId: 1 })).relationships).toEqual([]);
  });
});
