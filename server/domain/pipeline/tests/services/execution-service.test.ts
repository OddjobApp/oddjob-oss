/**
 * Pipeline Execution Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMockQuery = (result: unknown[] | unknown = []) => {
    const resolved = Array.isArray(result) ? result : [result];
    return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(resolved),
        then: (fn: (v: unknown) => unknown) => Promise.resolve(resolved).then(fn),
    };
};

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
    },
}));

vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: vi.fn((_name: string, fn: () => unknown) => fn()),
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

const mockGetById = vi.fn();
vi.mock("@server/domain/pipeline/core/pipeline-engine.js", () => ({
    pipelineEngine: { getById: (...args: unknown[]) => mockGetById(...args) },
    getOrgConditions: vi.fn(() => []),
}));

import { db } from "@server/database_service.js";
import { executionManager as executionService } from "../../core/execution-manager.js";
import type { OrgContext } from "@server/utils/auth-context.js";

describe('Pipeline Execution Service', () => {
    const orgContext: OrgContext = { 
        userId: 'u1', 
        organizationId: 1,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false
    };

    beforeEach(() => {
        mockGetById.mockReset();
        mockGetById.mockResolvedValue({ id: 1, name: 'Pipeline 1', steps: [{ id: 1 }] });
        // Use mockReset for db to clear call history but preserve implementations from vi.mock
        (db.select as ReturnType<typeof vi.fn>).mockReset();
        (db.insert as ReturnType<typeof vi.fn>).mockReset();
        (db.update as ReturnType<typeof vi.fn>).mockReset();
        // Restore default implementations (mockReset clears them)
        (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery());
        (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery());
        (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery());
    });

    describe('listRecentExecutions', () => {
        it('returns executions with pipeline names', async () => {
            const rows = [{ execution: { id: 1, status: 'completed' }, pipelineName: 'My Pipeline' }];
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(rows));

            const result = await executionService.listRecentExecutions(orgContext);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ id: 1, status: 'completed', pipelineName: 'My Pipeline' });
        });

        it('respects limit option', async () => {
            const chain = createMockQuery([]);
            (chain as any).limit = vi.fn().mockReturnValue(chain);
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

            await executionService.listRecentExecutions(orgContext, { limit: 5 });

            expect(chain.limit).toHaveBeenCalledWith(5);
        });
    });

    describe('getExecutions', () => {
        it('returns executions for pipeline', async () => {
            const rows = [{ id: 1, pipelineId: 1, status: 'completed' }];
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(rows));

            const result = await executionService.getExecutions(1, orgContext);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ id: 1, pipelineId: 1 });
            expect(mockGetById).toHaveBeenCalledWith(1, orgContext);
        });
    });

    describe('getExecutionDetails', () => {
        it('throws NotFoundError when execution not found', async () => {
            (db.select as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(createMockQuery([]))
                .mockReturnValueOnce(createMockQuery([]));

            await expect(executionService.getExecutionDetails(999, orgContext)).rejects.toThrow('Execution not found');
        });

        it('returns execution with step executions when found', async () => {
            const execution = { id: 1, pipelineId: 1, status: 'completed' };
            const stepExecutions = [{ id: 1, pipelineExecutionId: 1 }];
            (db.select as ReturnType<typeof vi.fn>)
                .mockImplementationOnce(() => createMockQuery([execution]))
                .mockImplementationOnce(() => createMockQuery(stepExecutions));

            const result = await executionService.getExecutionDetails(1, orgContext);

            expect(result).toMatchObject({ execution, stepExecutions });
        });
    });

    describe('getExecutionSystem', () => {
        it('returns execution by id without org check', async () => {
            const execution = { id: 1, pipelineId: 1 };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([execution]));

            const result = await executionService.getExecutionSystem(1);

            expect(result).toMatchObject(execution);
        });
    });

    describe('createExecution', () => {
        it('inserts and returns execution', async () => {
            const inserted = { id: 1, pipelineId: 1, status: 'running' };
            (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(inserted));

            const result = await executionService.createExecution({ pipelineId: 1, status: 'running' });

            expect(result).toMatchObject(inserted);
        });
    });

    describe('updateExecution', () => {
        it('updates and returns execution', async () => {
            const updated = { id: 1, status: 'completed' };
            (db.update as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(updated));

            const result = await executionService.updateExecution(1, { status: 'completed' });

            expect(result).toMatchObject(updated);
        });

        it('throws NotFoundError when no rows updated', async () => {
            (db.update as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([]));

            await expect(executionService.updateExecution(999, { status: 'completed' })).rejects.toThrow(
                'Execution not found'
            );
        });
    });

    describe('cancelExecution', () => {
        it('throws BadRequestError when execution is not running or pending', async () => {
            const execution = { id: 1, status: 'completed' };
            const stepExecutions: any[] = [];
            (db.select as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(createMockQuery([execution]))
                .mockReturnValueOnce(createMockQuery(stepExecutions));

            await expect(executionService.cancelExecution(1, orgContext)).rejects.toThrow(
                'Cannot cancel execution that is not running or pending'
            );
        });

        it('updates status to cancelled when execution is running', async () => {
            const execution = { id: 1, pipelineId: 1, status: 'running' };
            const stepExecutions: any[] = [];
            const cancelled = { id: 1, status: 'cancelled' };
            let selectCallCount = 0;
            (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
                selectCallCount++;
                return createMockQuery(selectCallCount === 1 ? [execution] : stepExecutions);
            });
            (db.update as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([cancelled]));

            const result = await executionService.cancelExecution(1, orgContext);

            expect(result).toMatchObject({ status: 'cancelled' });
        });
    });

    describe('getChildExecutions', () => {
        it('returns child executions for parent execution', async () => {
            const children = [
                { id: 10, pipelineId: 2, status: 'completed', startedAt: new Date(), completedAt: new Date(), pipelineName: 'Child Pipeline' },
            ];
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(children));

            const result = await executionService.getChildExecutions(5, orgContext);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ id: 10, pipelineId: 2, pipelineName: 'Child Pipeline' });
        });

        it('returns empty array when no children exist', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([]));

            const result = await executionService.getChildExecutions(99, orgContext);

            expect(result).toEqual([]);
        });
    });

    describe('getLatestRun', () => {
        it('returns null when no executions exist', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery([]));

            const result = await executionService.getLatestRun(1, orgContext);

            expect(result).toBeNull();
        });

        it('returns latest execution with step results when exists', async () => {
            const latestExec = { id: 10 };
            const execution = { id: 10, pipelineId: 1, status: 'completed' };
            const stepResults = [{ id: 1, pipelineExecutionId: 10 }];
            (db.select as ReturnType<typeof vi.fn>)
                .mockImplementationOnce(() => createMockQuery([latestExec]))
                .mockImplementationOnce(() => createMockQuery([execution]))
                .mockImplementationOnce(() => createMockQuery(stepResults));

            const result = await executionService.getLatestRun(1, orgContext);

            expect(result).toMatchObject({ ...execution, stepResults });
        });
    });
});
