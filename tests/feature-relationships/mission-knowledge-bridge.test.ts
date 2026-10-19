/**
 * Mission Knowledge Bridge Tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { missionKnowledgeBridge } from '../../server/domain/mission/core/mission-knowledge-bridge.js';

const mockDbSelect = vi.fn();

/**
 * Order-independent drizzle select double. The previous inline mocks hardcoded
 * `from -> where -> leftJoin -> limit`, but the bridge calls
 * `from -> innerJoin -> where -> limit`, so the chain returned undefined and every
 * assertion saw an undefined result. Builder methods return `this` and the object is
 * thenable, which covers both `await q.limit(1)` and `q.limit(1).then(r => r[0])`.
 */
function selectChain(rows: any[]) {
    const q: any = {
        from: () => q,
        innerJoin: () => q,
        leftJoin: () => q,
        where: () => q,
        orderBy: () => q,
        groupBy: () => q,
        limit: () => q,
        offset: () => q,
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return q;
}

// The bridge collaborates with FOUR services, not one. Mocking only knowledgeService
// left graphService, topicService and longTermMemoryService live, so they reached the
// real database and every assertion saw `undefined` — which reads as a broken bridge
// rather than an incomplete test double.
const {
    mockKnowledgeService,
    mockGraphService,
    mockTopicService,
    mockLongTermMemoryService,
} = vi.hoisted(() => ({
    mockKnowledgeService: { searchNodes: vi.fn(), addNode: vi.fn(), addRelationship: vi.fn(), enrichNode: vi.fn() },
    mockGraphService: {
        // searchNodes resolves { nodes }, matching the real service — the bridge
        // destructures it, so returning a bare array silently yields undefined.
        searchNodes: vi.fn().mockResolvedValue({ nodes: [] }),
        createNode: vi.fn().mockResolvedValue({ id: 1 }),
        createEdge: vi.fn().mockResolvedValue({ id: 1 }),
        createRelationship: vi.fn().mockResolvedValue({ id: 1 }),
    },
    mockTopicService: {
        listTopics: vi.fn().mockResolvedValue([]),
        createTopic: vi.fn().mockResolvedValue({ id: 99 }),
    },
    // Method names mirror the real service exactly (remember / getContextString). A
    // wrong name here does not fail loudly — the bridge catches it and returns
    // { success: false, message: "... is not a function" }, which looks like a
    // product bug in the assertion output.
    mockLongTermMemoryService: {
        remember: vi.fn().mockResolvedValue(undefined),
        getContextString: vi.fn().mockResolvedValue(''),
    },
}));

vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
    },
}));

vi.mock('@domain/knowledge/core/knowledge.service.js', () => ({
    knowledgeService: mockKnowledgeService,
}));

vi.mock('@domain/knowledge/core/graph/graph-service.js', () => ({
    graphService: mockGraphService,
}));

vi.mock('@domain/knowledge/core/topic-service.js', () => ({
    topicService: mockTopicService,
}));

vi.mock('@domain/agents/core/long-term-memory.service.js', () => ({
    longTermMemoryService: mockLongTermMemoryService,
}));

describe('Mission Knowledge Bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('captureMissionLearning', () => {
        it('should capture completed mission to knowledge graph', async () => {
            const mockRun = {
                id: 1,
                missionId: 5,
                status: 'completed',
                executionStrategy: 'rolling_wave',
                outcome: { summary: 'Successfully built API integration' },
                organizationId: 1,
            };

            const mockMission = {
                id: 5,
                objective: 'Build Slack integration',
            };

            mockDbSelect.mockReturnValue(selectChain([{ ...mockRun, ...mockMission }]));

            mockKnowledgeService.addNode.mockResolvedValue({ id: 100 });
            mockGraphService.searchNodes.mockResolvedValue({ nodes: [] });

            const result = await missionKnowledgeBridge.captureMissionLearning(1);

            // Current API resolves { success, nodeIds?, message? } — not { captured }.
            expect(result.success).toBe(true);
            expect(result.nodeIds).toBeDefined();
        });

        it('should not capture non-terminal missions', async () => {
            const mockRun = {
                id: 1,
                status: 'active',
            };

            mockDbSelect.mockReturnValue(selectChain([mockRun]));

            const result = await missionKnowledgeBridge.captureMissionLearning(1);

            expect(result.success).toBe(false);
            expect(result.message).toContain('not terminal');
        });

        it('reports a missing mission run rather than throwing', async () => {
            // The old assertion checked `result.merged`, a field the current API does
            // not return; merge behaviour now lives in the graph layer. What the bridge
            // still guarantees is that an unknown run is reported, not thrown.
            mockDbSelect.mockReturnValue(selectChain([]));

            const result = await missionKnowledgeBridge.captureMissionLearning(999);

            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });
    });

    // Renamed on the service: getRelevantMissions -> findSimilarMissions, and the
    // argument order is (organizationId, objective) rather than (objective, orgId).
    describe('findSimilarMissions', () => {
        it('should return similar past missions for objective', async () => {
            const mockNodes = [
                { 
                    id: 1, 
                    properties: { 
                        objective: 'Build Slack bot',
                        outcome: 'success',
                        executionStrategy: 'rolling_wave',
                    } 
                },
                { 
                    id: 2, 
                    properties: { 
                        objective: 'Build Discord integration',
                        outcome: 'partial',
                        executionStrategy: 'sequential',
                    } 
                },
            ];

            mockGraphService.searchNodes.mockResolvedValue({ nodes: mockNodes });

            const missions = await missionKnowledgeBridge.findSimilarMissions(
                1,
                'Build chat integration'
            );

            expect(missions).toHaveLength(2);
        });
    });

    // Renamed on the service: enrichMissionWithKnowledge -> enrichMissionContext, which
    // takes (missionId, objective, organizationId) and resolves
    // { relevantMissions, keyFacts, suggestedStrategies, entities } — there is no
    // `enriched` flag on the current API.
    describe('enrichMissionContext', () => {
        it('should surface relevant entities for the objective', async () => {
            const mockEntities = [
                { id: 1, name: 'Slack API', label: 'Service', properties: {} },
                { id: 2, name: 'webhook', label: 'Concept', properties: {} },
            ];

            mockGraphService.searchNodes.mockResolvedValue({ nodes: mockEntities });

            const enrichment = await missionKnowledgeBridge.enrichMissionContext(
                5,
                'Slack integration',
                1
            );

            expect(enrichment).toBeDefined();
            expect(Array.isArray(enrichment.entities)).toBe(true);
        });
    });
});
