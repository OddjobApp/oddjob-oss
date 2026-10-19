/**
 * Admin Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

function createMockQuery(result: unknown[] = []) {
    const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
        then: (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn),
    };
    return chain;
}

vi.mock("@server/database_service.js", () => {
    const createChain = (result: unknown[] = []) => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
        then: (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn),
    });
    return {
        db: {
            select: vi.fn(() => createChain()),
            update: vi.fn(() => createChain()),
            insert: vi.fn(() => createChain()),
        },
    };
});

import { db } from '@server/database_service.js';
import { adminService } from '@server/domain/admin/admin.service';

describe('Admin Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const createChain = (result: unknown[] = []) => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            values: vi.fn().mockReturnThis(),
            returning: vi.fn().mockResolvedValue(result),
            then: (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn),
        });
        (db.select as ReturnType<typeof vi.fn>).mockReturnValue(createChain());
        (db.update as ReturnType<typeof vi.fn>).mockReturnValue(createChain());
        (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(createChain());
    });

    describe('getOrgSettings', () => {
        it('throws when orgId is falsy', async () => {
            await expect(adminService.getOrgSettings(0)).rejects.toThrow('Organization ID required');
            await expect(adminService.getOrgSettings(null as any)).rejects.toThrow('Organization ID required');
        });

        it('returns default settings when no settings exist', async () => {
            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([]).then(fn),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

            const result = await adminService.getOrgSettings(1);

            expect(result).toMatchObject({
                organizationId: 1,
                knowledgeStoreEnabled: true,
                knowledgeGraphEnabled: true,
                psychologistEnabled: true,
                skillImportEnabled: true,
            });
        });

        it('returns existing settings when found', async () => {
            const existing = {
                organizationId: 1,
                knowledgeStoreEnabled: false,
                knowledgeGraphEnabled: true,
                psychologistEnabled: false,
                skillImportEnabled: true,
            };
            const chain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([existing]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([existing]).then(fn),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

            const result = await adminService.getOrgSettings(1);

            expect(result).toMatchObject(existing);
        });
    });

    describe('updateOrgSettings', () => {
        it('throws when orgId is falsy', async () => {
            await expect(adminService.updateOrgSettings(0, {})).rejects.toThrow('Organization ID required');
        });

        it('updates existing settings', async () => {
            const updated = { organizationId: 1, knowledgeStoreEnabled: false, updatedAt: new Date() };
            const selectChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ organizationId: 1 }]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([{ organizationId: 1 }]).then(fn),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectChain);
            const updateChain = {
                set: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                returning: vi.fn().mockResolvedValue([updated]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([updated]).then(fn),
            };
            (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);

            const result = await adminService.updateOrgSettings(1, { knowledgeStoreEnabled: false });

            expect(result).toMatchObject(updated);
        });

        it('inserts when no existing settings', async () => {
            const created = { organizationId: 1, knowledgeStoreEnabled: true };
            const selectChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([]).then(fn),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectChain);
            const insertChain = {
                values: vi.fn().mockReturnThis(),
                returning: vi.fn().mockResolvedValue([created]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([created]).then(fn),
            };
            (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertChain);

            const result = await adminService.updateOrgSettings(1, { knowledgeStoreEnabled: true });

            expect(result).toMatchObject(created);
        });
    });

    describe('assignAdminRole', () => {
        it('throws when userId or role missing', async () => {
            await expect(adminService.assignAdminRole('', 'org_admin', 1)).rejects.toThrow('userId and role required');
            await expect(adminService.assignAdminRole('u1', '', 1)).rejects.toThrow('userId and role required');
        });

        it('throws when org_admin without organizationId', async () => {
            await expect(adminService.assignAdminRole('u1', 'org_admin', null)).rejects.toThrow('organizationId required for org_admin');
        });

        it('updates existing role', async () => {
            const updated = { userId: 'u1', role: 'org_admin', organizationId: 1 };
            const selectChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ userId: 'u1' }]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([{ userId: 'u1' }]).then(fn),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectChain);
            const updateChain = {
                set: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                returning: vi.fn().mockResolvedValue([updated]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([updated]).then(fn),
            };
            (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);

            const result = await adminService.assignAdminRole('u1', 'org_admin', 1);

            expect(result).toMatchObject(updated);
        });

        it('inserts new role when none exists', async () => {
            const created = { userId: 'u1', role: 'org_admin', organizationId: 1 };
            const selectChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([]).then(fn),
            };
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectChain);
            const insertChain = {
                values: vi.fn().mockReturnThis(),
                returning: vi.fn().mockResolvedValue([created]),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([created]).then(fn),
            };
            (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertChain);

            const result = await adminService.assignAdminRole('u1', 'org_admin', 1);

            expect(result).toMatchObject(created);
        });
    });
});
