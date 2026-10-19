import { pgTable, serial, integer, text, boolean, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";

export const predictionOutcomes = pgTable("prediction_outcomes", {
    id: serial("id").primaryKey(),
    missionRunId: integer("mission_run_id").notNull(),
    cycle: integer("cycle").notNull(),
    predictedTool: text("predicted_tool"),
    actualTool: text("actual_tool").notNull(),
    wasCorrect: boolean("was_correct").notNull().default(false),
    confidence: doublePrecision("confidence"),
    organizationId: integer("organization_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    runIdx: index("idx_prediction_outcomes_run").on(t.missionRunId),
    orgIdx: index("idx_prediction_outcomes_org").on(t.organizationId),
    createdIdx: index("idx_prediction_outcomes_created").on(t.createdAt),
}));


