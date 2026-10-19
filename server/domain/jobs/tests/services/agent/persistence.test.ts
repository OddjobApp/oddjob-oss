
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockGetClient: vi.fn(),
    mockGenerateEmbedding: vi.fn(),
    mockInsert: vi.fn()
}));

vi.mock('@server/database_service.js', () => ({
    db: {
        insert: () => ({
            values: mocks.mockInsert
        })
    }
}));

// The org's key, resolved the same way in production and here: no env read.
vi.mock('@domain/ai/core/org-gemini-key.js', () => ({
    resolveOrgGeminiKey: vi.fn(async () => 'test-key'),
}));

vi.mock('@domain/ai/core/ai-client.service.js', () => ({
    AIClientFactory: {
        getClient: vi.fn(() => ({
            execute: mocks.mockGetClient
        }))
    }
}));

vi.mock('@server/domain/knowledge/core/rag/embedding-service.js', () => ({
    embeddingService: {
        generateEmbedding: (...args: any[]) => mocks.mockGenerateEmbedding(...args)
    }
}));

import { saveSuccessfulPlanAsSkill } from '@domain/agents/core/persistence.js';

describe('persistence: saveSuccessfulPlanAsSkill', () => {
    const history = [
        { type: 'thought', content: 'I should search for X' },
        { type: 'action', content: 'search_knowledge_graph({query: "X"})' },
        { type: 'thought', content: 'Found X' }
    ];
    const context = { missionId: 1, organizationId: 1, goal: 'Find X' };

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GEMINI_API_KEY = 'test-key';
    });

    it('should distill history and save as a skill with embeddings', async () => {
        console.log("Starting persistence test...");
        mocks.mockGetClient.mockResolvedValue({
            success: true,
            output: 'Distilled skill template content'
        });
        mocks.mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
        mocks.mockInsert.mockResolvedValue(undefined);

        console.log("Calling saveSuccessfulPlanAsSkill...");
        await saveSuccessfulPlanAsSkill(history, context);
        console.log("Finished saveSuccessfulPlanAsSkill.");

        expect(mocks.mockGetClient).toHaveBeenCalled();
        expect(mocks.mockGenerateEmbedding).toHaveBeenCalled();
        expect(mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            missionId: 1,
            successScore: 100,
            embedding: JSON.stringify([0.1, 0.2, 0.3])
        }));
    });

    it('should handle distillation failure gracefully', async () => {
        mocks.mockGetClient.mockResolvedValue({ success: false, error: 'AI Error' });
        
        await saveSuccessfulPlanAsSkill(history, context);
        
        expect(mocks.mockGenerateEmbedding).not.toHaveBeenCalled();
        expect(mocks.mockInsert).not.toHaveBeenCalled();
    });
});
