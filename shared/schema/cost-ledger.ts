import { pgTable, serial, integer, text, decimal, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from "./auth.js";
import { agentDeployments } from "./agent-deployments.js";

// ============================================================================
// COST LEDGER
// Records a single LLM invocation's token usage + fiat cost per org/agent/mission.
// Enables per-agent monthly spend rollups and audit trails beyond
// orgSettings.currentMonthSpendUsd.
// ============================================================================

export const costLedger = pgTable("cost_ledger", {
    id: serial("id").primaryKey(),

    // Tenant context
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),

    // Optional agent attribution (null if system/background call)
    agentDeploymentId: integer("agent_deployment_id")
        .references(() => agentDeployments.id, { onDelete: "set null" }),

    // Optional mission attribution
    missionId: integer("mission_id"),

    // Session context (matches ai-client sessionId / missionRunId)
    sessionId: text("session_id"),

    // Model used
    model: text("model").notNull(),
    // Defaulted to "openai" — which is what made every unattributed row claim
    // an OpenAI call. "unknown" is the honest default; providerForModel()
    // derives the real one at the call site.
    provider: text("provider").notNull().default("unknown"), // 'openai' | 'anthropic' | 'google' | 'local' | 'unknown'

    // Token breakdown
    tokensPrompt: integer("tokens_prompt").default(0).notNull(),
    tokensCompletion: integer("tokens_completion").default(0).notNull(),
    tokensTotal: integer("tokens_total").default(0).notNull(),

    // USD cost (6 decimal precision for sub-cent accuracy)
    costUsd: decimal("cost_usd", { precision: 14, scale: 6 }).notNull().default("0.000000"),

    // Timestamp of the call
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (table) => [
    index("idx_cost_ledger_org_recorded").on(table.orgId, table.recordedAt),
    index("idx_cost_ledger_agent").on(table.agentDeploymentId),
    index("idx_cost_ledger_mission").on(table.missionId),
]);

export const insertCostLedgerSchema = createInsertSchema(costLedger, {
    model: z.string().min(1),
    costUsd: z.string().or(z.number()),
}).omit({ id: true, recordedAt: true });

export type CostLedgerEntry = typeof costLedger.$inferSelect;
export type InsertCostLedgerEntry = z.infer<typeof insertCostLedgerSchema>;
