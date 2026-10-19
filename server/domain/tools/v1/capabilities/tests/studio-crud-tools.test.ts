import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), listProjects: vi.fn() }));
vi.mock('../seedance.js', () => ({ toMediaStudioContext: (c: any) => ({ organizationId: c.organizationId, userId: c.userId, isSuperAdmin: false }) }));
vi.mock('@domain/pipeline/core/form-studio.service.js', () => ({ formStudioService: { get: mocks.get, save: mocks.save } }));
vi.mock('@domain/projects/core/project.service.js', () => ({ projectService: { listProjects: mocks.listProjects } }));
import { STUDIO_CRUD_TOOLS as tools } from '../studio-crud-tools.js';

describe('Studio CRUD boundaries', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('refuses calls without an organization before accessing resources', async () => {
    await expect(tools.form_get.execute({ formId: 1 }, {})).rejects.toThrow();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('uses caller scope, ignoring a supplied tenant and dropping super-admin reach', async () => {
    mocks.get.mockResolvedValue({ id: 1, revision: 3 });
    await tools.form_get.execute({ formId: 1, organizationId: 999 }, { organizationId: 7, userId: 'u', isSuperAdmin: true });
    expect(mocks.get).toHaveBeenCalledWith(1, { organizationId: 7, userId: 'u', isSuperAdmin: false });
  });
  it('does not claim success when the scoped resource is missing', async () => {
    mocks.get.mockResolvedValue(null);
    await expect(tools.form_get.execute({ formId: 1 }, { organizationId: 7 })).rejects.toThrow('not found');
  });
  it('requires a revision and propagates stale-write failures', async () => {
    await expect(tools.form_update.execute({ formId: 1, name: 'New' }, { organizationId: 7 })).rejects.toThrow();
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockRejectedValue(new Error('Revision conflict'));
    await expect(tools.form_update.execute({ formId: 1, revision: 2, name: 'New' }, { organizationId: 7 })).rejects.toThrow('Revision conflict');
  });
  it('passes the authenticated identity to project access checks', async () => {
    mocks.listProjects.mockResolvedValue([]);
    await tools.project_list.execute({}, { organizationId: 7, userId: 'u' });
    expect(mocks.listProjects).toHaveBeenCalledWith({ organizationId: 7, userId: 'u' });
  });
  it('rejects unconfirmed destructive calls before accessing a resource', async () => {
    await expect(tools.form_archive.execute({ formId: 1 }, { organizationId: 7 })).rejects.toThrow();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
