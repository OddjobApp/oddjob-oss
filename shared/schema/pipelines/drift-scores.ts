import {
    pgTable,
    text,
    serial,
    timestamp,
    integer,
    doublePrecision,
    jsonb,
    index,
} from "drizzle-orm/pg-core";
import { pipelines } from './pipeline-core.js';
import { pipelineExecutions } from './pipeline-execution.js';
import { orgs } from '../auth.js';

export const driftScores = pgTable("drift_scores", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id),
    pipelineId: integer("pipeline_id").references(() => pipelines.id, { onDelete: "cascade" }),
    executionId: integer("execution_id").references(() => pipelineExecutions.id, { onDelete: "cascade" }),
    
    stepId: text("step_id"), // Optional: if we want per-step drift
    driftScore: doublePrecision("drift_score").notNull(), // 0.0 to 1.0 (1.0 = total drift)
    driftType: text("drift_type").notNull(), // 'semantic', 'structural', 'data'
    
    metadata: jsonb("metadata"), // Details about what drifted
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    pipelineIdx: index("idx_drift_pipeline").on(table.pipelineId),
    orgIdx: index("idx_drift_org").on(table.organizationId),
}));

export type DriftScore = typeof driftScores.$inferSelect;
export type InsertDriftScore = typeof driftScores.$inferInsert;


