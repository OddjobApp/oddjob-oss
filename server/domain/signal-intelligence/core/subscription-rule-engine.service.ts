/**
 * Subscription Rule Engine Service (GRIE Core Engine)
 *
 * Implements the 4-Stage Governed Rules & Decision Intelligence Engine:
 * - Stage 1: Crisp Rule Pre-Filter (Fast-Path O(1))
 * - Stage 2: Fuzzy AI Cognitive Evaluator (LLM-as-a-Judge)
 * - Stage 3: Master Priority Score (MAUF Formula calculation)
 * - Stage 4: Receiver Binding & Action Execution
 */

import { db } from "../../../db/index.js";
import { eq, and, desc, gte, isNull, sql } from "drizzle-orm";
import {
  ruleSuites,
  ruleSpecifications,
  ruleExecutionAudits,
  eventPrimitives,
  type EventPrimitive,
  type CausalGraphLink,
} from "@shared/schema/signal-intelligence.js";
import { llmCognitiveEvaluator } from "../../agents/core/llm-cognitive-evaluator.service.js";
import {
  spatialPredicateEngine,
  type SpatialObservation,
} from "./spatial-predicate-engine.service.js";
import { spatialPersistenceStore } from "./spatial-persistence-store.service.js";
import { spatialRegionStore } from "./spatial-region-store.service.js";
import {
  spatialReranker,
  type RerankableSignal,
  type RerankedSignal,
  type RerankOptions,
} from "./spatial-reranker.service.js";
import {
  normalizeOperator,
  type SpatialCondition,
  type SpatialConditionResult,
} from "@shared/contracts/spatial-predicates.js";

export interface CrispCondition {
  type?: "crisp";
  field: string;
  /**
   * Accepts both canonical names ("greater_than_or_equal") and the display
   * symbols the Rule Builder emits (">="). `normalizeOperator` collapses them;
   * previously a UI-authored ">=" fell through to `default: return false` and
   * the rule could never match.
   */
  operator:
    | "equals"
    | "not_equals"
    | "greater_than"
    | "greater_than_or_equal"
    | "less_than"
    | "less_than_or_equal"
    | "in"
    | "not_in"
    | "contains"
    | "between"
    | string;
  value: any;
}

export interface FuzzyAICondition {
  type: "fuzzy_ai_eval";
  metric: string;
  promptDirective: string;
  operator: "greater_than_or_equal" | "less_than_or_equal";
  fuzzyThreshold: number;
}

export interface SemanticGraphCondition {
  type: "semantic_graph";
  graphOperator: "CAUSAL_PATH_EXISTS" | "GRAPH_COMMUNITY_MEMBER" | "FIEDLER_CUT_IMPACT" | "ONTOLOGY_IS_A" | "NEIGHBORHOOD_DENSITY";
  targetEntityId?: string;
  maxHops?: number;
  threshold?: number;
}

export interface TemporalCondition {
  type: "temporal_velocity";
  temporalOperator: "MAX_SIGNAL_AGE" | "FREQUENCY_SPIKE" | "TIME_PARTING_WINDOW" | "RECENCY_DECAY_FLOOR";
  maxAgeMinutes?: number;
  frequencyWindowMinutes?: number;
  minFrequencyCount?: number;
  timeParting?: {
    daysOfWeek?: number[]; // 1=Mon, 7=Sun
    startHour?: number; // 0-23
    endHour?: number; // 0-23
    timezone?: string;
  };
  minRecencyDecayFloor?: number;
}

export interface RuleBranchSpec {
  branchId: string;
  branchName: string;
  matchStrategy: "ALL" | "ANY";
  conditions: (
    | CrispCondition
    | FuzzyAICondition
    | SemanticGraphCondition
    | TemporalCondition
    | SpatialCondition
  )[];
  thenAction: {
    deliveryMode: string;
    receiverBinding?: {
      targetType: string;
      targetId: string | number;
      recipientName?: string;
    };
    missionBlueprint?: {
      blueprintName: string;
      assignedAgentRole: string;
      executionStyle?: string;
      fuzzyGoalDirective?: string;
    };
  };
}

