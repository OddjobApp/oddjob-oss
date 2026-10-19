/**
 * Knowledge Graph Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMockQuery = (result: unknown[] | unknown = []) => {
    const resolved = Array.isArray(result) ? result : [result];
    return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        and: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        selectDistinct: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(resolved),
        execute: vi.fn().mockResolvedValue(resolved),
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
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        transaction: vi.fn((fn: (tx: any) => Promise<any>) => fn({})),
    },
}));

vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: vi.fn((_name: string, fn: () => unknown) => fn()),
}));

vi.mock('@server/utils/logger.js', () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('@server/knowledge/knowledge-graph-service.js', () => ({
    embedKnowledgeNode: vi.fn().mockResolvedValue(undefined),
    deleteKnowledgeNodeFromQdrant: vi.fn().mockResolvedValue(undefined),
}));

import { db } from '@server/database_service.js';
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";

describe('Knowledge Graph Service', () => {
    const orgContext = { userId: 'u1', organizationId: 1, isAdmin: true, isSuperAdmin: false, isOrgAdmin: true };

    beforeEach(() => {
        vi.clearAllMocks();
        (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery());
        (db.selectDistinct as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery());
        (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery());
        (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery());
        (db.delete as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery());
    });

    describe('searchNodes', () => {
        it('returns nodes with total and pagination', async () => {
            const nodes = [{ id: 1, name: 'Node1', label: 'Person', organizationId: 1 }];
            const countResult = [{ count: 1 }];
            (db.select as ReturnType<typeof vi.fn>)
                .mockImplementationOnce(() => createMockQuery(countResult))
                .mockImplementationOnce(() => createMockQuery(nodes));

            const result = await graphService.searchNodes(orgContext);

            expect(result).toMatchObject({ nodes, total: 1, page: 1, limit: 50 });
        });

        it('filters by query when provided', async () => {
            (db.select as ReturnType<typeof vi.fn>)
                .mockImplementationOnce(() => createMockQuery([{ count: 0 }]))
                .mockImplementationOnce(() => createMockQuery([]));

            await graphService.searchNodes(orgContext, { query: 'test' });
            expect(db.select).toHaveBeenCalled();
        });
    });

    describe('resolveEntitiesToNodeIds', () => {
        it('returns empty array when entityNames is empty', async () => {
            const result = await graphService.resolveEntitiesToNodeIds([], orgContext);
            expect(result).toEqual([]);
            expect(db.select).not.toHaveBeenCalled();
        });

        it('returns node ids for matching entity names', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockImplementation(() =>
                createMockQuery([{ id: 1 }, { id: 2 }])
            );

            const result = await graphService.resolveEntitiesToNodeIds(['Entity1', 'Entity2'], orgContext);
            expect(result).toEqual([1, 2]);
        });
    });

    describe('getNodeById', () => {
        it('throws NotFoundError when node not found', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery([]));

            await expect(graphService.getNodeById(999, orgContext)).rejects.toThrow('Node not found');
        });

        it('returns node when found', async () => {
            const node = { id: 1, name: 'Test', label: 'Job', organizationId: 1 };
            (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => createMockQuery([node]));

            const result = await graphService.getNodeById(1, orgContext);
            expect(result).toMatchObject(node);
        });
    });

    describe('getLabels', () => {
        it('returns distinct labels', async () => {
            (db.selectDistinct as ReturnType<typeof vi.fn>).mockImplementation(() =>
                createMockQuery([{ label: 'Person' }, { label: 'Job' }])
            );

            const result = await graphService.getLabels(orgContext);
            expect(result).toEqual(['Person', 'Job']);
        });
    });

    describe('getRelationshipTypes', () => {
        it('returns distinct relationship types', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                rows: [{ relation: 'DEPENDS_ON' }, { relation: 'OWNS' }],
            });

            const result = await graphService.getRelationshipTypes(orgContext);
            expect(result).toEqual(['DEPENDS_ON', 'OWNS']);
        });
    });

    describe('listStagingNodes', () => {
        it('returns staging nodes with pagination', async () => {
            const nodes = [{ id: 1, verificationStatus: 'staging' }];
            const countResult = [{ count: 1 }];
            (db.select as ReturnType<typeof vi.fn>)
                .mockImplementationOnce(() => createMockQuery(countResult))
                .mockImplementationOnce(() => createMockQuery(nodes));

            const result = await graphService.listStagingNodes(orgContext, {});
            expect(result).toMatchObject({ nodes, total: 1, page: 1, limit: 50 });
        });
    });

    describe('bulkVerifyNodes', () => {
        it('throws BadRequestError when no selection criteria', async () => {
            await expect(
                graphService.bulkVerifyNodes(orgContext, { action: 'approve' })
            ).rejects.toThrow('Must provide selection criteria');
        });
    });
});
