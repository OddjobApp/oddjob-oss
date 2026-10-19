import { describe, it, expect } from 'vitest';
import {
  buildRuleSpecification,
  buildThenAction,
  toDnf,
  toEngineCondition,
  slugifyRuleId,
  RuleConversionError,
  MAX_DNF_CLAUSES,
  type EngineCondition,
} from './rule-tree-to-spec';
import type { ConditionGroup, ConditionRule } from './RuleBuilder';

let seq = 0;
function cond(field: string, over: Partial<ConditionRule> = {}): ConditionRule {
  return {
    id: `c${seq++}`,
    type: 'condition',
    field,
    operator: '==',
    value: field,
    ...over,
  };
}

function group(logic: 'AND' | 'OR', children: ConditionGroup['children']): ConditionGroup {
  return { id: `g${seq++}`, type: 'group', logic, children };
}

/** Reduces a DNF result to comparable field names for readable assertions. */
function shape(clauses: EngineCondition[][]): string[][] {
  return clauses.map((c) => c.map((x) => String(x.field ?? x.type)).sort());
}

// ===========================================================================
// DNF CORRECTNESS — the part that must not be subtly wrong
// ===========================================================================

describe('DNF conversion', () => {
  it('keeps a flat AND group as one clause', () => {
    const tree = group('AND', [cond('a'), cond('b'), cond('c')]);
    expect(shape(toDnf(tree))).toEqual([['a', 'b', 'c']]);
  });

  it('splits a flat OR group into one clause per alternative', () => {
    const tree = group('OR', [cond('a'), cond('b')]);
    expect(shape(toDnf(tree))).toEqual([['a'], ['b']]);
  });

  it('distributes AND over a nested OR — the case flattening would corrupt', () => {
    // A AND (B OR C)  ->  (A AND B) OR (A AND C)
    const tree = group('AND', [cond('a'), group('OR', [cond('b'), cond('c')])]);
    expect(shape(toDnf(tree))).toEqual([
      ['a', 'b'],
      ['a', 'c'],
    ]);
  });

  it('distributes across two nested ORs (full cartesian product)', () => {
    // (A OR B) AND (C OR D) -> AC, AD, BC, BD
    const tree = group('AND', [
      group('OR', [cond('a'), cond('b')]),
      group('OR', [cond('c'), cond('d')]),
    ]);
    const result = shape(toDnf(tree));
    expect(result).toHaveLength(4);
    expect(result).toEqual(
      expect.arrayContaining([
        ['a', 'c'],
        ['a', 'd'],
        ['b', 'c'],
        ['b', 'd'],
      ])
    );
  });

  it('handles an OR of ANDs without multiplying', () => {
    // (A AND B) OR (C AND D)
    const tree = group('OR', [
      group('AND', [cond('a'), cond('b')]),
      group('AND', [cond('c'), cond('d')]),
    ]);
    expect(shape(toDnf(tree))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles three levels of nesting', () => {
    // A AND (B OR (C AND D))  ->  (A,B) OR (A,C,D)
    const tree = group('AND', [
      cond('a'),
      group('OR', [cond('b'), group('AND', [cond('c'), cond('d')])]),
    ]);
    expect(shape(toDnf(tree))).toEqual([
      ['a', 'b'],
      ['a', 'c', 'd'],
    ]);
  });

  it('mirrors the screenshot rule: AND[x, OR[y, AND[z, w]]]', () => {
    const tree = group('AND', [
      cond('confidenceScore'),
      group('OR', [
        cond('targetSector'),
        group('AND', [cond('severity'), cond('h3Resolution'), cond('timestamp')]),
      ]),
    ]);
    const result = shape(toDnf(tree));
    expect(result).toEqual([
      ['confidenceScore', 'targetSector'],
      ['confidenceScore', 'h3Resolution', 'severity', 'timestamp'],
    ]);
  });

  it('returns nothing for an empty tree', () => {
    expect(toDnf(group('AND', []))).toEqual([]);
  });

  it('refuses to expand a combinatorial explosion instead of hanging', () => {
    // 9 nested OR pairs = 2^9 = 512 clauses, past the budget.
    const tree = group(
      'AND',
      Array.from({ length: 9 }, (_, i) => group('OR', [cond(`a${i}`), cond(`b${i}`)]))
    );
    expect(() => toDnf(tree)).toThrow(RuleConversionError);
    expect(() => toDnf(tree)).toThrow(new RegExp(String(MAX_DNF_CLAUSES)));
  });
});

// ===========================================================================
// CONDITION MAPPING
// ===========================================================================

describe('condition mapping', () => {
  it('passes a spatial condition through and gives it a stable id', () => {
    const rule = cond('spatial', {
      id: 'node-7',
      config: {
        spatialCondition: {
          type: 'spatial',
          mode: 'topological',
          predicate: 'there',
          geometry: { h3Cells: ['8729a5604ffffff'] },
        },
      } as any,
    });

    const out = toEngineCondition(rule)!;
    expect(out.type).toBe('spatial');
    expect(out.mode).toBe('topological');
    // The iteration gate keys on this; a fresh id each save would reset counters.
    expect(out.conditionId).toBe('node-7');
  });

  it('maps a semantic judge to a fuzzy AI condition', () => {
    const out = toEngineCondition(
      cond('x', {
        evaluatorType: 'semantic_judge',
        config: { thesisPrompt: 'Is this a disruption?', minConfidence: 0.7 } as any,
      })
    )!;
    expect(out.type).toBe('fuzzy_ai_eval');
    expect(out.promptDirective).toBe('Is this a disruption?');
    expect(out.fuzzyThreshold).toBe(0.7);
  });

  it('maps freshness decay to a temporal max-age in MINUTES', () => {
    const out = toEngineCondition(
      cond('x', { evaluatorType: 'freshness_decay', config: { maxAgeHours: 6 } as any })
    )!;
    expect(out.type).toBe('temporal_velocity');
    expect(out.temporalOperator).toBe('MAX_SIGNAL_AGE');
    // The config is in hours, the engine expects minutes.
    expect(out.maxAgeMinutes).toBe(360);
  });

  it('drops an anomaly scorer with no geometry rather than saving a dead condition', () => {
    expect(
      toEngineCondition(cond('x', { evaluatorType: 'anomaly_scorer', config: {} as any }))
    ).toBeNull();

    const withGeo = toEngineCondition(
      cond('x', {
        evaluatorType: 'anomaly_scorer',
        config: { selectedHexes: ['8729a5604ffffff'], zScoreCutoff: 3 } as any,
      })
    )!;
    expect(withGeo.type).toBe('spatial');
    expect(withGeo.value).toBe(3);
  });

  it('preserves the display operator for crisp conditions', () => {
    // The engine normalises ">=", so rewriting it here would be redundant work
    // and a second place to drift.
    const out = toEngineCondition(cond('confidenceScore', { operator: '>=', value: '0.8' }))!;
    expect(out).toMatchObject({ type: 'crisp', field: 'confidenceScore', operator: '>=' });
  });

  it('warns about, and skips, a node with no predicate', () => {
    const warnings: string[] = [];
    const tree = group('AND', [cond('a'), cond('', { label: 'Unconfigured' })]);
    const clauses = toDnf(tree, warnings);
    expect(shape(clauses)).toEqual([['a']]);
    expect(warnings[0]).toMatch(/Unconfigured/);
  });
});

// ===========================================================================
// ACTIONS
// ===========================================================================

describe('then-action derivation', () => {
  it('falls back to the delivery-mode selector when no action node exists', () => {
    expect(buildThenAction(group('AND', [cond('a')]), 'replan')).toEqual({
      deliveryMode: 'replan',
    });
  });

  it('binds a webhook action node', () => {
    const tree = group('AND', [
      cond('a'),
      cond('w', { evaluatorType: 'webhook', config: { endpointUrl: 'https://x.test/h' } as any }),
    ]);
    expect(buildThenAction(tree, 'context_only')).toMatchObject({
      deliveryMode: 'notify',
      receiverBinding: { targetType: 'webhook', targetId: 'https://x.test/h' },
    });
  });

  it('finds an action nested inside a group', () => {
    const tree = group('AND', [
      cond('a'),
      group('OR', [cond('c', { evaluatorType: 'response_cycle', config: { targetCycleId: 'cyc_1' } as any })]),
    ]);
    expect(buildThenAction(tree, 'context_only')).toMatchObject({
      deliveryMode: 'trigger',
      receiverBinding: { targetType: 'cycle', targetId: 'cyc_1' },
    });
  });

  it('excludes action nodes from the evaluated conditions', () => {
    const tree = group('AND', [
      cond('a'),
      cond('w', { evaluatorType: 'webhook', config: { endpointUrl: 'https://x.test' } as any }),
    ]);
    // The webhook is an effect, not a predicate — including it would make the
    // rule require its own action to be true.
    expect(shape(toDnf(tree))).toEqual([['a']]);
  });
});

// ===========================================================================
// FULL SPECIFICATION
// ===========================================================================

describe('specification assembly', () => {
  const opts = { ruleId: 'r1', ruleName: 'Rule One', deliveryMode: 'notify', enabled: true };

  it('puts the first clause in ifBranch and the rest in elseIfBranches', () => {
    const tree = group('AND', [cond('a'), group('OR', [cond('b'), cond('c')])]);
    const { specification } = buildRuleSpecification(tree, opts);

    expect(specification.ifBranch).toMatchObject({ branchId: 'IF_BRANCH', matchStrategy: 'ALL' });
    expect((specification.elseIfBranches as unknown[]) ?? []).toHaveLength(1);
  });

  it('omits elseIfBranches entirely for a single-clause rule', () => {
    const { specification } = buildRuleSpecification(group('AND', [cond('a')]), opts);
    expect(specification.elseIfBranches).toBeUndefined();
  });

  it('gives every branch the same action', () => {
    const tree = group('OR', [cond('a'), cond('b')]);
    const { specification } = buildRuleSpecification(tree, opts);
    const ifAction = (specification.ifBranch as any).thenAction;
    const elseAction = (specification.elseIfBranches as any[])[0].thenAction;
    expect(elseAction).toEqual(ifAction);
  });

  it('refuses to build a rule with no conditions', () => {
    expect(() => buildRuleSpecification(group('AND', []), opts)).toThrow(RuleConversionError);
    expect(() => buildRuleSpecification(group('AND', []), opts)).toThrow(/no evaluable conditions/i);
  });

  it('slugifies rule names into safe ids', () => {
    expect(slugifyRuleId('Harbour Intrusion & Anomaly!')).toBe('harbour-intrusion-anomaly');
    expect(slugifyRuleId('   ')).toBe('rule');
    // Must satisfy the API's ^[a-zA-Z0-9_-]+$ constraint.
    expect(slugifyRuleId('Ports: LA/Long Beach')).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});
