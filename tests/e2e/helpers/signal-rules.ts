import type { APIRequestContext } from "@playwright/test";

/**
 * Rule-suite authoring and dry-run helpers.
 *
 * Predicate behaviour is verified through
 * `POST /api/rule-suites/:suiteId/rules/:ruleId/evaluate` rather than by firing
 * live signals, for one reason: the dry run returns the full `spatialTrace` —
 * per-condition `passed`, `observed`, `unit` and a human-readable
 * `explanation`. A live evaluation persists only an audit row with the
 * aggregate scores, so asserting "the precision gate rejected this fix BECAUSE
 * the position is unknown rather than outside" is only possible here.
 *
 * Live firing is still exercised where it is the thing under test — that a rule
 * reaches the engine at all, and writes an audit.
 */

export const E2E_SUITE_ID = "e2e-spatial-suite";

export interface ThenAction {
  deliveryMode: string;
  receiverBinding?: Record<string, unknown>;
  missionBlueprint?: Record<string, unknown>;
}

export interface RuleBranch {
  branchId: string;
  branchName: string;
  matchStrategy: "ALL" | "ANY";
  conditions: Array<Record<string, unknown>>;
  thenAction: ThenAction;
}

export interface RuleSpec {
  ruleId: string;
  ruleName: string;
  enabled?: boolean;
  priorityWeight?: number;
  ifBranch: RuleBranch;
  elseIfBranches?: RuleBranch[];
  elseBranch?: { thenAction: { deliveryMode: string; logReason: string } };
}

export interface SpatialConditionResultTrace {
  passed: boolean;
  score: number;
  weight: number;
  critical: boolean;
  observed?: number;
  unit?: string;
  explanation: string;
  persistence?: {
    hits: number;
    misses: number;
    required: number;
    latched: boolean;
    pending: boolean;
  };
  groups?: Array<{
    name: string;
    passed: boolean;
    matchedCells: string[];
    totalCells: number;
    matchRatio: number;
    explanation: string;
  }>;
}

export interface DryRunResult {
  ruleId: string;
  matched: boolean;
  matchedBranch: string;
  masterPriorityScore: number;
  disposition: string;
  spatialScore?: number;
  spatialTrace?: SpatialConditionResultTrace[];
  fuzzyScores: Record<string, number>;
}

/** Creates the shared suite, tolerating a suite left behind by a previous run. */
export async function ensureSuite(
  request: APIRequestContext,
  suiteId = E2E_SUITE_ID,
): Promise<void> {
  const res = await request.post("/api/rule-suites", {
    data: {
      suiteId,
      suiteName: "E2E Spatial Suite",
      category: "Supply Chain & Logistics",
      description: "Fixture suite for the spatial-signal E2E scenarios",
      // ALL_MATCHES so one signal can exercise several rules in a single pass;
      // FIRST_MATCH would stop after the highest-weighted one and hide the rest.
      executionPolicy: "ALL_MATCHES",
      enabled: true,
    },
  });
  if (res.status() !== 201 && res.status() !== 409) {
    throw new Error(`Rule suite create failed (${res.status()}): ${await res.text()}`);
  }
}

/** Upserts a rule into the suite. */
export async function putRule(
  request: APIRequestContext,
  rule: RuleSpec,
  suiteId = E2E_SUITE_ID,
): Promise<void> {
  const res = await request.put(`/api/rule-suites/${suiteId}/rules/${rule.ruleId}`, { data: rule });
  if (res.status() !== 200 && res.status() !== 201) {
    throw new Error(
      `Rule upsert failed (${res.status()}): ${await res.text()}\nrule: ${JSON.stringify(rule)}`,
    );
  }
}

/** Deletes a rule, so a scenario can stop it firing on later signals. */
export async function deleteRule(
  request: APIRequestContext,
  ruleId: string,
  suiteId = E2E_SUITE_ID,
): Promise<void> {
  await request.delete(`/api/rule-suites/${suiteId}/rules/${ruleId}`);
}

/** Runs a rule against a sample event without writing an audit or firing it. */
export async function dryRun(
  request: APIRequestContext,
  ruleId: string,
  sampleEvent: Record<string, unknown>,
  suiteId = E2E_SUITE_ID,
): Promise<DryRunResult> {
  const res = await request.post(`/api/rule-suites/${suiteId}/rules/${ruleId}/evaluate`, {
    data: { sampleEvent },
  });
  if (!res.ok()) {
    throw new Error(
      `Dry run failed (${res.status()}): ${await res.text()}\nsample: ${JSON.stringify(sampleEvent)}`,
    );
  }
  return (await res.json()) as DryRunResult;
}

/**
 * Authors a rule whose IF branch is a single condition, then dry-runs it.
 *
 * Most of the criteria matrix is "does THIS condition, on THIS telemetry,
 * pass?" — a one-condition rule keeps the answer attributable. A multi-condition
 * rule that fails tells you the branch failed, not which condition did.
 */
export async function evaluateCondition(
  request: APIRequestContext,
  ruleId: string,
  condition: Record<string, unknown>,
  sampleEvent: Record<string, unknown>,
  matchStrategy: "ALL" | "ANY" = "ALL",
): Promise<DryRunResult> {
  await putRule(request, {
    ruleId,
    ruleName: ruleId,
    enabled: true,
    priorityWeight: 50,
    ifBranch: {
      branchId: `${ruleId}-if`,
      branchName: "IF",
      matchStrategy,
      conditions: [condition],
      thenAction: { deliveryMode: "context_only" },
    },
  });
  try {
    return await dryRun(request, ruleId, sampleEvent);
  } finally {
    // The rule is scaffolding for one dry run, but it lands in a live, enabled
    // suite. Left behind, the ~40 probe rules this suite authors would all be
    // evaluated against every subsequently injected signal — polluting the
    // audit table the live scenarios assert on, and slowing every ingest.
    await deleteRule(request, ruleId);
  }
}

/** The single spatial trace entry for a one-condition rule. */
export function soleTrace(result: DryRunResult): SpatialConditionResultTrace {
  const trace = result.spatialTrace;
  if (!trace?.length) {
    throw new Error(
      `Expected a spatial trace on rule ${result.ruleId}, got none. ` +
        "A condition the engine did not recognise as spatial produces no trace.",
    );
  }
  return trace[0];
}
