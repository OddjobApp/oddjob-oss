import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { hilForms } from "@shared/schema/index.js";
import type { CohortValues, StudioDefinition } from "@shared/form-studio.js";
import { computeCohorts } from "@shared/form-studio-cohorts.js";

/** The most recent completed responses a cohort metric covers; each metric says how many it used. */
export const COHORT_RESPONSE_LIMIT = 10_000;

/**
 * Cohort metrics for evaluating a response to `formId`, over that form's completed
 * responses in the same organization, matched by equality and never by a
 * null-organization fallback. Responses still being filled in, including the one
 * being evaluated, are not part of any cohort.
 */
export async function cohortValuesFor(formId: number, organizationId: number | null, definition: StudioDefinition, now = new Date()): Promise<CohortValues> {
  if (!definition.studio.cohorts.length || organizationId == null) return {};
  const rows = await db.select({ data: hilForms.data }).from(hilForms).where(and(
    eq(hilForms.kind, "response"),
    eq(hilForms.organizationId, organizationId),
    eq(hilForms.status, "completed"),
    sql`${hilForms.config}->'formStudioResponse'->>'formId' = ${String(formId)}`,
  )).orderBy(desc(hilForms.submittedAt)).limit(COHORT_RESPONSE_LIMIT);
  return computeCohorts(definition, rows.map((row) => (row.data ?? {}) as Record<string, unknown>), now);
}