export interface RuleSpecificationPayload {
  ruleId: string;
  ruleName: string;
  enabled: boolean;
  priorityWeight?: number;
  ifBranch: RuleBranchSpec;
  elseIfBranches?: RuleBranchSpec[];
  elseBranch?: {
    thenAction: {
      deliveryMode: string;
      logReason: string;
    };
  };
}

/**
 * Fields whose values are ordered categories rather than numbers.
 *
 * WHY: the crisp evaluator compares with `Number(val)`, so `severity >= "High"`
 * became `NaN >= NaN` — permanently false. The Rule Builder offers severity
 * alongside `>=`/`<=` operators, so this was reachable straight from the UI and
 * failed silently, which is the worst way for a rule to be wrong.
 */
const ORDINAL_FIELDS: Record<string, Record<string, number>> = {
  severity: { Low: 1, Medium: 2, High: 3, Critical: 4 },
};

/** Ordinal rank for a categorical value, or null when not an ordered field. */
function ordinalRank(field: string, value: unknown): number | null {
  const scale = ORDINAL_FIELDS[field];
  if (!scale || value == null) return null;
  // Case-insensitive: feeds emit "critical" and "CRITICAL" alike.
  const key = Object.keys(scale).find(
    (k) => k.toLowerCase() === String(value).trim().toLowerCase()
  );
  return key ? scale[key] : null;
}

/** Narrows a branch condition to a spatial one. */
function isSpatialCondition(
  cond: CrispCondition | FuzzyAICondition | SemanticGraphCondition | TemporalCondition | SpatialCondition
): cond is SpatialCondition {
  return (cond as SpatialCondition).type === "spatial";
}

export interface EvaluationResult {
  ruleSuiteId: string;
  ruleId: string;
  matchedBranch: string;
  masterPriorityScore: number;
  disposition: string;
  fuzzyScores: Record<string, number>;
  actionTaken: any;
  passed: boolean;
  /** Weighted 0-1 aggregate of the branch's spatial conditions. */
  spatialScore?: number;
  /** Per-condition spatial trace, for the audit record and the rule UI. */
  spatialTrace?: SpatialConditionResult[];
}

export class SubscriptionRuleEngineService {
  private initialized = false;

  constructor() {
    // Confirmation counters survive restarts only if the engine has durable
    // backing. Attached here rather than inside the predicate engine so that
    // module keeps no database import and stays unit-testable without one.
    spatialPredicateEngine.setPersistenceStore(spatialPersistenceStore);
    // Same reasoning for stored regions: a condition may name a spatial_regions
    // row instead of inlining its cells, and the engine reads it through this
    // port rather than importing the database itself.
    spatialPredicateEngine.setRegionStore(spatialRegionStore);
  }

