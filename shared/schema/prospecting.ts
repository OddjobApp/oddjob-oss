import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

// ============================================================================
// PROSPECT PROPERTIES (Multi-Property Management)
// ============================================================================

export const prospectProperties = pgTable("prospect_properties", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    uid: text("uid").notNull().unique(), // The API Key / Property ID for the harness
    name: text("name").notNull(),
    domain: text("domain"),

    // Persona & UI Config
    personaAgentId: text("persona_agent_id"),
    personaPromptOverride: text("persona_prompt_override"),
    uiConfig: jsonb("ui_config").$type<{
        hydration: "on_load" | "on_intervention";
        themeColor?: string;
        position?: "bottom-right" | "bottom-left";
    }>().default({ hydration: "on_intervention" }).notNull(),

    // De-anonymization rules. null/absent â†’ service defaults (current behavior).
    deanonConfig: jsonb("deanon_config").$type<{
        enabled?: boolean;                  // master switch (default true)
        providerChain?: string[];           // ordered MCP tool-name fragments to try, in priority order
        excludeIpPrefixes?: string[];       // skip IPs starting with any of these (beyond localhost/private)
        minConfidence?: number;             // 0-1; drop enrichment matches below this confidence
        icp?: {                             // only surface companies matching ICP
            industries?: string[];          // case-insensitive substring allowlist
            countries?: string[];           // case-insensitive allowlist (name or code)
            minEmployees?: number;
            maxEmployees?: number;
        };
        trigger?: "first_event" | "score_threshold";  // when to enrich (default first_event)
        scoreThreshold?: number;            // required total S.C.O.R.E. when trigger=score_threshold
    }>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("prospect_prop_org_idx").on(table.organizationId),
}));

export const insertProspectPropertySchema = createInsertSchema(prospectProperties);
export const selectProspectPropertySchema = createSelectSchema(prospectProperties);

export type ProspectProperty = typeof prospectProperties.$inferSelect;
export type InsertProspectProperty = typeof prospectProperties.$inferInsert;

// ============================================================================
// PROSPECT PROFILES (Visitor Attribution)
// ============================================================================

export const prospectProfiles = pgTable("prospect_profiles", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => prospectProperties.id, { onDelete: "cascade" }),
    uid: text("uid").notNull().unique(), // The oj_prospect_id cookie value or device ID
    userId: text("user_id"), // Linked user ID after identification

    // Attributed Behavioral Data
    attributedThemes: jsonb("attributed_themes").$type<string[]>().default([]).notNull(),
    attributedConcepts: jsonb("attributed_concepts").$type<string[]>().default([]).notNull(),

    metadata: jsonb("metadata").default({}).notNull(),

    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgUidIdx: index("prospect_profile_org_uid_idx").on(table.organizationId, table.uid),
    propIdx: index("prospect_profile_prop_idx").on(table.propertyId),
    userIdIdx: index("prospect_profile_user_idx").on(table.userId),
}));

export const insertProspectProfileSchema = createInsertSchema(prospectProfiles);
export const selectProspectProfileSchema = createSelectSchema(prospectProfiles);

export type ProspectProfile = typeof prospectProfiles.$inferSelect;
export type InsertProspectProfile = typeof prospectProfiles.$inferInsert;

// ============================================================================
// PROSPECT LEADS (Persistent Scoring & Qualification)
// ============================================================================

export const prospectLeads = pgTable("prospect_leads", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    profileId: integer("profile_id").references(() => prospectProfiles.id, { onDelete: "cascade" }).notNull(),

    // BANT Aggregate State (Mapped to S.C.O.R.E.)
    bantScore: jsonb("bant_score").$type<{
        S: number; // Budget
        C: number; // Authority
        O: number; // Need
        R: number; // Timeline
        E: number; // Effect
    }>().default({ S: 0, C: 0, O: 0, R: 0, E: 0 }).notNull(),

    status: text("status").$type<"anonymous" | "identified" | "qualified" | "converted">().default("anonymous").notNull(),
    lastScoreUpdate: timestamp("last_score_update").defaultNow().notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    profileIdx: index("prospect_lead_profile_idx").on(table.profileId),
    orgIdx: index("prospect_lead_org_idx").on(table.organizationId),
}));

