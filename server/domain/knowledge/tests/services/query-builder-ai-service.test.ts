/**
 * QueryBuilderAiService tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetLabels = vi.hoisted(() => vi.fn());
const mockGetRelationshipTypes = vi.hoisted(() => vi.fn());
const mockGetAiConfig = vi.hoisted(() => vi.fn());
const mockGetClient = vi.hoisted(() => vi.fn());
const mockExecute = vi.hoisted(() => vi.fn());

vi.mock('@server/domain/knowledge/index', () => ({
    knowledgeService: {}, // Add other exports if needed
    graphService: {
        getLabels: (...args: unknown[]) => mockGetLabels(...args),
        getRelationshipTypes: (...args: unknown[]) => mockGetRelationshipTypes(...args),
    },
}));

vi.mock('@server/domain/ai/core/system-ai.service', () => ({
    systemAiService: {
        getAiConfig: (...args: unknown[]) => mockGetAiConfig(...args),
    },
}));

vi.mock('@domain/ai/core/ai-client.service.js', () => ({
    AIClientFactory: {
        getClient: (...args: unknown[]) => mockGetClient(...args),
    },
}));

vi.mock('../../../server/utils/logger.js', () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { queryBuilderAiService } from "@domain/knowledge/core/query-builder-ai.service.js";

describe('QueryBuilderAiService', () => {
    const orgContext = { 
        userId: 'u1', 
        organizationId: 1,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetLabels.mockResolvedValue(['Person', 'Company']);
        mockGetRelationshipTypes.mockResolvedValue(['WORKS_AT', 'OWNS']);
        mockGetAiConfig.mockResolvedValue({
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'sk-test',
            baseUrl: 'https://api.openai.com',
            credentialId: 1,
        });
        mockGetClient.mockReturnValue({ execute: mockExecute });
        mockExecute.mockResolvedValue({
            success: true,
            output: JSON.stringify({
                nodes: [{ id: 'n1', label: 'Person', alias: 'p', filters: [] }],
                relationships: [],
                returnClause: { items: [{ type: 'node', id: 'n1' }] },
                limit: 50,
            }),
        });
    });

    describe('generateVisualQuery', () => {
        it('returns valid VisualQuery when AI returns valid JSON', async () => {
            const result = await queryBuilderAiService.generateVisualQuery(
                'Find all people',
                orgContext
            );

            expect(result.nodes).toHaveLength(1);
            expect(result.nodes![0].label).toBe('Person');
            expect(mockGetLabels).toHaveBeenCalledWith(orgContext);
            expect(mockGetRelationshipTypes).toHaveBeenCalledWith(orgContext);
            expect(mockGetAiConfig).toHaveBeenCalledWith('copilot');
            expect(mockExecute).toHaveBeenCalled();
        });

        it('includes currentQuery in prompt when provided', async () => {
            const currentQuery = { nodes: [{ id: 'n1', label: 'Person' }], relationships: [], returnClause: { items: [] }, limit: 10 };
            await queryBuilderAiService.generateVisualQuery('Add company filter', orgContext, currentQuery);

            expect(mockExecute).toHaveBeenCalledWith(
                expect.objectContaining({
                    userPrompt: expect.stringContaining(JSON.stringify(currentQuery, null, 2)),
                }),
                undefined,
                'sk-test'
            );
        });

        it('throws when AI config is missing', async () => {
            mockGetAiConfig.mockResolvedValue(null);

            await expect(
                queryBuilderAiService.generateVisualQuery('Find people', orgContext)
            ).rejects.toThrow('AI Service not configured');
            expect(mockExecute).not.toHaveBeenCalled();
        });

        it('throws when AI config has no apiKey', async () => {
            mockGetAiConfig.mockResolvedValue({ provider: 'openai', model: 'gpt-4', apiKey: null });

            await expect(
                queryBuilderAiService.generateVisualQuery('Find people', orgContext)
            ).rejects.toThrow('AI Service not configured');
        });

        it('throws when AI execution fails', async () => {
            mockExecute.mockResolvedValue({ success: false, error: 'Rate limit exceeded' });

            await expect(
                queryBuilderAiService.generateVisualQuery('Find people', orgContext)
            ).rejects.toThrow('AI Generation failed');
        });

        it('throws when AI returns invalid JSON', async () => {
            mockExecute.mockResolvedValue({ success: true, output: 'not valid json {' });

            await expect(
                queryBuilderAiService.generateVisualQuery('Find people', orgContext)
            ).rejects.toThrow('AI returned invalid JSON structure');
        });

        it('strips markdown code blocks from AI output', async () => {
            mockExecute.mockResolvedValue({
                success: true,
                output: '```json\n{"nodes":[{"id":"n1","label":"Person","alias":"p","filters":[]}],"relationships":[],"returnClause":{"items":[{"type":"node","id":"n1"}]},"limit":50}\n```',
            });

            const result = await queryBuilderAiService.generateVisualQuery('Find people', orgContext);

            expect(result.nodes).toHaveLength(1);
            expect(result.nodes![0].label).toBe('Person');
        });

        it('throws when AI returns query with no nodes', async () => {
            mockExecute.mockResolvedValue({
                success: true,
                output: JSON.stringify({
                    nodes: [],
                    relationships: [],
                    returnClause: { items: [] },
                    limit: 50,
                }),
            });

            await expect(
                queryBuilderAiService.generateVisualQuery('Find people', orgContext)
            ).rejects.toThrow('AI generated a query with no nodes');
        });
    });
});
