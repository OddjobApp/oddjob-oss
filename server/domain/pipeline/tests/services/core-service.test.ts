/**
 * Pipeline Core Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMockQuery = (result: unknown[] = []) => {
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
        selectDistinct: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
        delete: vi.fn(() => createMockQuery()),
    },
}));

vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: vi.fn((_name: string, fn: () => unknown) => fn()),
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("@server/domain/pipeline/core/graph-service.js", () => ({
    graphService: {
        validateSteps: vi.fn(),
        validateGraph: vi.fn(),
    },
}));

import { getOrgConditions, pipelineEngine as coreService } from "@server/domain/pipeline/core/pipeline-engine.js";
import { db } from "@server/database_service.js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { OrgContext } from "@server/utils/auth-context.js";

describe('Pipeline Core Service', () => {
    const orgContextWithOrg: OrgContext = { 
        userId: 'u1', 
        organizationId: 1,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false
    };
    const orgContextWithoutOrg: OrgContext = { 
        userId: 'u1', 
        organizationId: null,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false
    };

    describe('getOrgConditions', () => {
        it('returns eq for organizationId when orgContext has organizationId', () => {
            const conditions = getOrgConditions(orgContextWithOrg);
            expect(conditions).toHaveLength(1);
            expect(conditions[0]).toBeDefined();
        });

        it('returns IS NULL condition when organizationId is null', () => {
            const conditions = getOrgConditions(orgContextWithoutOrg);
            expect(conditions).toHaveLength(1);
            expect(conditions[0]).toBeDefined();
        });

        // This helper used to restate the org rule locally; it now delegates to
        // the canonical `server/utils/org-conditions.ts`. The two agreed on every
        // case EXCEPT an unscoped super admin, which the local copy filtered to
        // null-org pipelines only. Canonical returns no filter, matching how the
        // rest of the platform treats a super admin who has not selected an org.
        // Pinned here so the widening stays a decision rather than a regression.
        it('returns NO filter for a super admin who has not selected an organization', () => {
            const conditions = getOrgConditions({
                userId: 'u1',
                organizationId: null,
                isAdmin: true,
                isSuperAdmin: true,
                isOrgAdmin: false,
            });
            expect(conditions).toHaveLength(0);
        });

        it('still scopes a super admin who HAS selected an organization', () => {
            const conditions = getOrgConditions({
                userId: 'u1',
                organizationId: 7,
                isAdmin: true,
                isSuperAdmin: true,
                isOrgAdmin: false,
            });
            expect(conditions).toHaveLength(1);
            expect(conditions[0]).toBeDefined();
        });

        it('does not expose null-org pipelines to an org-scoped user', () => {
            // allowGlobal:false — a NULL-organization pipeline must not leak into
            // an org-scoped listing. Guards the third argument at the call site,
            // which is the difference between strict isolation and "org OR global".
            const { sql: rendered } = new PgDialect().sqlToQuery(getOrgConditions(orgContextWithOrg)[0]);
            expect(rendered).toMatch(/organization_id/i);
            expect(rendered).not.toMatch(/is null/i);
            expect(rendered).not.toMatch(/or/i);
        });

        it('scopes an org-less non-admin to null-org pipelines only', () => {
            const { sql: rendered } = new PgDialect().sqlToQuery(getOrgConditions(orgContextWithoutOrg)[0]);
            expect(rendered).toMatch(/organization_id/i);
            expect(rendered).toMatch(/is null/i);
        });
    });

    describe('list', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([{ id: 1, name: 'Pipeline 1', stepCount: 2 }]));
        });

        it('returns pipelines for org', async () => {
            const result = await coreService.list(orgContextWithOrg);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ id: 1, name: 'Pipeline 1' });
        });

        it('respects pipelineIds filter', async () => {
            await coreService.list(orgContextWithOrg, { pipelineIds: [1, 2] });
            expect(db.select).toHaveBeenCalled();
        });

        it('respects limit', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([{ id: 1 }]));
            (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({
                ...createMockQuery([{ id: 1 }]),
                limit: vi.fn().mockResolvedValue([{ id: 1 }]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([{ id: 1 }]).then(fn),
            }));
            const result = await coreService.list(orgContextWithOrg, { limit: 5 });
            expect(result).toBeDefined();
        });
    });

    describe('getById', () => {
        it('throws NotFoundError when pipeline not found', async () => {
            const emptyChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([]).then(fn),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(emptyChain);

            await expect(coreService.getById(999, orgContextWithOrg)).rejects.toThrow('Pipeline not found');
        });

        it('returns pipeline with steps when found', async () => {
            const pipeline = { id: 1, name: 'Test', organizationId: 1 };
            const steps = [{ id: 1, pipelineId: 1, jobId: 1, order: 0 }];
            (db.select as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnThis(),
                    where: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockResolvedValue([pipeline]),
                    then: (fn: (v: unknown) => unknown) => Promise.resolve([pipeline]).then(fn),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnThis(),
                    where: vi.fn().mockReturnThis(),
                    orderBy: vi.fn().mockResolvedValue(steps),
                    then: (fn: (v: unknown) => unknown) => Promise.resolve(steps).then(fn),
                });

            const result = await coreService.getById(1, orgContextWithOrg);

            expect(result).toMatchObject({ ...pipeline, steps });
        });
    });

    describe('listSteps', () => {
        it('returns steps for pipeline', async () => {
            const steps = [{ id: 1, pipelineId: 1, jobId: 10, order: 0 }];
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(steps));

            const result = await coreService.listSteps(1);

            expect(result).toEqual(steps);
        });
    });

    describe('getStepById', () => {
        it('throws NotFoundError when step not found', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([]));

            await expect(coreService.getStepById(999)).rejects.toThrow('Pipeline step not found');
        });

        it('returns step when found', async () => {
            const step = { id: 1, pipelineId: 1, jobId: 10, order: 0 };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([step]));

            const result = await coreService.getStepById(1);

            expect(result).toEqual(step);
        });
    });

    describe('getSystem', () => {
        it('returns pipeline by id without org check', async () => {
            const pipeline = { id: 1, name: 'System Pipeline' };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([pipeline]));

            const result = await coreService.getSystem(1);

            expect(result).toEqual(pipeline);
        });
    });

    describe('getJobPipelineUsage', () => {
        it('returns pipelines using job', async () => {
            const usage = [{ id: 1, name: 'Pipeline A', isActive: true }];
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(usage));

            const result = await coreService.getJobPipelineUsage(10);

            expect(result).toEqual(usage);
        });
    });

    describe('getBulkJobPipelineUsage', () => {
        it('returns empty array when jobIds empty', async () => {
            const result = await coreService.getBulkJobPipelineUsage([]);
            expect(result).toEqual([]);
        });

        it('returns pipeline usage for multiple jobs', async () => {
            const usage = [{ pipelineId: 1, pipelineName: 'P1', jobId: 10 }, { pipelineId: 2, pipelineName: 'P2', jobId: 11 }];
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(usage));

            const result = await coreService.getBulkJobPipelineUsage([10, 11]);

            expect(result).toEqual(usage);
        });
    });

    describe('findPipelinesUsingTopic', () => {
        it('returns pipelines using topic', async () => {
            const found = [{ id: 1, name: 'Pipeline with topic' }];
            (db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery(found));

            const result = await coreService.findPipelinesUsingTopic(5, orgContextWithOrg);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ id: 1, name: 'Pipeline with topic' });
        });
    });

    describe('getEnrichedById', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('throws NotFoundError when pipeline not found', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createMockQuery([]));

            await expect(coreService.getEnrichedById(999, orgContextWithOrg)).rejects.toThrow('Pipeline not found');
        });

        it('returns pipeline with steps and job info when found', async () => {
            const pipeline = { id: 1, name: 'Enriched', organizationId: 1 };
            const steps = [{ id: 1, jobId: 10, jobName: 'Job A', jobTool: 'shell' }];
            (db.select as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(createMockQuery([pipeline]))
                .mockReturnValueOnce(createMockQuery(steps));

            const result = await coreService.getEnrichedById(1, orgContextWithOrg);

            expect(result).toMatchObject({ ...pipeline, steps });
        });
    });
});
