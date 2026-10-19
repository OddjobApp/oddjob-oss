import {
    pgTable,
    uuid,
    text,
    boolean,
    doublePrecision,
    integer,
    timestamp,
    index,
} from "drizzle-orm/pg-core";

export const sourcePerformanceLogs = pgTable("source_performance_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // e.g., "crunchbase", "github", "google"
    missionType: text("mission_type"), // e.g., "competitor research", "technical research"
    success: boolean("success").notNull().default(true),
    yieldedInfo: boolean("yielded_info").notNull().default(false),
    relevanceScore: doublePrecision("relevance_score").notNull().default(0),
    organizationId: integer("organization_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    sourceIdx: index("idx_source_perf_source").on(t.source),
    missionTypeIdx: index("idx_source_perf_mission_type").on(t.missionType),
    orgIdx: index("idx_source_perf_org").on(t.organizationId),
}));

export type SourcePerformanceLog = typeof sourcePerformanceLogs.$inferSelect;
export type InsertSourcePerformanceLog = typeof sourcePerformanceLogs.$inferInsert;


