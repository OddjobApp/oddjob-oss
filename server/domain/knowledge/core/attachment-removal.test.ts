import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const calls = vi.hoisted(() => ({ where: vi.fn(), result: [{ id: 7 }] as Array<{ id: number }> }));
vi.mock('@server/database_service.js', () => ({ db: { delete: () => ({ where: (condition: unknown) => {
  calls.where(condition); return { returning: async () => calls.result };
} }) } }));
import { attachmentService } from './attachment.service';

describe('Room attachment removal', () => {
  it('scopes removal to the organization, room and attachment', async () => {
    calls.result = [{ id: 7 }];
    expect(await attachmentService.removeFromSession(342, 19, 7)).toBe(true);
    const query = new PgDialect().sqlToQuery(calls.where.mock.calls.at(-1)![0]);
    expect(query.params).toEqual([342, 19, 7]);
    expect(query.sql).toContain('org_id');
    expect(query.sql).toContain('session_id');
  });
  it('reports a missing scoped link without deleting the stored blob', async () => {
    calls.result = [];
    expect(await attachmentService.removeFromSession(342, 20, 7)).toBe(false);
  });
});
