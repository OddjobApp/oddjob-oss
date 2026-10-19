import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ inserted: [] as any[], ensureDefaultProject: vi.fn() }));
vi.mock('@server/database_service.js', () => ({ db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 342 }] }) }) }),
    transaction: async (run: (tx: any) => Promise<void>) => run({ insert: () => ({ values: (value: any) => { mocks.inserted.push(value); return { onConflictDoNothing: async () => undefined }; } }) }),
} }));
vi.mock('./project.service.js', () => ({ projectService: { ensureDefaultProject: mocks.ensureDefaultProject }, ProjectCtx: {} }));
import { financeRolesService } from './finance-roles.service.js';

describe('Oddjob System super-admin finance access', () => {
    beforeEach(() => { mocks.inserted.length = 0; mocks.ensureDefaultProject.mockReset().mockResolvedValue({ id: 91, organizationId: 342, key: 'oddjob-system', name: 'Oddjob System' }); });

    it('idempotently adds project ownership and the Executive finance role', async () => {
        await expect(financeRolesService.ensureSystemExecutive('super-1', 'admin-1')).resolves.toEqual({ organizationId: 342, projectId: 91 });
        expect(mocks.ensureDefaultProject).toHaveBeenCalledWith({ organizationId: 342, userId: 'super-1', isSuperAdmin: true });
        expect(mocks.inserted).toEqual(expect.arrayContaining([
            expect.objectContaining({ projectId: 91, principalType: 'user', principalId: 'super-1', role: 'owner' }),
            expect.objectContaining({ projectId: 91, organizationId: 342, userId: 'super-1', role: 'executive' }),
        ]));
    });
});
