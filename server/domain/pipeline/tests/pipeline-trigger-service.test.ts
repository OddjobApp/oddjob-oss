/**
 * Pipeline Trigger Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOn = vi.fn();
const mockExecutePipeline = vi.fn();
const mockResolveActiveRelease = vi.fn();
const mockFindByPipeline = vi.fn();

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        on: (...args: unknown[]) => mockOn(...args),
    },
}));

vi.mock("@server/core/pipeline-executor.js", () => {
    const instance = { executePipeline: (...args: unknown[]) => mockExecutePipeline(...args) };
    return {
        PipelineExecutor: class MockPipelineExecutor {
            executePipeline = (...args: unknown[]) => mockExecutePipeline(...args);
        },
        pipelineExecutor: instance,
    };
});

vi.mock("@domain/pipeline/core/workflow-lifecycle.service.js", () => ({
    workflowLifecycleService: {
        resolveActiveRelease: (...args: unknown[]) => mockResolveActiveRelease(...args),
        findByPipeline: (...args: unknown[]) => mockFindByPipeline(...args),
    },
}));

const createMockQuery = (result: unknown[] = []) => ({
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(result)),
    then: (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn),
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    },
}));

import { PipelineTriggerService } from "@domain/pipeline/core/pipeline-trigger.service.js";
import { db } from '@server/database_service.js';

describe('PipelineTriggerService', () => {
    let service: PipelineTriggerService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new PipelineTriggerService();
        (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([]));
    });

    describe('start', () => {
        it('subscribes to event stream', async () => {
            await service.start();
            expect(mockOn).toHaveBeenCalledWith('*', expect.any(Function));
        });
    });

    describe('handleEvent', () => {
        it('does nothing when no triggers match', async () => {
            await service.start();
            const handler = mockOn.mock.calls[0][1];
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([]));

            await handler({ eventType: 'test.event', payload: {} });

            expect(mockExecutePipeline).not.toHaveBeenCalled();
        });

        it('executes pipeline when trigger matches', async () => {
            await service.start();
            const handler = mockOn.mock.calls[0][1];
            const triggers = [
                {
                    trigger: { id: 1, pipelineId: 10, eventType: 'test.event', isActive: true, filterCondition: null },
                    pipeline: { id: 10, name: 'Test', isActive: true },
                },
            ];
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(triggers));
            mockExecutePipeline.mockResolvedValue(undefined);

            await handler({ eventType: 'test.event', payload: { data: 'value' } });

            expect(mockExecutePipeline).toHaveBeenCalledWith(
                10,
                'system-event-trigger',
                null,
                null,
                expect.objectContaining({ event: { eventType: 'test.event', payload: { data: 'value' } } }),
                undefined,
                undefined,
                undefined,
                undefined,
                undefined
            );
        });
    });

    describe('workflow-gated execution', () => {
        const triggerRow = (over: Record<string, unknown> = {}) => [{
            trigger: { id: 1, pipelineId: 10, eventType: 'test.event', isActive: true, filterCondition: null, ...over },
            pipeline: { id: 10, name: 'Test', isActive: true },
        }];

        const queueSelects = (...results: unknown[][]) => {
            for (const r of results) {
                (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => createMockQuery(r) as never);
            }
        };

        it('does not fire when the pipeline is a workflow draft with no active deployment', async () => {
            await service.start();
            const handler = mockOn.mock.calls[0][1];
            queueSelects(triggerRow(), []); // trigger lookup, dedupe check
            mockResolveActiveRelease.mockResolvedValue(null);
            mockFindByPipeline.mockResolvedValue({ id: 42, draftPipelineId: 10 });

            await handler({ eventType: 'test.event', eventId: 'evt-1', payload: {} });

            expect(mockResolveActiveRelease).toHaveBeenCalledWith(10);
            expect(mockExecutePipeline).not.toHaveBeenCalled();
            // The skip is recorded, not silent.
            expect(vi.mocked(db.insert)).toHaveBeenCalled();
        });

        it('passes the active release/deployment to the executor', async () => {
            await service.start();
            const handler = mockOn.mock.calls[0][1];
            queueSelects(triggerRow(), []);
            mockResolveActiveRelease.mockResolvedValue({
                workflowId: 42, releaseId: 71, deploymentId: 88, manifest: {},
            });
            mockExecutePipeline.mockResolvedValue({ executionId: 500 });

            await handler({ eventType: 'test.event', eventId: 'evt-2', payload: {} });

            expect(mockExecutePipeline).toHaveBeenCalledWith(
                10, 'system-event-trigger', null, null,
                expect.objectContaining({ event: expect.objectContaining({ eventType: 'test.event' }) }),
                undefined, undefined, undefined, undefined,
                { workflowReleaseId: 71, workflowDeploymentId: 88 }
            );
        });

        it('skips a duplicate (triggerId, eventId) delivery', async () => {
            await service.start();
            const handler = mockOn.mock.calls[0][1];
            queueSelects(triggerRow(), [{ id: 900 }]); // dedupe check finds a prior 'executed' log

            await handler({ eventType: 'test.event', eventId: 'evt-3', payload: {} });

            expect(mockExecutePipeline).not.toHaveBeenCalled();
            expect(mockResolveActiveRelease).not.toHaveBeenCalled();
        });

        it('runs exactly as before when no workflow owns the pipeline', async () => {
            await service.start();
            const handler = mockOn.mock.calls[0][1];
            queueSelects(triggerRow(), []);
            mockResolveActiveRelease.mockResolvedValue(null);
            mockFindByPipeline.mockResolvedValue(null);
            mockExecutePipeline.mockResolvedValue({ executionId: 501 });

            await handler({ eventType: 'test.event', eventId: 'evt-4', payload: {} });

            expect(mockExecutePipeline).toHaveBeenCalledWith(
                10, 'system-event-trigger', null, null,
                expect.anything(),
                undefined, undefined, undefined, undefined, undefined
            );
        });
    });
});


