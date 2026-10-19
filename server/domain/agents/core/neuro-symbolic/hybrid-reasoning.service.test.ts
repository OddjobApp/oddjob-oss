// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { HybridReasoningService } from './hybrid-reasoning.service.js';
import type { NeuroSymbolicQuery, LogicTranslation } from './types.js';
const query: NeuroSymbolicQuery = { id: 'test', naturalLanguage: 'find q', domain: 'general', requiresVerification: false, maxDepth: 10, timeoutMs: 1000, includeProof: true };
const translation = (logicForm: string): LogicTranslation => ({ originalText: '', logicForm, logicLanguage: 'datalog', entities: [], relations: [], confidence: 1, alternatives: [] });
describe('Hybrid reasoning guarantees', () => {
  it.each([true, false])('rejects required verification before any LLM call, even when enabled=%s', async enableVerification => {
    const llm = { generate: vi.fn(), generateStructured: vi.fn() };
    const service = new HybridReasoningService(llm, { enableVerification });
    await expect(service.query({ ...query, requiresVerification: true })).rejects.toMatchObject({ type: 'verification_failed' });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });
  it('cannot satisfy a verified query from an unverified cache entry', async () => {
    const llm = { generate: vi.fn().mockResolvedValue('a'), generateStructured: vi.fn().mockResolvedValue(translation('q(a).\n?- q(X).')) };
    const service = new HybridReasoningService(llm);
    await service.query(query);
    await expect(service.query({ ...query, requiresVerification: true })).rejects.toMatchObject({ type: 'verification_failed' });
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  });
  it('preserves domain rules when loading translated facts', async () => {
    const llm = { generate: vi.fn().mockResolvedValue('a'), generateStructured: vi.fn().mockResolvedValue(translation('p(a).\n?- q(X).')) };
    const service = new HybridReasoningService(llm, { enableCache: false });
    const { DatalogEngine } = await import('./datalog-engine.js');
    service.loadDomainRuleset({ domain: 'general', rules: new DatalogEngine().parseDatalog('q(X) :- p(X).').rules, version: '1' } as any);
    expect((await service.query(query)).formalAnswer[0].predicate).toBe('q');
  });
  it('keeps concurrent translations in independent engines', async () => {
    const llm = { generate: vi.fn().mockResolvedValue('answer'), generateStructured: vi.fn()
      .mockResolvedValueOnce(translation('q(a).\n?- q(X).')).mockResolvedValueOnce(translation('q(b).\n?- q(X).')) };
    const service = new HybridReasoningService(llm, { enableCache: false });
    const [a,b] = await Promise.all([service.query(query), service.query({ ...query, id: 'b' })]);
    expect(a.formalAnswer[0].arguments).toEqual([{ type: 'constant', value: 'a' }]);
    expect(b.formalAnswer[0].arguments).toEqual([{ type: 'constant', value: 'b' }]);
  });
});
