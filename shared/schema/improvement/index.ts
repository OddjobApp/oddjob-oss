/**
 * Improvement domain schema barrel.
 *
 * `opportunities.ts` — the evidence spine: opportunities, immutable
 *                      observations, and hypotheses.
 * `experiments.ts`   — bounded, pre-registered experiments and their computed
 *                      results. Change sets follow in a later milestone.
 * `workflow-events.ts` — the canonical workflow event, the only input the
 *                      measurement service reads.
 * `change-sets.ts`   — immutable typed mutation proposals; approval binds to
 *                      their content hash, never to the row.
 */

export * from "./opportunities.js";
export * from "./experiments.js";
export * from "./workflow-events.js";
export * from "./change-sets.js";
export * from "./target-versions.js";
