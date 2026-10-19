import { randomUUID } from 'crypto';
import { type SymbolicFact, type LogicRule, type LogicAtom, type LogicTerm, type InferenceResult, type ProofStep, type DatalogProgram, NeuroSymbolicError, NeuroSymbolicErrorType } from './types.js';
import { parseProgram, parseQuery } from './datalog-parser.js';

type Value = SymbolicFact['arguments'][number];
type Bindings = Map<string, Value>;
type Relations = Map<string, SymbolicFact[]>;
const comparisons = new Set(['=', '!=', '<', '<=', '>', '>=']);
const factKey = (fact: SymbolicFact) => JSON.stringify([fact.predicate, fact.arguments, fact.negated]);
function invalid(message: string): never { throw new NeuroSymbolicError(NeuroSymbolicErrorType.INFERENCE_FAILED, message); }

/** Function-free Datalog with synchronous delta rounds and stratified negation. */
export class DatalogEngine {
  private facts: Relations = new Map();
  private rules: LogicRule[] = [];

  loadProgram(program: DatalogProgram): void {
    this.validate(program.facts, program.rules);
    this.facts = new Map();
    this.rules = [...program.rules];
    for (const fact of program.facts) this.insert(this.facts, fact);
  }
  addFact(fact: SymbolicFact): void {
    this.validate([...this.facts.values()].flat().concat(fact), this.rules);
    this.insert(this.facts, fact);
  }
  addRule(rule: LogicRule): void {
    this.validate([...this.facts.values()].flat(), [...this.rules, rule]);
    this.rules.push(rule);
  }
  private insert(relations: Relations, fact: SymbolicFact): void {
    const existing = relations.get(fact.predicate) ?? [];
    if (!existing.some(other => factKey(other) === factKey(fact))) existing.push(fact);
    relations.set(fact.predicate, existing);
  }
  private validate(facts: SymbolicFact[], rules: LogicRule[]): Map<string, number> {
    const arities = new Map<string, number>();
    const register = (predicate: string, arity: number) => {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(predicate)) invalid(`Invalid predicate: ${predicate}`);
      if (arities.has(predicate) && arities.get(predicate) !== arity) invalid(`Inconsistent arity: ${predicate}`);
      arities.set(predicate, arity);
    };
    for (const fact of facts) {
      register(fact.predicate, fact.arguments.length);
      if (fact.negated) invalid('Explicit negative facts are unsupported; use stratified rule negation');
      if (fact.arguments.some(v => !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v)))) invalid('Facts require finite primitive values');
    }
    for (const rule of rules) {
      if (rule.head.negated || comparisons.has(rule.head.predicate)) invalid('Rule heads must be positive predicates');
      const bound = new Set<string>();
      for (const atom of [rule.head, ...rule.body]) {
        if (comparisons.has(atom.predicate)) {
          if (atom.arguments.length !== 2 || atom.negated) invalid('Comparisons require two terms and cannot be negated');
        } else register(atom.predicate, atom.arguments.length);
        for (const term of atom.arguments) {
          if (term.type === 'function') invalid('Function terms are unsupported');
          if (term.type === 'constant' && typeof term.value === 'number' && !Number.isFinite(term.value)) invalid('Non-finite constant');
        }
      }
      for (const atom of rule.body.filter(a => !a.negated && !comparisons.has(a.predicate))) {
        for (const term of atom.arguments) if (term.type === 'variable') bound.add(term.name);
      }
      for (const atom of [rule.head, ...rule.body.filter(a => a.negated || comparisons.has(a.predicate))]) {
        for (const term of atom.arguments) if (term.type === 'variable' && !bound.has(term.name)) invalid(`Unsafe variable ${term.name} in rule ${rule.name}`);
      }
    }
    const strata = new Map([...arities.keys()].map(p => [p, 0]));
    // Relax signed dependencies; changes after |predicates| rounds imply a negative cycle.
    for (let round = 0; round <= arities.size; round++) {
      let changed = false;
      for (const rule of rules) for (const atom of rule.body) {
        if (comparisons.has(atom.predicate)) continue;
        const required = strata.get(atom.predicate)! + (atom.negated ? 1 : 0);
        if (required > strata.get(rule.head.predicate)!) { strata.set(rule.head.predicate, required); changed = true; }
      }
      if (!changed) return strata;
    }
    return invalid('Recursion through negation is not stratifiable');
  }
  private unify(atom: LogicAtom, fact: SymbolicFact, initial: Bindings = new Map()): Bindings | null {
    if (atom.predicate !== fact.predicate || fact.negated || atom.arguments.length !== fact.arguments.length) return null;
    const bindings = new Map(initial);
    for (let i = 0; i < atom.arguments.length; i++) {
      const term = atom.arguments[i], value = fact.arguments[i];
      if (term.type === 'function') return invalid('Function terms are unsupported');
      if (term.type === 'constant') { if (term.value !== value) return null; }
      else {
        if (bindings.has(term.name) && bindings.get(term.name) !== value) return null;
        bindings.set(term.name, value);
      }
    }
    return bindings;
  }
  private value(term: LogicTerm, bindings: Bindings): Value {
    if (term.type === 'constant') return term.value;
    if (term.type === 'variable' && bindings.has(term.name)) return bindings.get(term.name)!;
    return invalid('Unbound or unsupported term');
  }
  private compare(atom: LogicAtom, bindings: Bindings): boolean {
    const left = this.value(atom.arguments[0], bindings), right = this.value(atom.arguments[1], bindings);
    if (atom.predicate === '=') return left === right;
    if (atom.predicate === '!=') return left !== right;
    if (typeof left !== 'number' || typeof right !== 'number') return invalid('Ordered comparisons require numbers');
    switch (atom.predicate) {
      case '<': return left < right;
      case '<=': return left <= right;
      case '>': return left > right;
      case '>=': return left >= right;
      default: return false;
    }
  }
  private evaluate(rule: LogicRule, all: Relations, delta: Relations, check: () => void): Array<{ fact: SymbolicFact; matched: SymbolicFact[]; bindings: Bindings }> {
    const positive = rule.body.filter(a => !a.negated && !comparisons.has(a.predicate));
    const filters = rule.body.filter(a => a.negated || comparisons.has(a.predicate));
    const results: Array<{ fact: SymbolicFact; matched: SymbolicFact[]; bindings: Bindings }> = [];
    // Every positive body position can supply a delta, not only position zero.
    for (let pivot = 0; pivot < Math.max(1, positive.length); pivot++) {
      let rows: Array<{ bindings: Bindings; matched: SymbolicFact[] }> = [{ bindings: new Map(), matched: [] }];
      for (let i = 0; i < positive.length; i++) {
        const atom = positive[i], candidates = (i === pivot ? delta : all).get(atom.predicate) ?? [];
        const joined = atom.arguments.flatMap((term, position) => term.type === 'variable' && rows[0]?.bindings.has(term.name) ? [{ name: term.name, position }] : []);
        const index = new Map<string, SymbolicFact[]>();
        for (const fact of candidates) {
          check();
          const key = JSON.stringify(joined.map(j => fact.arguments[j.position]));
          const bucket = index.get(key) ?? []; bucket.push(fact); index.set(key, bucket);
        }
        const next: typeof rows = [];
        for (const row of rows) {
          check();
          const key = JSON.stringify(joined.map(j => row.bindings.get(j.name)));
          for (const fact of index.get(key) ?? []) {
            check();
            const bindings = this.unify(atom, fact, row.bindings);
            if (bindings) next.push({ bindings, matched: [...row.matched, fact] });
          }
        }
        rows = next;
        if (!rows.length) break;
      }
      for (const row of rows) {
        check();
        if (!filters.every(atom => comparisons.has(atom.predicate) ? this.compare(atom, row.bindings) : !(all.get(atom.predicate) ?? []).some(fact => { check(); return this.unify(atom, fact, row.bindings) !== null; }))) continue;
        results.push({ fact: {
          id: randomUUID(), predicate: rule.head.predicate, arguments: rule.head.arguments.map(term => this.value(term, row.bindings)),
          negated: false, source: 'inferred', confidence: Math.min(1, ...row.matched.map(f => f.confidence)) * 0.95,
          timestamp: new Date(), metadata: { ruleId: rule.id, sourceFactIds: row.matched.map(f => f.id) },
        }, ...row });
      }
    }
    return results;
  }
  async query(query: LogicAtom, options: { maxDepth?: number; timeoutMs?: number; includeProof?: boolean } = {}): Promise<InferenceResult> {
    const start = Date.now(), maxDepth = options.maxDepth ?? 10, timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) invalid('Invalid inference limits');
    if (query.negated || comparisons.has(query.predicate) || query.arguments.some(t => t.type === 'function')) invalid('Query must be a positive relational atom');
    const check = () => { if (Date.now() - start >= timeoutMs) throw new NeuroSymbolicError(NeuroSymbolicErrorType.TIMEOUT, `Query exceeded ${timeoutMs}ms timeout`); };
    const strata = this.validate([...this.facts.values()].flat(), this.rules);
    const all: Relations = new Map([...this.facts].map(([p, fs]) => [p, [...fs]]));
    const seen = new Set([...all.values()].flat().map(factKey)), proofTrace: ProofStep[] = [];
    let iterations = 0;
    for (const level of [...new Set(this.rules.map(r => strata.get(r.head.predicate)!))].sort((a, b) => a - b)) {
      const rules = this.rules.filter(r => strata.get(r.head.predicate) === level);
      let delta = new Map(all), converged = false;
      for (let round = 0; round < maxDepth; round++) {
        check(); iterations++;
        const next: Relations = new Map();
        for (const rule of rules) for (const result of this.evaluate(rule, all, delta, check)) {
          const key = factKey(result.fact);
          if (seen.has(key)) continue;
          seen.add(key);
          const bucket = next.get(result.fact.predicate) ?? []; bucket.push(result.fact); next.set(result.fact.predicate, bucket);
          if (options.includeProof) proofTrace.push({ step: proofTrace.length + 1, rule, matchedFacts: result.matched, result: result.fact, substitution: new Map(result.bindings) });
        }
        if (!next.size) { converged = true; break; }
        for (const [predicate, facts] of next) all.set(predicate, [...(all.get(predicate) ?? []), ...facts]);
        delta = next;
      }
      if (!converged) invalid(`Inference did not reach a fixed point within ${maxDepth} rounds; refusing a partial result`);
    }
    const derivedFacts: SymbolicFact[] = [], bindings: Bindings[] = [];
    for (const fact of all.get(query.predicate) ?? []) {
      check(); const match = this.unify(query, fact);
      if (match) { derivedFacts.push(fact); if (match.size) bindings.push(match); }
    }
    return { success: true, derivedFacts, bindings, proofTrace, iterations, inferenceTimeMs: Date.now() - start };
  }
  parseDatalog(text: string): { facts: SymbolicFact[]; rules: LogicRule[] } { return parseProgram(text); }
  parseQuery(text: string): LogicAtom { return parseQuery(text); }
  getStats(): { predicates: number; totalFacts: number; rules: number } { return { predicates: this.facts.size, totalFacts: [...this.facts.values()].flat().length, rules: this.rules.length }; }
  clear(): void { this.facts.clear(); this.rules = []; }
  export(): DatalogProgram { return { id: randomUUID(), facts: [...this.facts.values()].flat(), rules: [...this.rules], domain: 'general', version: '1.0', createdAt: new Date(), updatedAt: new Date() }; }
}
