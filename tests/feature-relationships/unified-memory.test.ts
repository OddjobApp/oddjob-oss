/**
 * Unified Memory Service Tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unifiedMemoryService } from '../../server/domain/agents/core/unified-memory.service.js';

const { mockLongTermMemory, mockKnowledgeService, mockGraphService } = vi.hoisted(() => ({
    mockLongTermMemory: { getRelevantMemories: vi.fn(), recall: vi.fn(), store: vi.fn() },
    mockKnowledgeService: { searchNodes: vi.fn(), query: vi.fn() },
    mockGraphService: { searchNodes: vi.fn(), getNodeEdgesBatch: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@domain/agents/core/long-term-memory.service.js', () => ({
    longTermMemoryService: mockLongTermMemory,
}));

vi.mock('@domain/knowledge/core/knowledge.service.js', () => ({
    knowledgeService: mockKnowledgeService,
}));

vi.mock('@domain/knowledge/core/graph/graph-service.js', () => ({
    graphService: mockGraphService,
}));

describe('Unified Memory Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('queryUnified', () => {
        it('should merge LTM and KG results', async () => {
            const ltmMemories = [
                { id: 1, content: 'User prefers TypeScript', relevance: 0.9, type: 'preference' },
            ];
            const kgNodes = [
                { id: 10, name: 'API Integration', label: 'concept', data: {} },
            ];

            mockLongTermMemory.recall.mockResolvedValue(ltmMemories);
            mockKnowledgeService.searchNodes.mockResolvedValue(kgNodes);

            const result = await unifiedMemoryService.queryUnified({
                organizationId: 1,
                userId: 'user-123',
                search: 'How to integrate API?',
                includeGraph: true,
                includeMemories: true,
                limit: 5,
            });

            expect(result.memories).toHaveLength(1);
            expect(result.graphNodes).toHaveLength(1);
            expect(result.consolidated.length).toBeGreaterThan(0);
        });

        it('should query long-term memory for user queries', async () => {
            mockLongTermMemory.recall.mockResolvedValue([]);
            mockKnowledgeService.searchNodes.mockResolvedValue([]);

            await unifiedMemoryService.queryUnified({
                organizationId: 1,
                userId: 'user-123',
                search: 'What did I work on yesterday?',
            });

            expect(mockLongTermMemory.recall).toHaveBeenCalled();
        });
    });

    describe('query', () => {
        it('should execute unified query across memory systems', async () => {
            const ltmResults = [{ content: 'Memory 1', type: 'fact' }];
            const kgResults = [{ id: 10, name: 'Entity 1', label: 'concept', data: {} }];

            mockLongTermMemory.recall.mockResolvedValue(ltmResults);
            mockKnowledgeService.searchNodes.mockResolvedValue(kgResults);

            const result = await unifiedMemoryService.query(
                'deployment process',
                1,
                { userId: 'user-123' }
            );

            expect(result.memories).toEqual(ltmResults);
            expect(result.graphNodes).toEqual(kgResults);
        });
    });

    describe('syncBidirectional', () => {
        it('should attempt sync for an organization', async () => {
            const result = await unifiedMemoryService.syncBidirectional(1);
            expect(result).toBeDefined();
        });
    });

    describe('recall / getUnifiedContext', () => {
        it('should return formatted context string for prompts', async () => {
            mockLongTermMemory.recall.mockResolvedValue([
                { content: 'Memory A', type: 'fact', key: 'keyA' },
            ]);
            mockKnowledgeService.searchNodes.mockResolvedValue([
                { id: 2, name: 'Entity B', label: 'concept', data: { content: 'Content B' } },
            ]);

            const context = await unifiedMemoryService.recall(
                'Test query',
                1,
                'user-123'
            );

            expect(context).toContain('UNIFIED ORGANIZATIONAL MEMORY');
            expect(context).toContain('Personal Memory');
            expect(context).toContain('Memory A');
            expect(context).toContain('Entity B');
        });
    });
});
