import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ cycles: [] as any[], condition: null as any, patch: null as any, updates: 0 }));
vi.mock('@server/database_service.js', () => ({ db: {
  select: () => ({ from: () => ({ where: (condition: any) => { state.condition = condition; return { limit: async () => state.cycles }; } }) }),
  update: () => ({ set: (patch: any) => { state.patch = patch; state.updates++; return { where: async () => [] }; } }),
} }));
import { saveDevelopmentBinding } from '../crew-development-binding.service';
const room = { id: 5, organizationId: 342, projectId: 8 } as any;
const input = { cycleId: 12, repositoryUrl: 'https://github.com/example/project', branch: 'codex/test', testEnvironment: 'isolated fixture' };
describe('persisted development configuration', () => {
  beforeEach(() => { state.cycles = []; state.condition = null; state.patch = null; state.updates = 0; });
  it('requires a cycle under the same org and Project Space before writing', async () => {
    await expect(saveDevelopmentBinding(room, input, 'host')).rejects.toThrow('unavailable');
    expect(state.updates).toBe(0);
    const query = new PgDialect().sqlToQuery(state.condition);
    expect(query.params).toEqual([12, 342, 8]);
  });
  it('stores configuration and clears stale stage routing without overwriting unrelated room state', async () => {
    state.cycles = [{ id: 12, name: 'Development test' }];
    const result = await saveDevelopmentBinding(room, input, 'host');
    expect(result.developmentBinding).toMatchObject({ repositoryUrl: input.repositoryUrl, configuredBy: 'host' });
    expect(state.patch).toMatchObject({ cycleSlug: null, cycleStageId: null });
    const patchSql = new PgDialect().sqlToQuery(state.patch.cycleContext);
    expect(patchSql.sql).toContain("'stageId'");
    expect(patchSql.sql).toContain('coalesce(');
    expect(JSON.parse(String(patchSql.params[0])).cycleId).toBe(12);
  });
  it('rejects credentials in a target before any database read or write', async () => {
    await expect(saveDevelopmentBinding(room, { ...input, repositoryUrl: 'https://secret@example.com/repo' }, 'host')).rejects.toThrow();
    expect(state.condition).toBeNull();
    expect(state.updates).toBe(0);
  });
});
