import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), existing: null as any }));
vi.mock('@domain/projects/core/finance-roles.service.js', () => ({ financeRolesService: { ensureSystemExecutive: mocks.ensure } }));
vi.mock('@server/database_service.js', () => ({ db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.existing ? [mocks.existing] : [] }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 8, userId: 'super-1', role: 'super_admin', organizationId: null }] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 8, userId: 'super-1', role: 'super_admin', organizationId: null }] }) }) }),
} }));
import { AdminService } from './admin.service.js';

describe('super-admin assignment', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.existing = null; mocks.ensure.mockResolvedValue({ organizationId: 342, projectId: 91 }); });

    it('grants Executive access in the Oddjob System project', async () => {
        const assigned = await new AdminService().assignAdminRole('super-1', 'super_admin', null);
        expect(assigned.role).toBe('super_admin');
        expect(mocks.ensure).toHaveBeenCalledWith('super-1', 'super-1');
    });

    it('does not grant system finance access to an org admin', async () => {
        await new AdminService().assignAdminRole('admin-1', 'org_admin', 12);
        expect(mocks.ensure).not.toHaveBeenCalled();
    });
});
