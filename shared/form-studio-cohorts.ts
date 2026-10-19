import { tryEvaluateExpression } from "./form-expression";
import type { CohortValues, StudioDefinition } from "./form-studio";

/**
 * Cohort metrics: numbers about a form's earlier completed responses that its
 * formulas, rules and result blocks can read, such as how many candidates were
 * certified ready now, or the average readiness index of those who were.
 *
 * A metric counts only the responses its condition holds for, and a response
 * whose condition cannot be answered (it never had that field) does not count. A
 * sum, average, minimum or maximum over no responses has no value rather than 0,
 * and every metric says how many responses it covers and when it was computed, so
 * a gate built on a cohort of three is visibly built on three.
 *
 * Pure: the server reads the responses (form-studio-cohorts.service.ts).
 */

const truthy = (value: unknown) => !!value && value !== "0" && value !== "false" && value !== 0;

export function computeCohorts(def: StudioDefinition, responses: Array<Record<string, unknown>>, asOf: Date): CohortValues {
  const at = asOf.toISOString();
  const metrics: CohortValues = {};
  for (const cohort of def.studio.cohorts) {
    const matching = cohort.where
      ? responses.filter((response) => {
          const outcome = tryEvaluateExpression(cohort.where!, response);
          return outcome.ok && truthy(outcome.value);
        })
      : responses;
    if (cohort.aggregate === "count") {
      metrics[cohort.id] = { value: matching.length, rows: matching.length, asOf: at };
      continue;
    }
    const numbers = matching
      .map((response) => response[cohort.field ?? ""])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    let value: number | "" = "";
    if (numbers.length) {
      switch (cohort.aggregate) {
        case "sum": value = numbers.reduce((total, n) => total + n, 0); break;
        case "avg": value = numbers.reduce((total, n) => total + n, 0) / numbers.length; break;
        case "min": value = numbers.reduce((low, n) => Math.min(low, n), Infinity); break;
        case "max": value = numbers.reduce((high, n) => Math.max(high, n), -Infinity); break;
      }
    }
    metrics[cohort.id] = { value, rows: numbers.length, asOf: at };
  }
  return metrics;
}
