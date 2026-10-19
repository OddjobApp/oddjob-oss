import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ rows: [] as unknown[][], conditions: [] as any[] }));
vi.mock('@server/database_service.js', () => ({ db: { select: () => ({ from: () => ({ where: (condition: any) => {
  state.conditions.push(condition); return { limit: async () => state.rows.shift() ?? [] };
} }) }) } }));
import { boundRoomCycleId, resolveAppRoomCycle } from './app-room-cycle-binding.service.js';

describe('room cycle binding', () => {
  beforeEach(() => { state.rows = []; state.conditions = []; });
  it('constrains all database reads by organization and enforces null project scope explicitly', async () => {
    state.rows = [[{ projectId: null }], [{ projectId: null, cycleContext: { cycleId: 12 } }], [{ id: 12 }]];
    expect(await resolveAppRoomCycle(888, 342, 'room')).toEqual({ id: 12 });
    const queries = state.conditions.map(condition => new PgDialect().sqlToQuery(condition));
    expect(queries).toHaveLength(3);
    expect(queries.every(query => query.params.includes(342))).toBe(true);
    expect(queries[1].sql).toContain('"crew_sessions"."project_id" is null');
    expect(queries[2].sql).toContain('"operational_cycles"."project_id" is null');
    expect(queries[2].params).toContain(12);
  });
  it('does not read a cycle after incompatible room scope', async () => {
    state.rows = [[{ projectId: 8 }], [{ projectId: 9, cycleContext: { cycleId: 12 } }]];
    expect(await resolveAppRoomCycle(888, 342, 'room')).toBeNull();
    expect(state.conditions).toHaveLength(2);
  });
  it('does not query without a room binding', async () => {
    expect(await resolveAppRoomCycle(888, 342, undefined)).toBeNull();
    expect(state.conditions).toHaveLength(0);
  });
  it('accepts a positive persisted cycle id only in the exact Project Space', () => {
    expect(boundRoomCycleId({ projectId: 8, cycleContext: { cycleId: 12 } }, 8)).toBe(12);
    expect(boundRoomCycleId({ projectId: 8, cycleContext: { cycleId: 12 } }, 9)).toBeNull();
    expect(boundRoomCycleId({ projectId: 8, cycleContext: { cycleId: 12 } }, null)).toBeNull();
    expect(boundRoomCycleId({ projectId: null, cycleContext: { cycleId: 12 } }, null)).toBe(12);
  });
  it.each([undefined, null, '12', 0, -1, 1.5])('does not invent a cycle for invalid binding %s', cycleId => {
    expect(boundRoomCycleId({ projectId: 8, cycleContext: { cycleId } }, 8)).toBeNull();
  });
});