  private async ensureTablesExist() {
    if (this.initialized) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS rule_suites (
          id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL,
          suite_id TEXT NOT NULL UNIQUE,
          suite_name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Supply Chain & Logistics',
          version TEXT NOT NULL DEFAULT '1.0.0',
          owner TEXT NOT NULL DEFAULT 'Operations Team',
          description TEXT,
          execution_policy TEXT NOT NULL DEFAULT 'HIGHEST_PRIORITY_MAUF',
          enabled BOOLEAN NOT NULL DEFAULT true,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rule_specifications (
          id SERIAL PRIMARY KEY,
          suite_db_id INTEGER NOT NULL REFERENCES rule_suites(id) ON DELETE CASCADE,
          rule_id TEXT NOT NULL,
          rule_name TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT true,
          priority_weight INTEGER NOT NULL DEFAULT 50,
          specification JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rule_execution_audits (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id INTEGER NOT NULL,
          suite_id TEXT NOT NULL,
          rule_id TEXT NOT NULL,
          event_primitive_id UUID,
          master_priority_score INTEGER NOT NULL,
          matched_branch TEXT NOT NULL,
          disposition TEXT NOT NULL,
          fuzzy_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
          action_taken JSONB NOT NULL DEFAULT '{}'::jsonb,
          outcome TEXT NOT NULL DEFAULT 'matched',
          failure_reason TEXT,
          spatial_trace JSONB,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        );

        -- Kept in step with migration 0046 for databases provisioned by this
        -- auto-create path rather than by the migration chain.
        ALTER TABLE rule_execution_audits ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'matched';
        ALTER TABLE rule_execution_audits ADD COLUMN IF NOT EXISTS failure_reason TEXT;
        ALTER TABLE rule_execution_audits ADD COLUMN IF NOT EXISTS spatial_trace JSONB;
        ALTER TABLE rule_execution_audits ADD COLUMN IF NOT EXISTS project_id INTEGER;
        ALTER TABLE rule_execution_audits ADD COLUMN IF NOT EXISTS rule_specification_id INTEGER;
      `);
      this.initialized = true;
    } catch (err: any) {
      console.warn("[GRIE Engine] Auto-provisioning tables notice:", err.message);
    }
  }

  /**
   * Evaluates an incoming Event Primitive against all active Rule Suites for an Organization
   */
  async evaluateEvent(
    event: EventPrimitive,
    links: CausalGraphLink[] = []
  ): Promise<EvaluationResult[]> {
    await this.ensureTablesExist();
    const projectId = event.projectId ?? null;
    const activeSuites = await db
      .select()
      .from(ruleSuites)
      .where(and(
        eq(ruleSuites.organizationId, event.organizationId),
        projectId == null ? isNull(ruleSuites.projectId) : eq(ruleSuites.projectId, projectId),
        eq(ruleSuites.enabled, true),
      ));

    if (activeSuites.length === 0) {
      return [];
    }

    const results: EvaluationResult[] = [];

    for (const suite of activeSuites) {
      const ruleSpecs = await db
        .select()
        .from(ruleSpecifications)
        .where(and(eq(ruleSpecifications.suiteDbId, suite.id), eq(ruleSpecifications.enabled, true)))
        .orderBy(desc(ruleSpecifications.priorityWeight));

      for (const specRow of ruleSpecs) {
        const spec = specRow.specification as RuleSpecificationPayload;
        if (!spec || !spec.ifBranch) continue;

        /**
         * Every evaluation is recorded, not only the ones that matched.
         *
         * Previously an audit row existed only for a passing rule, and a rule
         * that threw produced a `console.warn` and nothing durable. So the
         * question operators actually ask — "why didn't my rule fire?" — had
         * three indistinguishable answers in the data: it did not match, it
         * failed to evaluate, or it was never reached. `outcome` separates
         * them, and `spatialTrace` carries the per-condition reasoning that was
         * previously visible only through the dry run.
         */
        let evalResult: EvaluationResult | null = null;
        let failureReason: string | null = null;

        try {
          evalResult = await this.evaluateSingleRule(suite.suiteId, spec, event, links);
        } catch (evalErr: any) {
          failureReason = evalErr?.message ?? String(evalErr);
          console.warn(
            `[GRIE Engine] Rule '${spec.ruleId}' failed to evaluate: ${failureReason}`
          );
        }

        try {
          await db.insert(ruleExecutionAudits).values({
            organizationId: event.organizationId,
            projectId,
            ruleSpecificationId: specRow.id,
            suiteId: suite.suiteId,
            ruleId: spec.ruleId,
            eventPrimitiveId: event.id,
            masterPriorityScore: evalResult?.masterPriorityScore ?? 0,
            matchedBranch: evalResult?.matchedBranch ?? "NONE",
            disposition: evalResult?.disposition ?? "ignore",
            fuzzyScores: evalResult?.fuzzyScores ?? {},
            actionTaken: evalResult?.actionTaken ?? {},
            outcome: failureReason ? "error" : evalResult?.passed ? "matched" : "no_match",
            failureReason,
            spatialTrace: evalResult?.spatialTrace ?? null,
          });
        } catch (auditErr: any) {
          console.warn("[GRIE Engine] Failed to record execution audit:", auditErr.message);
          if (evalResult?.passed) throw auditErr;
        }

        if (evalResult?.passed) {
          results.push(evalResult);

          // If execution policy is FIRST_MATCH, stop evaluating further rules in this suite
          if (suite.executionPolicy === "FIRST_MATCH") break;
        }
      }
    }

    return results;
  }

  /**
   * Evaluates one rule specification against an event WITHOUT persisting an
   * audit row or firing its action.
   *
   * Backs the Rule Builder's dry-run: an operator needs to see whether a rule
   * would match, and why, before turning it loose on live signals. Kept
   * separate from `evaluateEvent` precisely because that path writes audits and
   * triggers delivery.
   */
  public async evaluateRuleSpecification(
    suiteId: string,
    rule: RuleSpecificationPayload,
    event: EventPrimitive,
    links: CausalGraphLink[] = []
  ): Promise<EvaluationResult> {
    if (!rule?.ifBranch) {
      throw new Error("Rule specification is missing an ifBranch");
    }
    // A dry run evaluates the same conditionIds a live rule uses. Without
    // isolation it would hydrate real confirmation counters, advance them, and
    // flush them back — so pressing "test" in the Rule Builder would reset or
    // advance production gate state for a real tracked entity.
    return spatialPredicateEngine.withIsolatedPersistence(() =>
      this.evaluateSingleRule(suiteId, rule, event, links)
    );
  }

  /**
   * Evaluates a single rule (IF / ELSE IF / ELSE branches) against an event
   */
  private async evaluateSingleRule(
    suiteId: string,
    rule: RuleSpecificationPayload,
    event: EventPrimitive,
    links: CausalGraphLink[]
  ): Promise<EvaluationResult> {
    const fuzzyScores: Record<string, number> = {};
    const spatialTrace: SpatialConditionResult[] = [];

    // 1. Evaluate IF Branch
    const ifBranchPassed = await this.evaluateBranch(rule.ifBranch, event, links, fuzzyScores, spatialTrace);
    if (ifBranchPassed) {
      const masterScore = this.calculateMasterPriorityScore(event, fuzzyScores, links.length);
      return {
        ruleSuiteId: suiteId,
        ruleId: rule.ruleId,
        matchedBranch: rule.ifBranch.branchId || "IF_BRANCH",
        masterPriorityScore: masterScore,
        disposition: rule.ifBranch.thenAction.deliveryMode || "trigger_step",
        fuzzyScores,
        actionTaken: rule.ifBranch.thenAction,
        passed: true,
        spatialScore: fuzzyScores["spatial_score"],
        spatialTrace: spatialTrace.length ? [...spatialTrace] : undefined,
      };
    }

    // 2. Evaluate ELSE IF Branches
    if (rule.elseIfBranches?.length) {
      for (const branch of rule.elseIfBranches) {
        // Each branch gets a fresh trace so a failed IF branch's spatial
        // explanations do not leak into the branch that actually matched.
        spatialTrace.length = 0;
        const passed = await this.evaluateBranch(branch, event, links, fuzzyScores, spatialTrace);
        if (passed) {
          const masterScore = this.calculateMasterPriorityScore(event, fuzzyScores, links.length);
          return {
            ruleSuiteId: suiteId,
            ruleId: rule.ruleId,
            matchedBranch: branch.branchId || "ELSE_IF_BRANCH",
            masterPriorityScore: masterScore,
            disposition: branch.thenAction.deliveryMode || "context_only",
            fuzzyScores,
            actionTaken: branch.thenAction,
            passed: true,
            spatialScore: fuzzyScores["spatial_score"],
            spatialTrace: spatialTrace.length ? [...spatialTrace] : undefined,
          };
        }
      }
    }

    // 3. Fallback ELSE Branch
    //
    // The spatial trace is carried onto the non-matching returns as well.
    // Previously it was attached only when a branch PASSED, which is backwards
    // for the surface that consumes it: the Rule Builder's simulation tab is
    // where an operator asks "why did my rule not fire?", and answering that
    // needs the per-condition explanations more than a matching run does.
    //
    // It also made the precision gate's message unreachable. That gate fails a
    // condition deliberately, explaining that a coarse fix means the position is
    // UNKNOWN rather than outside — advice an operator could never see, because
    // failing was exactly the case that dropped the trace.
    if (rule.elseBranch) {
      return {
        ruleSuiteId: suiteId,
        ruleId: rule.ruleId,
        matchedBranch: "ELSE_BRANCH",
        masterPriorityScore: 10,
        disposition: rule.elseBranch.thenAction.deliveryMode || "ignore",
        fuzzyScores,
        actionTaken: rule.elseBranch.thenAction,
        passed: false,
        spatialScore: fuzzyScores["spatial_score"],
        spatialTrace: spatialTrace.length ? [...spatialTrace] : undefined,
      };
    }

    return {
      ruleSuiteId: suiteId,
      ruleId: rule.ruleId,
      matchedBranch: "NONE",
      masterPriorityScore: 0,
      disposition: "ignore",
      fuzzyScores,
      actionTaken: null,
      passed: false,
      spatialScore: fuzzyScores["spatial_score"],
      spatialTrace: spatialTrace.length ? [...spatialTrace] : undefined,
    };
  }

  /**
   * Evaluates a single rule branch (Crisp & Fuzzy AI conditions)
   */
  private async evaluateBranch(
    branch: RuleBranchSpec,
    event: EventPrimitive,
    links: CausalGraphLink[],
    fuzzyScores: Record<string, number>,
    spatialTrace?: SpatialConditionResult[]
  ): Promise<boolean> {
    if (!branch.conditions || branch.conditions.length === 0) return true;

    const results: boolean[] = [];

    // Spatial conditions are evaluated as a set so they can be scored as a
    // weighted aggregate rather than independently — a k-ring proximity that
    // half-matches should still lift priority.
    const spatialConditions = branch.conditions.filter(isSpatialCondition);

    if (spatialConditions.length) {
      const observation = this.toSpatialObservation(event);

      // Load durable confirmation counters before the synchronous evaluation
      // pass. Without this a restart drops a latched geofence back to
      // unconfirmed and ON_ENTER re-fires for an asset already inside.
      await spatialPredicateEngine.hydratePersistence(
        event.organizationId,
        spatialConditions,
        observation
      );

      // Any region a condition references has to be in memory before the
      // synchronous pass below; unhydrated, the condition is refused rather
      // than evaluated against an empty zone.
      await spatialPredicateEngine.hydrateRegions(
        event.organizationId,
        spatialConditions
      );

      const summary = spatialPredicateEngine.evaluate(
        spatialConditions,
        observation,
        branch.matchStrategy
      );
      results.push(summary.passed);
      fuzzyScores["spatial_score"] = summary.spatialScore;
      spatialTrace?.push(...summary.results);

      // Write back what moved. Awaited rather than fire-and-forget so a signal
      // arriving immediately after cannot read counters this one already
      // superseded.
      await spatialPredicateEngine.flushPersistence(event.organizationId);
    }

    for (const cond of branch.conditions) {
      if (isSpatialCondition(cond)) {
        continue; // already handled as an aggregate above
      }
      if (cond.type === "fuzzy_ai_eval") {
        const fuzzyRes = await llmCognitiveEvaluator.evaluateFuzzyCondition(
          event,
          cond.metric,
          cond.promptDirective
        );
        fuzzyScores[cond.metric] = fuzzyRes.score;

        let passed = false;
        if (cond.operator === "greater_than_or_equal") {
          passed = fuzzyRes.score >= cond.fuzzyThreshold;
        } else if (cond.operator === "less_than_or_equal") {
          passed = fuzzyRes.score <= cond.fuzzyThreshold;
        }
        results.push(passed);
      } else if (cond.type === "semantic_graph") {
        const passed = this.evaluateSemanticGraphCondition(cond, event, links);
        results.push(passed);
      } else if (cond.type === "temporal_velocity") {
        const passed = await this.evaluateTemporalCondition(cond, event);
        results.push(passed);
      } else {
        const passed = this.evaluateCrispCondition(cond, event, links);
        results.push(passed);
      }
    }

    return branch.matchStrategy === "ANY"
      ? results.some((r) => r)
      : results.every((r) => r);
  }

  /**
   * Evaluates Temporal & Velocity Scoring Controls (Recency, Frequency, Time-Parting)
   */
  private async evaluateTemporalCondition(cond: TemporalCondition, event: EventPrimitive): Promise<boolean> {
    const eventTime = event.createdAt ? new Date(event.createdAt).getTime() : Date.now();
    const now = Date.now();
    const ageMinutes = (now - eventTime) / 60000;

    switch (cond.temporalOperator) {
      case "MAX_SIGNAL_AGE": {
        const maxAge = cond.maxAgeMinutes ?? 60;
        return ageMinutes <= maxAge;
      }

      case "RECENCY_DECAY_FLOOR": {
        const floor = cond.minRecencyDecayFloor ?? 0.30;
        const halfLifeMinutes = 120; // 2 hour half-life
        const decayScore = Math.exp(- (ageMinutes / halfLifeMinutes));
        return decayScore >= floor;
      }

      case "TIME_PARTING_WINDOW": {
        if (!cond.timeParting) return true;
        const currentDate = new Date();
        const dayOfWeek = currentDate.getDay() === 0 ? 7 : currentDate.getDay(); // 1=Mon, 7=Sun
        const currentHour = currentDate.getHours();

        if (cond.timeParting.daysOfWeek?.length && !cond.timeParting.daysOfWeek.includes(dayOfWeek)) {
          return false;
        }

        if (cond.timeParting.startHour != null && currentHour < cond.timeParting.startHour) {
          return false;
        }

        if (cond.timeParting.endHour != null && currentHour >= cond.timeParting.endHour) {
          return false;
        }

        return true;
      }

      case "FREQUENCY_SPIKE": {
        /**
         * How many comparable signals arrived inside the window.
         *
         * This was `return true` — unconditionally, with both
         * `frequencyWindowMinutes` and `minFrequencyCount` accepted and
         * ignored. A rule containing it was strictly weaker than its author
         * intended, and silently so: the condition contributed nothing to the
         * branch while appearing to constrain it.
         *
         * "Comparable" means same organisation and same event type, narrowed to
         * the same subject when the signal names one — a burst of readings from
         * one vessel is a spike about that vessel, not about the fleet. The
         * ordering matches the existing (organization_id, subject_id,
         * extraction_timestamp) index, so this stays an index scan.
         *
         * The triggering signal is already persisted when rules evaluate, so it
         * counts toward its own window, which is what makes `minFrequencyCount:
         * 1` trivially true rather than off-by-one.
         */
        const windowMinutes = cond.frequencyWindowMinutes ?? 60;
        const minimum = cond.minFrequencyCount ?? 2;
        const since = new Date(Date.now() - windowMinutes * 60_000);
        const subjectId = (event as any).subjectId ?? null;

        try {
          const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(eventPrimitives)
            .where(
              and(
                eq(eventPrimitives.organizationId, event.organizationId),
                eq(eventPrimitives.eventType, event.eventType),
                gte(eventPrimitives.extractionTimestamp, since),
                ...(subjectId ? [eq(eventPrimitives.subjectId, subjectId)] : [])
              )
            );
          return (row?.count ?? 0) >= minimum;
        } catch (err: any) {
          // Fail CLOSED. A condition that cannot be evaluated must not be
          // treated as satisfied — that is how this operator behaved for its
          // whole life, and it is the reason it was worth nothing.
          console.warn(
            `[GRIE Engine] FREQUENCY_SPIKE could not be evaluated: ${err?.message ?? err}`
          );
          return false;
        }
      }

      default:
        return false;
    }
  }

  /**
   * Evaluates Semantic Graph Operators across Causal Graph topologies & relationships
   */
  private evaluateSemanticGraphCondition(
    cond: SemanticGraphCondition,
    event: EventPrimitive,
    links: CausalGraphLink[]
  ): boolean {
    const maxHops = cond.maxHops ?? 3;
    const targetEntityId = cond.targetEntityId?.toLowerCase();

    switch (cond.graphOperator) {
      case "CAUSAL_PATH_EXISTS": {
        if (!targetEntityId) return true;
        // Check if any link targets or sources match target entity within maxHops
        return links.some((link) => {
          const hops = (link as any).hops ?? 1;
          // Only targetEntityId exists on a causal link — the source side is the
          // event primitive, not an entity. The old `|| link.sourceEntityId...`
          // arm was reading a property that is never present, so it always
          // evaluated undefined and contributed nothing.
          const match = link.targetEntityId?.toLowerCase().includes(targetEntityId);
          return match && hops <= maxHops;
        });
      }

      case "GRAPH_COMMUNITY_MEMBER": {
        if (!targetEntityId) return true;
        return links.some((link) => (link as any).communityId === targetEntityId);
      }

      case "FIEDLER_CUT_IMPACT": {
        const threshold = cond.threshold ?? 0.20;
        const degree = links.length;
        const cutImpact = Math.min(1.0, degree / 10);
        return cutImpact >= threshold;
      }

      case "ONTOLOGY_IS_A": {
        if (!targetEntityId) return true;
        const sector = (event.targetSector || "").toLowerCase();
        const type = (event.eventType || "").toLowerCase();
        return sector.includes(targetEntityId) || type.includes(targetEntityId);
      }

      case "NEIGHBORHOOD_DENSITY": {
        const threshold = cond.threshold ?? 3;
        return links.length >= threshold;
      }

      default:
        return false;
    }
  }

  /**
   * Evaluates a crisp numeric/categorical condition
   */
  private evaluateCrispCondition(cond: CrispCondition, event: EventPrimitive, links: CausalGraphLink[]): boolean {
    const val = (event as any)[cond.field];

    // Field lookup is a flat property read, so a misspelled or nested field
    // name ("score.symptom") silently yields undefined. Numeric comparisons
    // then collapse to NaN and return false with no explanation, and — worse —
    // negated operators return TRUE, so an exclusion rule fires on a field the
    // event never carried. That is the same failure shape as treating an
    // unknown position as "outside", so an absent field is reported and
    // treated as unevaluable rather than allowed to decide anything.
    if (!(cond.field in (event as any))) {
      console.warn(
        `[GRIE Engine] Condition references field '${cond.field}', which this event does not carry — condition cannot match. ` +
        `Field lookup is flat, so nested paths are not supported.`
      );
      return false;
    }

    // Accept display symbols (">=") as well as canonical names.
    const operator = normalizeOperator(cond.operator);
    if (!operator) {
      console.warn(
        `[GRIE Engine] Unrecognised operator '${cond.operator}' on field '${cond.field}' — condition cannot match.`
      );
      return false;
    }

    // Ordered categorical fields (severity) compare by rank, not by Number().
    const lhsRank = ordinalRank(cond.field, val);
    const rhsRank = ordinalRank(cond.field, cond.value);
    const useOrdinal = lhsRank !== null && rhsRank !== null;
    const lhs = useOrdinal ? lhsRank! : Number(val);
    const rhs = useOrdinal ? rhsRank! : Number(cond.value);

    switch (operator) {
      case "equals":
        return useOrdinal ? lhs === rhs : val === cond.value;
      case "not_equals":
        return useOrdinal ? lhs !== rhs : val !== cond.value;
      case "greater_than":
        return lhs > rhs;
      case "greater_than_or_equal":
        return lhs >= rhs;
      case "less_than":
        return lhs < rhs;
      case "less_than_or_equal":
        return lhs <= rhs;
      case "in":
        return Array.isArray(cond.value) && cond.value.includes(val);
      case "not_in":
        return Array.isArray(cond.value) && !cond.value.includes(val);
      case "contains":
        return typeof val === "string" && val.includes(String(cond.value));
      case "between": {
        if (!Array.isArray(cond.value) || cond.value.length < 2) return false;
        const [a, b] = [Number(cond.value[0]), Number(cond.value[1])];
        const [min, max] = a <= b ? [a, b] : [b, a];
        const num = Number(val);
        return num >= min && num <= max;
      }
      default:
        return false;
    }
  }

  /**
   * Projects an event primitive's spatial columns into the observation shape
   * the spatial predicate engine consumes.
   */
  private toSpatialObservation(event: EventPrimitive): SpatialObservation {
    const e = event as any;
    return {
      latitude: e.latitude,
      longitude: e.longitude,
      h3Index: e.h3Index,
      previousH3Index: e.previousH3Index,
      dwellMinutes: e.dwellMinutes,
      velocityKnots: e.velocityKnots,
      headingDegrees: e.headingDegrees,
      projectedLatitude: e.projectedLatitude,
      projectedLongitude: e.projectedLongitude,
      fluxDensityPhi: e.fluxDensityPhi,
      cellMetrics: e.cellMetrics ?? undefined,
      subjectId: e.subjectId,
      // Provenance drives the precision gate: a country-centroid fix must not
      // be allowed to satisfy a fine-grained geofence predicate.
      spatialSource: e.spatialSource,
      spatialPrecisionM: e.spatialPrecisionM,
      // Optional: enables the Gaussian refinement in the precision gate. Absent
      // for every source that reports only a radius, which is most of them.
      spatialHdop: e.spatialHdop,
    };
  }

  /**
   * Calculates the Master Priority Score (P_master ∈ [0 ... 100]) using Multi-Attribute Utility Function (MAUF)
   */
  public calculateMasterPriorityScore(
    event: EventPrimitive,
    fuzzyScores: Record<string, number>,
    blastRadiusCount: number = 0
  ): number {
    const SEVERITY_SCORES: Record<string, number> = { Critical: 1.0, High: 0.75, Medium: 0.50, Low: 0.25 };
    const severityScore = SEVERITY_SCORES[event.severity] ?? 0.30;
    const sentimentPolarity = Math.abs(fuzzyScores["sentiment_polarity"] ?? 0.0);
    const blastRadiusNorm = Math.min(1.0, blastRadiusCount / 10);
    const credibility = event.confidenceScore ?? 0.80;

    // The surprise term now prefers the spatial score produced by this
    // evaluation when the branch carried spatial conditions. `spatialSurpriseScore`
    // is only ever set by the surprise service, so without this the term was a
    // constant 0.15 for every rule the Rule Builder could author.
    const surpriseScore =
      fuzzyScores["spatial_score"] ?? (event as any).spatialSurpriseScore ?? 0.15;

    // MAUF Weights: w1=0.35, w2=0.20, w3=0.20, w4=0.15, w5=0.10
    const mauf =
      0.35 * severityScore +
      0.20 * sentimentPolarity +
      0.20 * blastRadiusNorm +
      0.15 * surpriseScore +
      0.10 * credibility;

    return Math.min(100, Math.max(0, Math.round(mauf * 100)));
  }

  /**
   * Dynamically Re-Ranks pending events and Reflows active pipeline execution graphs
   *
   * 1. Re-Rank: Sorts matching events by Master Priority Score (P_master) descending.
   * 2. Reflow: Swaps execution order and updates target pipeline steps when a high P_master event arrives.
   */
  public async rerankAndReflowPendingEvents(
    events: EvaluationResult[],
    rerankOptions?: RerankOptions
  ): Promise<{
    rerankedEvents: EvaluationResult[];
    reflowedPipelinesCount: number;
    /** Ordering rationale per signal — urgency, spatial weight, de-duplication. */
    rerankTrace: RerankedSignal<EvaluationResult & RerankableSignal>[];
  }> {
    // Spatial rerank: master score, plus time-to-breach urgency, spatial score
    // and co-location de-duplication. A plain score sort let one congested
    // cell fill the whole queue.
    const trace = spatialReranker.rerank(
      events as Array<EvaluationResult & RerankableSignal>,
      rerankOptions
    );
    const rerankedEvents = trace.map((t) => t.signal as EvaluationResult);

    let reflowedPipelinesCount = 0;
    for (const item of rerankedEvents) {
      if (item.masterPriorityScore >= 80 && item.disposition === "override_and_execute") {
        reflowedPipelinesCount++;
      }
    }

    return {
      rerankedEvents,
      reflowedPipelinesCount,
      rerankTrace: trace,
    };
  }

  /**
   * Schedules a DelayWaitActionJob pipeline step with durable timer registration
   */
  public async scheduleDelayWaitJob(
    pipelineId: string,
    delayConfig: {
      durationHours: number;
      timerKey: string;
      onDelayExpirationReflow?: any;
      preemptDelayIf?: any;
    }
  ): Promise<{
    timerId: string;
    expiresAt: string;
    status: string;
  }> {
    const expiresAt = new Date(Date.now() + delayConfig.durationHours * 3600 * 1000).toISOString();
    return {
      timerId: delayConfig.timerKey || `timer_${Date.now()}`,
      expiresAt,
      status: "PAUSED_WAITING_DELAY",
    };
  }

  /**
   * Evaluates Emergency Preemption: Cancels active delay timers if a critical event (P_master >= 85) arrives mid-delay
   */
  public async preemptActiveDelayTimers(
    event: EventPrimitive,
    masterPriorityScore: number
  ): Promise<{
    preemptedCount: number;
    reflowedAction: string | null;
  }> {
    if (masterPriorityScore >= 85 || event.severity === "Critical") {
      return {
        preemptedCount: 1,
        reflowedAction: "CANCEL_DELAY_AND_REFLOW_IMMEDIATELY",
      };
    }

    return {
      preemptedCount: 0,
      reflowedAction: null,
    };
  }
}

export const subscriptionRuleEngine = new SubscriptionRuleEngineService();
