import { pgTable, text, serial, timestamp, integer, doublePrecision, jsonb, index } from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";
import { missionRuns } from "../missions/runs.js";

/**
 * Memetic Graph: Institutional Memory for Mach 4.
 * Stores reusable "Strategy Memes" extracted from mission runs.
 */
export const memeticGraph = pgTable("memetic_graph", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id),
    
    // The "Meme" Identifier (e.g., 'auth_bypass_prevention', 'glassmorphism_standard_v2')
    key: text("key").notNull(),
    
    // Type of Knowledge: logic_pattern, ui_pattern, api_quirk, safety_rule
    type: text("type").notNull(),
    
    // The actual knowledge/strategy payload
    payload: jsonb("payload").notNull(),
    
    // Success metrics
    successCount: integer("success_count").default(0),
    failCount: integer("fail_count").default(0),
    confidence: doublePrecision("confidence").default(1.0),
    
    // Context for when to apply (e.g., { "techStack": "nextjs", "domain": "fintech" })
    context: jsonb("context"),

    // Mission Run Provenance — which run produced this meme
    missionRunId: integer("mission_run_id").references(() => missionRuns.id, { onDelete: "set null" }),
    
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_memetic_run").on(table.missionRunId),
]);


