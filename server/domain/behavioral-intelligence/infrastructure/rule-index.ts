/**
 * Behavioral Intelligence Engine — Rule Index
 *
 * Pre-compiled in-memory rule lookup structure using a 6-level hierarchy trie.
 * Provides O(1) rule matching for incoming events.
 *
 * Hierarchy levels (most specific → least specific):
 *   page → pageState → card → elementType → elementId → activity
 *
 * When an event arrives, we generate lookup keys from most specific to least
 * specific and return the first match (most specific rule wins).
 *
 * Hot-reload: recompiles affected rules within 5 seconds of change.
 */
import { createLogger } from "@server/utils/logger.js";
import { evaluate, type EvalContext } from "../core/expression-engine.js";

const logger = createLogger("BIRuleIndex");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScoringRuleDefinition {
  id: string;
  model_id: string;
  name: string;
  rule_type: "behavioral" | "qualification" | "diff_event" | "path_match";
  signal_category: "behavioral" | "qualification";
  hierarchy: {
    page?: string;
    pageState?: string;
    card?: string;
    elementType?: string;
    elementId?: string;
    activity?: string;
  };
  event_type?: string; // For non-hierarchical matching
  vectors: Array<{
    vector_name: string;
    weight_expression: string; // Can be a number or expression
    operation: "increment" | "set" | "multiply";
  }>;
  chain?: Array<{ rule_id: string; condition_expression?: string }>;
  parametric?: { expression: string; parameters: Array<{ name: string; source: string }> };
  conditions?: string; // Expression that must evaluate to true for rule to fire
  concept_id?: number;
  enabled: boolean;
  priority: number;
  entity_type?: string; // Scope to specific entity type
}

export interface CompiledRule {
  definition: ScoringRuleDefinition;
  /** Pre-parsed condition (null if no condition) */
  hasCondition: boolean;
  /** Pre-parsed weight expressions (true if any weight is an expression, not a literal) */
  hasParametricWeights: boolean;
}

export interface RuleMatch {
  rule: CompiledRule;
  weights: Array<{ vector: string; weight: number; operation: "increment" | "set" | "multiply" }>;
  chainTargets: Array<{ rule_id: string; condition_expression?: string }> | undefined;
}

// ─── Rule Index ──────────────────────────────────────────────────────────────

const SEPARATOR = ":";
const WILDCARD = "*";

/**
 * Generate hierarchy lookup keys from most specific to least specific.
 * Returns up to 7 keys (full match + progressively less specific).
 */
function generateHierarchyKeys(event: { page?: string; pageState?: string; card?: string; elementType?: string; elementId?: string; activity?: string }): string[] {
  const { page, pageState, card, elementType, elementId, activity } = event;
  const keys: string[] = [];

  // Most specific: all 6 levels
  if (page && pageState && card && elementType && elementId && activity) {
    keys.push([page, pageState, card, elementType, elementId, activity].join(SEPARATOR));
  }
  // 5 levels (no elementId)
  if (page && pageState && card && elementType && activity) {
    keys.push([page, pageState, card, elementType, WILDCARD, activity].join(SEPARATOR));
  }
  // 4 levels (no elementType, elementId)
  if (page && pageState && card && activity) {
    keys.push([page, pageState, card, WILDCARD, WILDCARD, activity].join(SEPARATOR));
  }
  // 3 levels (page + pageState + activity)
  if (page && pageState && activity) {
    keys.push([page, pageState, WILDCARD, WILDCARD, WILDCARD, activity].join(SEPARATOR));
  }
  // 2 levels (page + activity)
  if (page && activity) {
    keys.push([page, WILDCARD, WILDCARD, WILDCARD, WILDCARD, activity].join(SEPARATOR));
  }
  // 1 level (activity only)
  if (activity) {
    keys.push([WILDCARD, WILDCARD, WILDCARD, WILDCARD, WILDCARD, activity].join(SEPARATOR));
  }
  // Catch-all
  keys.push([WILDCARD, WILDCARD, WILDCARD, WILDCARD, WILDCARD, WILDCARD].join(SEPARATOR));

  return keys;
}

/**
 * Build the hierarchy key for a rule definition (for indexing).
 */
function buildRuleKey(hierarchy: ScoringRuleDefinition["hierarchy"]): string {
  return [
    hierarchy.page || WILDCARD,
    hierarchy.pageState || WILDCARD,
    hierarchy.card || WILDCARD,
    hierarchy.elementType || WILDCARD,
    hierarchy.elementId || WILDCARD,
    hierarchy.activity || WILDCARD,
  ].join(SEPARATOR);
}

/**
 * Check if a weight expression is a literal number or a dynamic expression.
 */
function isLiteralWeight(expr: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(expr.trim());
}

// ─── Compiled Index Class ────────────────────────────────────────────────────

export class CompiledRuleIndex {
  /** Hierarchy trie: key → rules (sorted by priority desc) */
  private byHierarchy = new Map<string, CompiledRule[]>();
  /** Event type fallback: event_type → rules */
  private byEventType = new Map<string, CompiledRule[]>();
  /** Diff source rules: source_id → rules */
  private byDiffSource = new Map<string, CompiledRule[]>();
  /** All rules by ID (for chain resolution) */
  private byId = new Map<string, CompiledRule>();
  /** Org ID this index belongs to */
  public orgId: number;
  /** Compilation timestamp */
  public compiledAt: number;

  constructor(orgId: number) {
    this.orgId = orgId;
    this.compiledAt = Date.now();
  }

