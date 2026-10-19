// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ statements: [] as { sql: string; params: unknown[] }[], fail: false }));
vi.mock('@shared/schema/index.js', async () => {
  const { pgTable, integer, text, jsonb } = await import('drizzle-orm/pg-core');
  return {
    knowledgeNodes: pgTable('nodes', { id: integer('id'), organizationId: integer('organization_id'), name: text('name'), label: text('label'), data: jsonb('data') }),
    knowledgeEdges: pgTable('edges', { sourceId: integer('source_id'), targetId: integer('target_id'), organizationId: integer('organization_id') }),
  };
});
vi.mock('@server/database_service.js', () => ({ db: { select: vi.fn((projection?: Record<string, unknown>) => ({ from: () => ({ where: (condition: any) => {
  const compiled = new PgDialect().sqlToQuery(condition);
  state.statements.push(compiled);
  const equality = compiled.sql.match(/"organization_id" = \$(\d+)/);
  const orgId = equality ? Number(compiled.params[Number(equality[1])-1]) : null;
  if (!equality && !compiled.sql.includes('"organization_id" IS NULL')) throw new Error('Unscoped query');
  const result = () => {
    if (state.fail) throw new Error('database unavailable');
    if (projection && ('source' in projection || 'target' in projection)) return [];
    return [{ id: orgId ?? 99, organizationId: orgId, name: orgId === 1 ? 'Alpha secret' : orgId === 2 ? 'Beta secret' : 'Public', label: 'Topic', data: { description: `scope ${orgId}` } }];
  };
  return { then: (resolve: any, reject: any) => Promise.resolve().then(result).then(resolve, reject), limit: () => Promise.resolve().then(result) };
} }) })) } }));
import { HierarchicalRetrievalService } from './hierarchical-retrieval.service.js';
describe('Hierarchical retrieval tenant boundaries', () => {
  beforeEach(() => { state.statements.length = 0; state.fail = false; });
  afterEach(() => vi.useRealTimers());
  it('keeps simultaneous tenant snapshots independent and includes real summary fields', async () => {
    const service = new HierarchicalRetrievalService();
    const [a,b] = await Promise.all([service.retrieveHierarchical('secret',1), service.retrieveHierarchical('secret',2)]);
    expect([...a.communitySummaries.values()].join('')).toContain('Alpha secret');
    expect([...a.communitySummaries.values()].join('')).not.toContain('Beta');
    expect([...b.communitySummaries.values()].join('')).toContain('Beta secret');
    expect([...b.communitySummaries.values()].join('')).not.toContain('Alpha');
    expect([...a.communitySummaries.values()].join('')).toContain('scope 1');
    expect(service.getStats().totalNodes).toBe(2);
  });
  it('scopes both missing and null organizations to public rows', async () => {
    const service = new HierarchicalRetrievalService();
    const result = await service.retrieveHierarchical('Public');
    expect(result.localResults.map(n => n.organizationId)).toEqual([null]);
    await service.retrieveHierarchical('Public',null);
    expect(state.statements.every(s => s.sql.includes('"organization_id" IS NULL'))).toBe(true);
  });
  it('does not reuse tenant A global fallback for tenant B', async () => {
    const service = new HierarchicalRetrievalService();
    await service.retrieveHierarchical('unmatched',1);
    const result = await service.retrieveHierarchical('unmatched',2);
    expect(result.globalSummary).toContain('Beta'); expect(result.globalSummary).not.toContain('Alpha');
  });
  it('expires snapshots and invalidates them explicitly', async () => {
    vi.useFakeTimers();
    const service = new HierarchicalRetrievalService();
    await service.retrieveHierarchical('unmatched',1);
    await service.retrieveHierarchical('unmatched',1);
    expect(state.statements).toHaveLength(2);
    vi.advanceTimersByTime(60_001);
    await service.retrieveHierarchical('unmatched',1);
    expect(state.statements).toHaveLength(4);
    service.clearHierarchy();
    await service.retrieveHierarchical('unmatched',1);
    expect(state.statements).toHaveLength(6);
  });
  it('evicts failed builds so subsequent requests can recover', async () => {
    const service = new HierarchicalRetrievalService();
    state.fail = true;
    await expect(service.retrieveHierarchical('secret',1)).rejects.toThrow('database');
    state.fail = false;
    expect((await service.retrieveHierarchical('secret',1)).localResults).toHaveLength(1);
  });
  it('scopes traversal node and edge reads and respects zero hops', async () => {
    const service = new HierarchicalRetrievalService();
    await service.traverseWithHierarchy(1,1,1);
    expect(state.statements).toHaveLength(2);
    expect(state.statements.every(s => s.sql.includes('"organization_id" ='))).toBe(true);
    state.statements.length = 0;
    await service.traverseWithHierarchy(1,0,1);
    expect(state.statements).toHaveLength(1);
  });
});
