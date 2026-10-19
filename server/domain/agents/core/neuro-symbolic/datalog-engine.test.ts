// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DatalogEngine } from './datalog-engine.js';
function load(source: string) {
  const engine = new DatalogEngine();
  engine.loadProgram({ ...engine.parseDatalog(source), id: 'test', domain: 'general', version: '1', createdAt: new Date(), updatedAt: new Date() });
  return engine;
}
async function answers(source: string, query: string) {
  const engine = load(source);
  return (await engine.query(engine.parseQuery(query))).derivedFacts.map(f => f.arguments);
}
describe('Datalog correctness', () => {
  it('requires every conjunct and propagates bindings', async () => {
    expect(await answers('p(a). q(X) :- p(X), missing(X).', 'q(X)')).toEqual([]);
    expect(await answers('p(a). p(b). link(b,c). q(X,Y) :- p(X), link(X,Y).', 'q(X,Y)')).toEqual([['b','c']]);
  });
  it('retains distinct conclusions and deduplicates identical facts', async () => {
    expect(await answers('p(a). p(b). p(a). q(X) :- p(X).', 'q(X)')).toEqual([['a'],['b']]);
  });
  it('enforces repeated variables within atoms and queries', async () => {
    expect(await answers('pair(a,b). pair(c,c). q(X) :- pair(X,X).', 'q(X)')).toEqual([['c']]);
    expect(await answers('pair(a,b). pair(c,c).', 'pair(X,X)')).toEqual([['c','c']]);
  });
  it('evaluates recursion when only a later atom has new facts', async () => {
    const source = 'edge(a,b). edge(b,c). edge(c,d). path(X,Y) :- edge(X,Y). path(X,Z) :- edge(X,Y), path(Y,Z).';
    expect(await answers(source, 'path(a,Z)')).toEqual([['a','b'],['a','c'],['a','d']]);
  });
  it('waits for lower-stratum recursion before evaluating absence', async () => {
    const source = 'person(a). person(b). seed(a). blocked(X) :- delayed(X). delayed(X) :- seed(X). eligible(X) :- person(X), not blocked(X).';
    expect(await answers(source, 'eligible(X)')).toEqual([['b']]);
  });
  it('handles numeric guards even before binding atoms in source order', async () => {
    expect(await answers('transaction(a,12000). transaction(b,9000). risk(X) :- A > 10000, transaction(X,A).', 'risk(X)')).toEqual([['a']]);
  });
  it('preserves primitive types, strings, comments, decimals and query lines', async () => {
    const source = 'p("a,b. :- %", 12.5, true). % comment\nq(X) :- p(X,12.5,true).\n?- q(X).';
    expect(await answers(source, 'q(X)')).toEqual([['a,b. :- %']]);
  });
  it('supports independent anonymous variables and ground empty-body rules', async () => {
    expect(await answers('pair(a,b). q(ok) :- pair(_,_).', 'q(X)')).toEqual([['ok']]);
    const engine = load('q(ok) :- p(ok).');
    const rule = engine.export().rules[0];
    engine.addRule({ ...rule, id: 'ground', body: [] });
    expect((await engine.query(engine.parseQuery('q(X)'))).derivedFacts.map(f => f.arguments)).toEqual([['ok']]);
  });
  it.each(['q(X) :- not p(X).', 'q(Y) :- p(X).', 'p(X) :- seed(X), not q(X). q(X) :- seed(X), p(X).', 'p(a). p(a,b).'])('rejects unsafe/inconsistent programs: %s', source => {
    expect(() => load(source)).toThrow();
  });
  it.each(['p(123junk).', 'q(X) :- p(X), garbage.', 'q(X) :- p(X), X + 1.', 'p(a)', 'p(f(a)).', 'p("unterminated).'])('rejects malformed syntax instead of dropping it: %s', source => {
    expect(() => load(source)).toThrow();
  });
  it('does not return successful partial closure at the depth limit', async () => {
    const engine = load('p(a). q(X) :- p(X). r(X) :- q(X).');
    await expect(engine.query(engine.parseQuery('r(X)'), { maxDepth: 1 })).rejects.toThrow('fixed point');
  });
  it('records the actual joined facts and substitutions in proofs', async () => {
    const engine = load('p(a). link(a,b). q(Y) :- p(X), link(X,Y).');
    const result = await engine.query(engine.parseQuery('q(Y)'), { includeProof: true });
    expect(result.proofTrace[0].matchedFacts.map(f => f.predicate)).toEqual(['p','link']);
    expect(result.proofTrace[0].substitution.get('Y')).toBe('b');
  });
  it('leaves a valid program intact when an invalid replacement is rejected', async () => {
    const engine = load('p(a).');
    expect(() => engine.loadProgram({ ...engine.export(), ...engine.parseDatalog('q(X) :- not p(X).') })).toThrow();
    expect((await engine.query(engine.parseQuery('p(X)'))).derivedFacts).toHaveLength(1);
  });
});
