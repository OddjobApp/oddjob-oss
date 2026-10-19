/**
 * Rule Builder tree → GRIE rule specification.
 *
 * THE SHAPE MISMATCH: the builder lets an operator nest AND/OR groups to any
 * depth. A rule engine BRANCH is flat — a list of conditions plus one
 * `matchStrategy` of ALL or ANY. There is no direct representation of
 * `A AND (B OR C)` in a single branch.
 *
 * Flattening by taking only the root group's logic would save a rule that
 * evaluates differently from the one on screen, which is the worst failure mode
 * available: silently wrong, and invisible until a real signal is mishandled.
 *
 * So the tree is converted to DISJUNCTIVE NORMAL FORM — an OR of ANDs. That maps
 * exactly onto the engine's branch semantics, because a rule matches if its
 * ifBranch matches OR any elseIfBranch does, and a branch with matchStrategy
 * ALL is an AND over its conditions:
 *
 *     A AND (B OR C)   ->   (A AND B) OR (A AND C)
 *                      ->   ifBranch[A,B] , elseIfBranch[A,C]     (all ALL)
 *
 * Every branch carries the same thenAction, so which one matched changes only
 * the reported branch id, not the outcome.
 */

import type { ConditionGroup, ConditionRule } from './RuleBuilder';
import type { SpatialCondition } from '@shared/contracts/spatial-predicates';
import type { EvaluatorConfig } from './EvaluatorConfigDrawer';

/** Any condition shape the engine accepts. */
export type EngineCondition = Record<string, unknown>;

export interface ConversionResult {
  conditions: EngineCondition[][];
  /** Non-fatal notes worth showing the operator (dropped nodes, etc.). */
  warnings: string[];
}

/**
 * DNF expansion is exponential in the number of nested OR groups. A rule with
 * more clauses than this is almost certainly a modelling mistake, and expanding
 * it would hang the browser.
 */
export const MAX_DNF_CLAUSES = 256;

export class RuleConversionError extends Error {}

/** Evaluator types that are ACTIONS, not conditions — they build thenAction. */
const ACTION_EVALUATORS = new Set(['webhook', 'response_cycle']);

/**
 * Converts one builder node into the engine's condition shape.
 * Returns null for nodes that carry no evaluable predicate.
 */
export function toEngineCondition(rule: ConditionRule): EngineCondition | null {
  const config = (rule.config ?? {}) as EvaluatorConfig;

  // A spatial condition authored in the SpatialConditionEditor is already in
  // the engine's shape — pass it through rather than re-deriving it.
  if (config.spatialCondition) {
    const spatial = config.spatialCondition as SpatialCondition;
    return {
      ...spatial,
      type: 'spatial',
      // Stable id so the iteration gate accumulates against this condition
      // across evaluations rather than a fresh bucket each time.
      conditionId: spatial.conditionId ?? rule.id,
      label: spatial.label ?? rule.label,
    };
  }

  switch (rule.evaluatorType) {
    case 'semantic_judge':
      return {
        type: 'fuzzy_ai_eval',
        metric: config.groupBy || 'thesis_alignment',
        promptDirective: config.thesisPrompt ?? '',
        operator: 'greater_than_or_equal',
        fuzzyThreshold: config.minConfidence ?? 0.85,
      };

    case 'freshness_decay':
      return {
        type: 'temporal_velocity',
        temporalOperator: 'MAX_SIGNAL_AGE',
        maxAgeMinutes: (config.maxAgeHours ?? 24) * 60,
      };

    case 'sliding_window':
      return {
        type: 'temporal_velocity',
        temporalOperator: 'FREQUENCY_SPIKE',
        frequencyWindowMinutes: config.windowMinutes ?? 60,
        minFrequencyCount: config.minEventCount ?? 5,
      };

    case 'anomaly_scorer':
      // The H3 surprise scorer is a spatial flux threshold over the selected
      // tiles. Without geometry it cannot be evaluated, so it is dropped rather
      // than saved as a condition that can never match.
      if (!config.selectedHexes?.length && !config.cellGroups?.length) return null;
      return {
        type: 'spatial',
        mode: 'flux_analytic',
        fn: 'isotropic_flux_density',
        operator: 'greater_than_or_equal',
        value: config.zScoreCutoff ?? 2.5,
        conditionId: rule.id,
        geometry: {
          regionName: config.spatialRegionName,
          h3Cells: config.selectedHexes,
          cellGroups: config.cellGroups,
          centerLat: config.centerLat,
          centerLng: config.centerLng,
        },
      };

    default: {
      // Crisp field comparison. `operator` keeps its display symbol; the engine
      // normalises it.
      if (!rule.field) return null;
      return {
        type: 'crisp',
        field: rule.field,
        operator: rule.operator,
        value: rule.value,
      };
    }
  }
}

