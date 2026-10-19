
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockGenerateEmbedding: vi.fn(),
    mockSelect: vi.fn()
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: (...args: any[]) => mocks.mockSelect(...args)
    }
}));

vi.mock('@server/domain/knowledge/core/rag/embedding-service.js', () => ({
    embeddingService: {
        generateEmbedding: (...args: any[]) => mocks.mockGenerateEmbedding(...args)
    }
}));

import { ragService } from '@domain/knowledge/core/rag/rag-agent.service.js';

describe('ragService: fetchMissionRetrospectives', () => {
    const organizationId = 1;
    const query = 'How to search knowledge graph?';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return matching retrospectives based on embedding similarity', async () => {
        const queryEmbedding = [0.1, 0.2, 0.3];
        const matchEmbedding = JSON.stringify([0.11, 0.21, 0.31]);
        const nonMatchEmbedding = JSON.stringify([-0.9, -0.9, -0.9]);

        mocks.mockGenerateEmbedding.mockResolvedValue(queryEmbedding);
        mocks.mockSelect.mockResolvedValue([
            { id: 1, learnedContext: 'Use search_knowledge_graph', embedding: matchEmbedding, organizationId: 1 },
            { id: 2, learnedContext: 'Irrelevant info', embedding: nonMatchEmbedding, organizationId: 1 }
        ]);

        const results = await ragService.fetchMissionRetrospectives(query, organizationId, 0.8);

        expect(results).toHaveLength(1);
        expect(results[0].id).toBe(1);
        expect(mocks.mockGenerateEmbedding).toHaveBeenCalledWith(query);
    });

    it('should return empty if no candidates found', async () => {
        mocks.mockGenerateEmbedding.mockResolvedValue([1, 1, 1]);
        mocks.mockSelect.mockResolvedValue([]);

        const results = await ragService.fetchMissionRetrospectives(query, organizationId);
        expect(results).toHaveLength(0);
    });
});
