import { createCalculationNodeSchema } from "@shared/schema/knowledge/calculations.js";

/**
 * Validation for POST /api/calculations.
 *
 * The route handed the raw body to createCalculation. A missing node or formula
 * reached the database and came back as an opaque 500, and an operation the
 * service does not evaluate (the palette's DYNAMIC_FORMULA, YOY_GROWTH,
 * MONTE_CARLO) could be saved as a node that never runs. The organization comes
 * from the session, so it is not part of the body.
 */
export const createCalculationBodySchema = createCalculationNodeSchema.omit({ organizationId: true });

export type CreateCalculationBody = ReturnType<typeof createCalculationBodySchema.parse>;

export type CreateCalculationBodyResult =
    | { ok: true; data: CreateCalculationBody }
    | { ok: false; issues: string[] };

export function parseCreateCalculationBody(body: unknown): CreateCalculationBodyResult {
    const result = createCalculationBodySchema.safeParse(body);
    if (result.success) return { ok: true, data: result.data };
    return {
        ok: false,
        issues: result.error.issues.map((issue) =>
            issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
        ),
    };
}