export const insertProspectLeadSchema = createInsertSchema(prospectLeads);
export const selectProspectLeadSchema = createSelectSchema(prospectLeads);

export type ProspectLead = typeof prospectLeads.$inferSelect;
export type InsertProspectLead = typeof prospectLeads.$inferInsert;

// ============================================================================
// PROSPECT EVENTS (Behavioral Analytics)
// ============================================================================

export const prospectEvents = pgTable("prospect_events", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    propertyId: integer("property_id").references(() => prospectProperties.id, { onDelete: "cascade" }),
    profileId: integer("profile_id").references(() => prospectProfiles.id, { onDelete: "cascade" }).notNull(),
    sessionId: text("session_id").notNull(),

    activity: text("activity").notNull(), // e.g., 'page_view', 'click', 'scroll', 'dwell'
    url: text("url"),
    payload: jsonb("payload").default({}).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    profileIdx: index("prospect_event_profile_idx").on(table.profileId),
    orgIdx: index("prospect_event_org_idx").on(table.organizationId),
    typeIdx: index("prospect_event_type_idx").on(table.activity),
}));

// ============================================================================
// PAGE CONCEPT VOCABULARY (URL → concepts/topics)
// ============================================================================

/**
 * Durable per-URL concept resolution for a property.
 *
 * Concept resolution is a per-URL cost, not a per-event one: a property has
 * hundreds of distinct URLs and potentially millions of events. This is the L2
 * cache behind the in-process one in concept-resolver.ts — necessary because
 * ingest runs in a BullMQ worker at concurrency 20 (and potentially several
 * processes), so an in-memory-only cache would miss constantly and re-resolve.
 *
 * `normalizedUrl` is the output of normalizeUrl(): tracking params stripped,
 * fragment dropped, params sorted. Storing the raw URL would fragment one page
 * into a row per campaign tag and defeat the purpose.
 */
export const prospectPageConcepts = pgTable("prospect_page_concepts", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    /** Project Space scoping, mirroring knowledge_concepts. NULL = org-wide. */
    projectId: integer("project_id"),
    propertyId: integer("property_id").references(() => prospectProperties.id, { onDelete: "cascade" }),

    normalizedUrl: text("normalized_url").notNull(),
    pageTitle: text("page_title"),

    concepts: jsonb("concepts").$type<string[]>().default([]).notNull(),
    topics: jsonb("topics").$type<string[]>().default([]).notNull(),

    /** How this row was produced: 'heuristic' | 'llm' | 'ml' | 'manual'. */
    source: text("source").default("heuristic").notNull(),
    /** Model/version provenance, so a backfill can re-derive a single source. */
    resolverVersion: text("resolver_version"),

    resolvedAt: timestamp("resolved_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    lookupIdx: index("prospect_page_concepts_lookup_idx")
        .on(table.organizationId, table.propertyId, table.normalizedUrl),
    orgIdx: index("prospect_page_concepts_org_idx").on(table.organizationId),
}));

export const insertProspectPageConceptSchema = createInsertSchema(prospectPageConcepts);
export type ProspectPageConcept = typeof prospectPageConcepts.$inferSelect;
export type InsertProspectPageConcept = typeof prospectPageConcepts.$inferInsert;

export const insertProspectEventSchema = createInsertSchema(prospectEvents);
export const selectProspectEventSchema = createSelectSchema(prospectEvents);

export type ProspectEvent = typeof prospectEvents.$inferSelect;
export type InsertProspectEvent = typeof prospectEvents.$inferInsert;



