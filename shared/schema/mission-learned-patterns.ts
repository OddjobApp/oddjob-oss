import { pgTable, serial, varchar, integer, real, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Mission patterns learned from outcomes.
 *
 * The built-in patterns in predictive-planning.service.ts are seeded domain
 * knowledge and stay in code. Anything the platform infers from a tenant's own
 * missions lands here instead, for two reasons:
 *
 *   1. It used to be pushed onto a module-level array, so every learned pattern
 *      was lost on restart — the "learning" was for the lifetime of a process.
 *   2. A pattern inferred from one tenant's missions must not steer another's
 *      planning, so these are organization-scoped rather than global.
 */
export const missionLearnedPatterns = pgTable("mission_learned_patterns", {
    id: serial("id").primaryKey(),

    /** Stable public id, matching the MissionPattern.id shape used in code. */
    patternKey: varchar("pattern_key", { length: 120 }).notNull(),

    organizationId: integer("organization_id").notNull(),

    name: varchar("name", { length: 200 }).notNull(),
    /** Regex source matched against a mission objective. */
    objectivePattern: varchar("objective_pattern", { length: 500 }).notNull(),

    pipelineSequence: jsonb("pipeline_sequence").notNull(),
    commonTools: jsonb("common_tools").notNull(),
    riskFactors: jsonb("risk_factors").notNull(),

    estimatedDuration: real("estimated_duration").notNull(),
    successRate: real("success_rate").notNull(),
    avgToolCalls: real("avg_tool_calls").notNull(),

    /** Provenance: how many missions this was inferred from, and how sure we are. */
    sampleSize: integer("sample_size").notNull().default(0),
    confidence: real("confidence").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("mission_learned_patterns_org_idx").on(table.organizationId),
    keyIdx: index("mission_learned_patterns_key_idx").on(table.patternKey),
}));

export type MissionLearnedPattern = typeof missionLearnedPatterns.$inferSelect;
export type InsertMissionLearnedPattern = typeof missionLearnedPatterns.$inferInsert;