/**
 * Expands the builder tree into DNF: a list of AND-clauses, any one of which
 * satisfying the rule means the rule matched.
 */
export function toDnf(group: ConditionGroup, warnings: string[] = []): EngineCondition[][] {
  const childClauseSets: EngineCondition[][][] = [];

  for (const child of group.children) {
    if (child.type === 'group') {
      childClauseSets.push(toDnf(child, warnings));
      continue;
    }

    if (child.evaluatorType && ACTION_EVALUATORS.has(child.evaluatorType)) {
      // Actions are collected separately by buildThenAction.
      continue;
    }

    const condition = toEngineCondition(child);
    if (!condition) {
      warnings.push(
        `Skipped "${child.label || child.field || child.id}": it has no evaluable predicate configured.`
      );
      continue;
    }
    // A leaf is a single clause containing a single condition.
    childClauseSets.push([[condition]]);
  }

  if (childClauseSets.length === 0) return [];

  if (group.logic === 'OR') {
    // Union of every child's clauses.
    const merged = childClauseSets.flat();
    assertClauseBudget(merged.length);
    return merged;
  }

  // AND: cartesian product across children. This is where DNF grows.
  return childClauseSets.reduce((acc, clauses) => {
    const product: EngineCondition[][] = [];
    for (const left of acc) {
      for (const right of clauses) {
        product.push([...left, ...right]);
      }
    }
    assertClauseBudget(product.length);
    return product;
  });
}

function assertClauseBudget(size: number): void {
  if (size > MAX_DNF_CLAUSES) {
    throw new RuleConversionError(
      `This rule expands to more than ${MAX_DNF_CLAUSES} logical combinations. ` +
        `Simplify the nested OR groups — deeply nested alternatives multiply out.`
    );
  }
}

/**
 * Derives the rule's action from any action nodes in the tree, falling back to
 * the builder's delivery-mode selector.
 */
export function buildThenAction(
  group: ConditionGroup,
  deliveryMode: string
): { deliveryMode: string; receiverBinding?: Record<string, unknown> } {
  const actions: ConditionRule[] = [];
  const walk = (g: ConditionGroup) => {
    for (const child of g.children) {
      if (child.type === 'group') walk(child);
      else if (child.evaluatorType && ACTION_EVALUATORS.has(child.evaluatorType)) actions.push(child);
    }
  };
  walk(group);

  const action = actions[0];
  if (!action) return { deliveryMode };

  const config = (action.config ?? {}) as EvaluatorConfig;
  if (action.evaluatorType === 'webhook') {
    return {
      deliveryMode: 'notify',
      receiverBinding: {
        targetType: 'webhook',
        targetId: config.endpointUrl ?? '',
        recipientName: 'External Webhook',
      },
    };
  }
  return {
    deliveryMode: 'trigger',
    receiverBinding: {
      targetType: 'cycle',
      targetId: config.targetCycleId ?? '',
      recipientName: config.priority ?? 'P2 High',
    },
  };
}

export interface BuildSpecOptions {
  ruleId: string;
  ruleName: string;
  deliveryMode: string;
  enabled: boolean;
  priorityWeight?: number;
}

/**
 * Builds the full rule specification the API accepts.
 *
 * Throws RuleConversionError when the tree cannot be represented — better a
 * visible failure at save time than a rule that quietly means something else.
 */
export function buildRuleSpecification(
  tree: ConditionGroup,
  options: BuildSpecOptions
): { specification: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const clauses = toDnf(tree, warnings);

  if (clauses.length === 0) {
    throw new RuleConversionError(
      'This rule has no evaluable conditions. Add at least one filter before deploying.'
    );
  }

  const thenAction = buildThenAction(tree, options.deliveryMode);

  const branch = (conditions: EngineCondition[], index: number) => ({
    branchId: index === 0 ? 'IF_BRANCH' : `ELSE_IF_${index}`,
    branchName: index === 0 ? 'Primary match' : `Alternative ${index}`,
    // Every DNF clause is a conjunction, hence ALL — the OR lives in the
    // branch list itself.
    matchStrategy: 'ALL' as const,
    conditions,
    thenAction,
  });

  const [first, ...rest] = clauses;

  return {
    specification: {
      ruleId: options.ruleId,
      ruleName: options.ruleName,
      enabled: options.enabled,
      priorityWeight: options.priorityWeight ?? 50,
      ifBranch: branch(first, 0),
      ...(rest.length ? { elseIfBranches: rest.map((c, i) => branch(c, i + 1)) } : {}),
    },
    warnings,
  };
}

/** URL-safe, stable id derived from a rule name. */
export function slugifyRuleId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'rule';
}
