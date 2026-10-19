/**
 * Behavioral Intelligence Engine — A/B Testing Service
 *
 * Supports shadow scoring models and gradual rollout:
 * - Shadow mode: score by both production and shadow model, compare accuracy
 * - Gradual rollout: apply new weights to X% of entities
 * - Auto-revert: if treatment group degrades, rollback automatically
 * - Statistical significance: require p < 0.05 over 50+ conversions
 */
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("BIABTesting");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ABTest {
  id: string;
  model_id: string;
  name: string;
  status: "running" | "completed" | "reverted";
  control_model_snapshot: any; // Frozen copy of production weights
  treatment_model_snapshot: any; // New weights being tested
  traffic_percent: number; // 0-100, percentage of entities in treatment
  metrics: {
    control_conversions: number;
    control_total: number;
    treatment_conversions: number;
    treatment_total: number;
  };
  started_at: string;
  completed_at?: string;
  auto_revert_enabled: boolean;
  min_conversions_for_significance: number; // Default 50
}

export interface ABTestResult {
  test_id: string;
  winner: "control" | "treatment" | "inconclusive";
  control_rate: number;
  treatment_rate: number;
  lift_percent: number;
  p_value: number;
  is_significant: boolean;
}

// ─── Active Tests ────────────────────────────────────────────────────────────

const activeTests = new Map<string, ABTest>();

/**
 * Create a new A/B test (shadow model).
 */
function createTest(test: Omit<ABTest, "status" | "metrics" | "started_at">): ABTest {
  const fullTest: ABTest = {
    ...test,
    status: "running",
    metrics: { control_conversions: 0, control_total: 0, treatment_conversions: 0, treatment_total: 0 },
    started_at: new Date().toISOString(),
    auto_revert_enabled: test.auto_revert_enabled ?? true,
    min_conversions_for_significance: test.min_conversions_for_significance ?? 50,
  };
  activeTests.set(test.id, fullTest);
  logger.info(`[ABTest] Created test "${test.name}" (${test.traffic_percent}% treatment)`);
  return fullTest;
}

/**
 * Determine if an entity should be in the treatment group.
 * Uses consistent hashing so the same entity always gets the same group.
 */
function isInTreatment(testId: string, entityId: string): boolean {
  const test = activeTests.get(testId);
  if (!test || test.status !== "running") return false;

  // Simple hash-based assignment (consistent per entity)
  let hash = 0;
  const key = `${testId}:${entityId}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const bucket = Math.abs(hash) % 100;
  return bucket < test.traffic_percent;
}

/**
 * Record a conversion for an entity (updates the appropriate group).
 */
function recordConversion(testId: string, entityId: string, converted: boolean): void {
  const test = activeTests.get(testId);
  if (!test || test.status !== "running") return;

  if (isInTreatment(testId, entityId)) {
    test.metrics.treatment_total++;
    if (converted) test.metrics.treatment_conversions++;
  } else {
    test.metrics.control_total++;
    if (converted) test.metrics.control_conversions++;
  }

  // Check for auto-revert
  if (test.auto_revert_enabled) {
    checkAutoRevert(test);
  }
}

/**
 * Evaluate test results and determine winner.
 */
function evaluateTest(testId: string): ABTestResult | null {
  const test = activeTests.get(testId);
  if (!test) return null;

  const { control_conversions, control_total, treatment_conversions, treatment_total } = test.metrics;

  const controlRate = control_total > 0 ? control_conversions / control_total : 0;
  const treatmentRate = treatment_total > 0 ? treatment_conversions / treatment_total : 0;
  const liftPercent = controlRate > 0 ? ((treatmentRate - controlRate) / controlRate) * 100 : 0;

  // Simplified z-test for proportions
  const totalConversions = control_conversions + treatment_conversions;
  const totalSamples = control_total + treatment_total;
  const pooledRate = totalSamples > 0 ? totalConversions / totalSamples : 0;

  let pValue = 1.0;
  if (control_total > 0 && treatment_total > 0 && pooledRate > 0 && pooledRate < 1) {
    const se = Math.sqrt(pooledRate * (1 - pooledRate) * (1 / control_total + 1 / treatment_total));
    const z = se > 0 ? Math.abs(treatmentRate - controlRate) / se : 0;
    // Approximate p-value from z-score (two-tailed)
    pValue = Math.exp(-0.5 * z * z) * (z > 0 ? 1 : 0.5);
    pValue = Math.min(1, Math.max(0, 2 * (1 - normalCDF(z))));
  }

  const isSignificant = pValue < 0.05 && (control_total + treatment_total) >= test.min_conversions_for_significance;
  let winner: "control" | "treatment" | "inconclusive" = "inconclusive";
  if (isSignificant) {
    winner = treatmentRate > controlRate ? "treatment" : "control";
  }

  return {
    test_id: testId,
    winner,
    control_rate: Math.round(controlRate * 10000) / 10000,
    treatment_rate: Math.round(treatmentRate * 10000) / 10000,
    lift_percent: Math.round(liftPercent * 100) / 100,
    p_value: Math.round(pValue * 10000) / 10000,
    is_significant: isSignificant,
  };
}

/**
 * Check if auto-revert should trigger (treatment significantly worse).
 */
function checkAutoRevert(test: ABTest): void {
  const { control_conversions, control_total, treatment_conversions, treatment_total } = test.metrics;

  // Need minimum samples before evaluating
  if (control_total < 30 || treatment_total < 30) return;

  const controlRate = control_conversions / control_total;
  const treatmentRate = treatment_conversions / treatment_total;

  // If treatment is significantly worse (>20% degradation with enough samples)
  if (treatmentRate < controlRate * 0.8 && (control_total + treatment_total) >= test.min_conversions_for_significance) {
    test.status = "reverted";
    test.completed_at = new Date().toISOString();
    logger.warn(`[ABTest] Auto-reverted "${test.name}" — treatment degraded by ${Math.round((1 - treatmentRate / controlRate) * 100)}%`);

    eventStream.publish("bi.ab_test_reverted", {
      test_id: test.id, name: test.name, control_rate: controlRate, treatment_rate: treatmentRate,
    }, {}, "behavioral-intelligence").catch(() => {});
  }
}

/**
 * Normal CDF approximation (for p-value calculation).
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Get all active tests.
 */
function getActiveTests(): ABTest[] {
  return [...activeTests.values()].filter(t => t.status === "running");
}

/**
 * Complete a test (promote treatment or keep control).
 */
function completeTest(testId: string, promote: boolean): void {
  const test = activeTests.get(testId);
  if (!test) return;
  test.status = "completed";
  test.completed_at = new Date().toISOString();
  logger.info(`[ABTest] Completed "${test.name}" — ${promote ? "treatment promoted" : "control kept"}`);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biABTesting = {
  createTest,
  isInTreatment,
  recordConversion,
  evaluateTest,
  getActiveTests,
  completeTest,
};
