/**
 * Agent Card Registry Schema
 * Specialized agent cards with model bindings for intent-based routing.
 */

import { sql } from "drizzle-orm";
import {
    pgTable,
    serial,
    integer,
    varchar,
    text,
    timestamp,
    boolean,
    jsonb,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { llmProviders, llmModels } from './ai/llm-router.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export const topicCategories = [
    'Code',
    'Real Estate',
    'Legal',
    'Media',
    'Finance',
    'Health',
    'General',
] as const;
export type TopicCategory = (typeof topicCategories)[number];

// Re-exported so server code importing from the schema barrel keeps working;
// the constant itself lives in a drizzle-free module the browser can import.
export { COPILOT_PERSONA_TYPE } from "../constants/agent-personas.js";

export const intentCategories = [
    'Image Generation',
    'Video',
    'Code Execution',
    'Analysis',
    'Alert',
    'Chat',
    'Search',
    'Document Authoring',
] as const;
export type IntentCategory = (typeof intentCategories)[number];

/**
 * Big Five (OCEAN) personality traits, each 0.0–1.0. Structurally identical to
 * SoulService.OceanTraits — declared here so the schema does not have to import
 * from a server-side service.
 */
export interface OceanTraitValues {
    /** Openness */
    o: number;
    /** Conscientiousness */
    c: number;
    /** Extraversion */
    e: number;
    /** Agreeableness */
    a: number;
    /** Neuroticism */
    n: number;
}

// ============================================================================
// AGENT CARDS TABLE
// ============================================================================

export const agentCards = pgTable("agent_cards", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    personaType: text("persona_type").notNull(),
    modelBindingProviderId: integer("model_binding_provider_id").references(
        () => llmProviders.id,
    ),
    modelBindingModelId: integer("model_binding_model_id").references(
        () => llmModels.id,
    ),
    capabilities: jsonb("capabilities")
        .$type<string[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    tools: jsonb("tools")
        .$type<string[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    topicAffinities: jsonb("topic_affinities")
        .$type<TopicCategory[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    /**
     * Learned declared-topic affinities: freeform `knowledge_topics` labels the
     * agent has tagged its own turns with, plus how often. Self-learning —
     * written when agent turns declare tags, read by hand-raise scoring so a
     * card that keeps tagging #[pricing] keeps surfacing for it. Distinct from
     * topicAffinities, which is the fixed-enum, operator-set routing list.
     */
    topicLabelAffinities: jsonb("topic_label_affinities")
        .$type<Array<{ label: string; count: number }>>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    intentAffinities: jsonb("intent_affinities")
        .$type<IntentCategory[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    // ── Soul layer ────────────────────────────────────────────────────────
    // An agent card's personality, mirroring the columns on agent_deployments.
    // They live here too because the card is the unit the intent router selects
    // and most cards have no deployment behind them at all.
    oceanTraits: jsonb("ocean_traits")
        .$type<OceanTraitValues>()
        .default(sql`'{"o":0.5,"c":0.5,"e":0.5,"a":0.5,"n":0.5}'::jsonb`)
        .notNull(),
    soulArchetype: text("soul_archetype"),
    /** First-person "Operational Philosophy" — how this agent describes itself. */
    legend: text("legend"),
    /** Durable send rules for this card, enforced by the outbound send gate —
     * e.g. "always review external email", "never contact customers". */
    approvalBoundary: text("approval_boundary"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
    orgIdx: index("idx_agent_cards_org").on(table.organizationId),
    enabledIdx: index("idx_agent_cards_enabled").on(table.organizationId, table.enabled),
    orgLowerNameUnique: uniqueIndex("agent_cards_org_lower_name_unique").using(
        'btree',
        table.organizationId,
        sql`lower(${table.name})`,
    ),
}));

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================

export const insertAgentCardSchema = createInsertSchema(agentCards, {
    name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or fewer"),
    description: z.string().min(1, "Description is required").max(500, "Description must be 500 characters or fewer"),
    personaType: z.string().min(1, "Persona type is required"),
    capabilities: z.array(z.string()).min(1, "At least one capability is required").max(20, "Maximum 20 capabilities allowed"),
    tools: z.array(z.string()).max(30, "Maximum 30 tools allowed").default([]),
    topicAffinities: z.array(z.enum(topicCategories)).max(10, "Maximum 10 topic affinities allowed").default([]),
    intentAffinities: z.array(z.enum(intentCategories)).max(10, "Maximum 10 intent affinities allowed").default([]),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

// ============================================================================
// EXPORTED TYPES
// ============================================================================

export type AgentCardRecord = typeof agentCards.$inferSelect;
/**
 * What a caller hands to agentCardService.create.
 *
 * The schema's INPUT, so fields carrying a default are optional, minus
 * organizationId, which create() stamps from its own argument. It was z.infer -
 * the OUTPUT - so every caller had to supply an organization the method ignores
 * and defaults it does not have.
 */
export type AgentCardCreateInput = Omit<z.input<typeof insertAgentCardSchema>, "organizationId">;

export type TopicAffinity = (typeof topicCategories)[number];
export type IntentAffinity = (typeof intentCategories)[number];