  /**
   * Compile a set of rule definitions into the index.
   */
  compile(rules: ScoringRuleDefinition[]): void {
    this.byHierarchy.clear();
    this.byEventType.clear();
    this.byDiffSource.clear();
    this.byId.clear();

    const enabledRules = rules.filter(r => r.enabled);

    for (const def of enabledRules) {
      const compiled: CompiledRule = {
        definition: def,
        hasCondition: !!def.conditions && def.conditions.trim() !== "",
        hasParametricWeights: def.vectors.some(v => !isLiteralWeight(v.weight_expression)),
      };

      this.byId.set(def.id, compiled);

      if (def.rule_type === "diff_event") {
        // Index by event_type for diff events
        const key = def.event_type || "diff_any";
        const existing = this.byDiffSource.get(key) || [];
        existing.push(compiled);
        this.byDiffSource.set(key, existing);
      } else if (def.hierarchy && Object.values(def.hierarchy).some(v => v)) {
        // Index by hierarchy
        const key = buildRuleKey(def.hierarchy);
        const existing = this.byHierarchy.get(key) || [];
        existing.push(compiled);
        this.byHierarchy.set(key, existing);
      } else if (def.event_type) {
        // Fallback: index by event_type
        const existing = this.byEventType.get(def.event_type) || [];
        existing.push(compiled);
        this.byEventType.set(def.event_type, existing);
      }
    }

    // Sort all rule lists by priority (higher priority first)
    for (const rules of this.byHierarchy.values()) rules.sort((a, b) => b.definition.priority - a.definition.priority);
    for (const rules of this.byEventType.values()) rules.sort((a, b) => b.definition.priority - a.definition.priority);
    for (const rules of this.byDiffSource.values()) rules.sort((a, b) => b.definition.priority - a.definition.priority);

    this.compiledAt = Date.now();
    logger.info(`[RuleIndex] Compiled ${enabledRules.length} rules for org ${this.orgId} (hierarchy: ${this.byHierarchy.size}, eventType: ${this.byEventType.size}, diff: ${this.byDiffSource.size})`);
  }

  /**
   * Find matching rules for an event.
   * Returns matches from most specific hierarchy level first.
   */
  findMatches(event: {
    event_type: string;
    entity_type?: string;
    page?: string;
    pageState?: string;
    card?: string;
    elementType?: string;
    elementId?: string;
    activity?: string;
    source?: string;
  }, context: EvalContext): RuleMatch[] {
    const matches: RuleMatch[] = [];

    // 1. Try hierarchy matching (most specific first)
    if (event.page || event.activity) {
      const keys = generateHierarchyKeys(event);
      for (const key of keys) {
        const rules = this.byHierarchy.get(key);
        if (rules && rules.length > 0) {
          const evaluated = this.evaluateRules(rules, event, context);
          if (evaluated.length > 0) {
            matches.push(...evaluated);
            break; // Most specific match wins — don't check less specific levels
          }
        }
      }
    }

    // 2. Try event_type matching (if no hierarchy match)
    if (matches.length === 0 && event.event_type) {
      const rules = this.byEventType.get(event.event_type);
      if (rules) {
        matches.push(...this.evaluateRules(rules, event, context));
      }
    }

    // 3. Also check diff rules (additive, not exclusive)
    if (event.source === "diff") {
      const diffRules = this.byDiffSource.get(event.event_type) || this.byDiffSource.get("diff_any") || [];
      matches.push(...this.evaluateRules(diffRules, event, context));
    }

    return matches;
  }

  /**
   * Get a rule by ID (for chain resolution).
   */
  getRuleById(ruleId: string): CompiledRule | undefined {
    return this.byId.get(ruleId);
  }

  /**
   * Get total number of compiled rules.
   */
  get size(): number {
    return this.byId.size;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private evaluateRules(rules: CompiledRule[], event: any, context: EvalContext): RuleMatch[] {
    const matches: RuleMatch[] = [];

    for (const rule of rules) {
      // Entity type filter
      if (rule.definition.entity_type && event.entity_type && rule.definition.entity_type !== event.entity_type) {
        continue;
      }

      // Condition check
      if (rule.hasCondition) {
        try {
          const condResult = evaluate(rule.definition.conditions!, { ...context, event });
          if (!condResult) continue;
        } catch {
          continue; // Condition evaluation failed — skip rule
        }
      }

      // Resolve weights
      const weights = rule.definition.vectors.map(v => {
        let weight: number;
        if (rule.hasParametricWeights && !isLiteralWeight(v.weight_expression)) {
          try {
            weight = Number(evaluate(v.weight_expression, { ...context, event })) || 0;
          } catch {
            weight = 0;
          }
        } else {
          weight = parseFloat(v.weight_expression) || 0;
        }
        return { vector: v.vector_name, weight, operation: v.operation };
      });

      matches.push({
        rule,
        weights,
        chainTargets: rule.definition.chain,
      });
    }

    return matches;
  }
}

// ─── Index Cache (per org) ───────────────────────────────────────────────────

const indexCache = new Map<number, CompiledRuleIndex>();

/**
 * Get or create the compiled rule index for an org.
 */
export function getOrCreateIndex(orgId: number): CompiledRuleIndex {
  let index = indexCache.get(orgId);
  if (!index) {
    index = new CompiledRuleIndex(orgId);
    indexCache.set(orgId, index);
  }
  return index;
}

/**
 * Invalidate the index for an org (triggers recompilation on next access).
 */
export function invalidateIndex(orgId: number): void {
  indexCache.delete(orgId);
}

/**
 * Get all cached index org IDs (for health monitoring).
 */
export function getActiveIndexOrgIds(): number[] {
  return [...indexCache.keys()];
}

export const biRuleIndex = { getOrCreateIndex, invalidateIndex, getActiveIndexOrgIds, generateHierarchyKeys, buildRuleKey };
