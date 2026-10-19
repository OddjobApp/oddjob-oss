import { pgTable, serial, integer, text, decimal, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// ============================================================================
// EVAL MEASUREMENT SPINE
// Persisted eval history — the trust currency the autonomy ladder queries.
// A run records one execution of the eval suite; results record the per-subject
// pass-rate for each scenario in that run. History over `subject_key` × time is
// what makes regression detection (and, later, trust-gated autonomy) possible.
// ============================================================================

export const evalRuns = pgTable("eval_runs", {
    id: serial("id").primaryKey(),

    /** Git commit the suite ran against (null for ad-hoc local runs). */
    commitSha: text("commit_sha"),
    /** Which suite produced this run, e.g. "scenarios". */
    suite: text("suite").notNull().default("scenarios"),
    /** Model used for LLM-judged criteria, for reproducibility. */
    model: text("model"),

    totalScenarios: integer("total_scenarios").default(0).notNull(),
    passedScenarios: integer("passed_scenarios").default(0).notNull(),

    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),

    meta: jsonb("meta"),
});

export const evalResults = pgTable(
    "eval_results",
    {
        id: serial("id").primaryKey(),

        runId: integer("run_id")
            .notNull()
            .references(() => evalRuns.id, { onDelete: "cascade" }),

        // Subject under evaluation
        subjectKind: text("subject_kind").notNull(), // capability | skill | mission-type
        subjectRef: text("subject_ref").notNull(),
        subjectKey: text("subject_key").notNull(), // `${kind}:${ref}`

        scenarioId: text("scenario_id").notNull(),

        // Weighted pass-rate across repeats, in [0,1]
        passRate: decimal("pass_rate", { precision: 5, scale: 4 }).notNull(),
        threshold: decimal("threshold", { precision: 5, scale: 4 }).notNull(),
        passed: boolean("passed").notNull(),
        repeats: integer("repeats").default(1).notNull(),
        variance: decimal("variance", { precision: 6, scale: 5 }).default("0").notNull(),

        // Per-criterion breakdown for debugging a regression
        criteria: jsonb("criteria"),

        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (t) => ({
        // History lookups are always "this subject over time".
        subjectIdx: index("eval_results_subject_idx").on(t.subjectKey, t.createdAt),
        runIdx: index("eval_results_run_idx").on(t.runId),
    }),
);

export type EvalRun = typeof evalRuns.$inferSelect;
export type NewEvalRun = typeof evalRuns.$inferInsert;
export type EvalResultRow = typeof evalResults.$inferSelect;
export type NewEvalResultRow = typeof evalResults.$inferInsert;
