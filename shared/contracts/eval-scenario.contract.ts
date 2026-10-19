import { z } from "zod";

/**
 * Eval Measurement Spine — interchange contracts.
 * ===============================================
 * The shared vocabulary for Phase 00: what an eval scenario is, what a subject
 * is, and the committed baseline the regression gate compares against. See the
 * "Measurement Spine" implementation plan.
 */

/** What an eval measures. Every scenario resolves to exactly one subject. */
export const evalSubjectKindSchema = z.enum(["capability", "skill", "mission-type"]);
export type EvalSubjectKind = z.infer<typeof evalSubjectKindSchema>;

export const evalSubjectSchema = z.object({
    kind: evalSubjectKindSchema,
    /** Tool name, skill name, or mission-type id. */
    ref: z.string().min(1),
});
export type EvalSubject = z.infer<typeof evalSubjectSchema>;

/** One expected outcome of a scenario run. Weighted for partial credit. */
export const evalCriterionSchema = z.object({
    type: z.enum(["tool_used", "final_output_contains", "llm_judge"]),
    value: z.string().min(1),
    weight: z.number().positive().default(1),
});
export type EvalCriterion = z.infer<typeof evalCriterionSchema>;

/**
 * A scenario as authored on disk. Backward compatible with the original shape
 * (`expected_criteria`, no `subject`): legacy files default to a mission-type
 * subject keyed by their id, a single repeat, and an all-must-pass threshold.
 */
export const evalScenarioSchema = z
    .object({
        id: z.string().min(1),
        name: z.string().min(1),
        prompt: z.string().min(1),
        subject: evalSubjectSchema.optional(),
        /** How many times to run the scenario, to measure through LLM jitter. */
        repeats: z.number().int().positive().max(20).default(1),
        /** Minimum weighted pass-rate for the scenario to count as passed. */
        threshold: z.number().min(0).max(1).default(1),
        criteria: z.array(evalCriterionSchema).optional(),
        /** Legacy field name — folded into `criteria`. */
        expected_criteria: z.array(evalCriterionSchema).optional(),
    })
    .transform((s) => ({
        id: s.id,
        name: s.name,
        prompt: s.prompt,
        repeats: s.repeats,
        threshold: s.threshold,
        subject: s.subject ?? { kind: "mission-type" as const, ref: s.id },
        criteria: s.criteria ?? s.expected_criteria ?? [],
    }))
    .refine((s) => s.criteria.length > 0, {
        message: "scenario must declare at least one criterion",
    });
export type EvalScenario = z.infer<typeof evalScenarioSchema>;

/** One entry in the committed baseline: the last-known-good pass-rate for a subject. */
export const evalBaselineEntrySchema = z.object({
    subjectKey: z.string().min(1), // `${kind}:${ref}`
    passRate: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1).default(0.8),
});
export type EvalBaselineEntry = z.infer<typeof evalBaselineEntrySchema>;

export const evalBaselineSchema = z.object({
    updatedAt: z.string().optional(),
    commit: z.string().optional(),
    /** Allowed drop below a subject's baseline before the gate fails. */
    regressionDelta: z.number().min(0).max(1).default(0.05),
    /** Threshold applied to subjects with no baseline entry yet. */
    defaultThreshold: z.number().min(0).max(1).default(0.8),
    subjects: z.array(evalBaselineEntrySchema),
});
export type EvalBaseline = z.infer<typeof evalBaselineSchema>;

/** Aggregated pass-rate for one subject across all its scenarios. */
export interface SubjectPassRate {
    subjectKey: string;
    subject: EvalSubject;
    passRate: number;
    scenarioCount: number;
}
