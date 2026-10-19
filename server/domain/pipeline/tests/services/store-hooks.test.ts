/**
 * KnowledgeStoreHook tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeStoreHook } from '@domain/pipeline/hooks/store-hooks.js';

const mockGetJob = vi.fn();
const mockCheckOrgFeatureEnabled = vi.fn();
const mockStoreJobOutputAsKnowledge = vi.fn();
const mockUpdateStepExecution = vi.fn();
const mockDbInsert = vi.fn();

vi.mock('@domain/jobs/job.service.js', () => ({
    jobService: {
        getById: (...args: unknown[]) => mockGetJob(...args),
    },
}));

vi.mock('../../core/utils.js', () => ({
    checkOrgFeatureEnabled: (...args: unknown[]) => mockCheckOrgFeatureEnabled(...args),
}));

vi.mock('@domain/knowledge/core/knowledge-store.js', () => ({
    getJobOutputStorageConfig: vi.fn(() => ({})),
    storeJobOutputAsKnowledge: (...args: unknown[]) => mockStoreJobOutputAsKnowledge(...args),
}));

vi.mock('../../core/execution-manager.js', () => ({
    executionManager: {
        updateStepExecution: (...args: unknown[]) => mockUpdateStepExecution(...args),
    },
}));

vi.mock("@server/database_service.js", () => {
    const createMockQuery = (result: any = []) => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
        then: (fn: any) => Promise.resolve(result).then(fn),
    });
    return {
        db: {
            select: vi.fn(() => createMockQuery()),
            insert: vi.fn(() => createMockQuery([{ id: 1 }])),
            update: vi.fn(() => createMockQuery([{ id: 1 }])),
            delete: vi.fn(() => createMockQuery()),
        },
    };
});

vi.mock('../../../server/knowledge-queue.js', () => ({
    queueExtractionJob: vi.fn().mockResolvedValue(undefined),
}));

describe('KnowledgeStoreHook', () => {
    const hook = new KnowledgeStoreHook();

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetJob.mockResolvedValue(null);
        mockCheckOrgFeatureEnabled.mockResolvedValue(false);
    });

    describe('onStepComplete', () => {
        it('returns early when result has no output', async () => {
            await hook.onStepComplete({
                result: { output: '', status: 'success' },
                currentStep: { jobId: 1, id: 1, createdAt: new Date(), pipelineId: 1, order: 0, outputName: 'out', runOnCondition: '', waitDurationSeconds: null, toolArguments: {}, knowledgeGraphConfig: null } as any,
                pipeline: {},
                pipelineExecution: {},
                stepExecution: { id: 1, executedAt: new Date() },
                orgId: 1,
                userId: 'u1',
                context: { positional: {}, named: {} } as any,
            });

            expect(mockGetJob).not.toHaveBeenCalled();
        });

        it('returns early when currentStep has no jobId', async () => {
            await hook.onStepComplete({
                result: { output: 'some output', status: 'success' },
                currentStep: { jobId: null, id: 1, createdAt: new Date(), pipelineId: 1, order: 0, outputName: 'out', runOnCondition: '', waitDurationSeconds: null, toolArguments: {}, knowledgeGraphConfig: null } as any,
                pipeline: {},
                pipelineExecution: {},
                stepExecution: { id: 1, executedAt: new Date() },
                orgId: 1,
                userId: 'u1',
                context: { positional: {}, named: {} } as any,
            });

            expect(mockGetJob).not.toHaveBeenCalled();
        });

        it('skips when job has no enableKnowledgeStore', async () => {
            mockGetJob.mockResolvedValue({
                id: 1,
                enableKnowledgeStore: false,
                outputKnowledgeTopicId: null,
                outputDatasetId: null,
            });
            mockCheckOrgFeatureEnabled.mockResolvedValue(true);

            await hook.onStepComplete({
                result: { output: 'output', status: 'success' },
                currentStep: { jobId: 1, id: 1, createdAt: new Date(), pipelineId: 1, order: 0, outputName: 'out', runOnCondition: '', waitDurationSeconds: null, toolArguments: {}, knowledgeGraphConfig: null } as any,
                pipeline: {},
                pipelineExecution: {},
                stepExecution: { id: 1, executedAt: new Date() },
                orgId: 1,
                userId: 'u1',
                context: { positional: {}, named: {} } as any,
            });

            expect(mockStoreJobOutputAsKnowledge).not.toHaveBeenCalled();
        });

        it('calls storeJobOutputAsKnowledge when job has enableKnowledgeStore and topic', async () => {
            mockGetJob.mockResolvedValue({
                id: 1,
                enableKnowledgeStore: true,
                outputKnowledgeTopicId: 10,
                outputDatasetId: null,
                outputTags: [],
            });
            mockCheckOrgFeatureEnabled.mockResolvedValue(true);
            mockStoreJobOutputAsKnowledge.mockResolvedValue({ knowledgeDocumentId: 5, stats: {} });

            await hook.onStepComplete({
                result: { output: 'output', status: 'success' },
                currentStep: { jobId: 1, id: 1, createdAt: new Date(), pipelineId: 1, order: 0, outputName: 'out', runOnCondition: '', waitDurationSeconds: null, toolArguments: {}, knowledgeGraphConfig: null } as any,
                pipeline: { enableKnowledgeGraph: false },
                pipelineExecution: { id: 100 },
                stepExecution: { id: 1, executedAt: new Date() },
                orgId: 1,
                userId: 'u1',
                context: { positional: {}, named: {} } as any,
            });

            expect(mockStoreJobOutputAsKnowledge).toHaveBeenCalled();
        });
    });
});
