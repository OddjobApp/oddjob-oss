import { pgTable, serial, text, integer, timestamp, decimal, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';
import { missions } from './missions/core.js';
import { missionRuns } from './missions/runs.js';
import { knowledgeNodes } from './knowledge/graph.js';

// ============================================================================
// RESCUE SESSIONS (The "Rescue Shadow")
// ============================================================================

export const rescueSessions = pgTable("rescue_sessions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id),
    missionId: integer("mission_id").references(() => missions.id),
    missionRunId: integer("mission_run_id").references(() => missionRuns.id),
    publicToken: text("public_token").unique(),

    // Operational State
    status: text("status", { enum: ["ACTIVE", "REQUESTED", "TRIAGED", "OFFERED", "ACCEPTED", "ENROUTE", "ARRIVED", "ASSISTING", "RELAY_ENROUTE", "COMPLETED", "FAILED", "CANCELLED"] }).notNull().default("REQUESTED"),
    serviceType: text("service_type").notNull(), // e.g., "tow", "medical", "security"
    source: text("source"), // e.g., "manual", "alert_auto_rescue"
    failureContext: text("failure_context"), // Description of the failure
    severity: text("severity"), // e.g., "P1", "P2", "P3"

    // User Info
    userLocation: jsonb("user_location").$type<{ lat: number; lng: number; address?: string; resolvedBy: 'gps' | 'map' | 'manual' }>().notNull(),
    secondaryDestination: jsonb("secondary_destination").$type<{ lat: number; lng: number; address?: string }>(),

    // Provider Info
    providerId: text("provider_id"), // Linked to Rescue Helper Dataset Row ID
    providerName: text("provider_name"),
    providerLocation: jsonb("provider_location").$type<{ lat: number; lng: number }>(),

    // Protocol & Safety
    arrivalHandshakeHash: text("arrival_handshake_hash"), // HMAC or hash of the verification secret
    arrivalProtocolVerified: boolean("arrival_protocol_verified").default(false).notNull(),

    // Config
    isDemoMode: boolean("is_demo_mode").default(false).notNull(),
    metadata: jsonb("metadata").default({}),

    // Triage & Recovery (Rescue 2.0)
    recoveryOptions: jsonb("recovery_options").$type<Array<{
        id: string;
        label: string;
        description: string;
        successProbability: number;
        actionType: 'manual_takeover' | 'relax_constrai.js' | 'reroute_knowledge' | 'approve_tool' | 'reject_tool';
        params?: any;
    }>>().default([]).notNull(),
    triageSummary: text("triage_summary"),
    // Knowledge Linkage: Link to the specific node that triggered the failure or needs to be "rerouted"
    culpritNodeId: integer("culprit_node_id").references(() => knowledgeNodes.id, { onDelete: "set null" }),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
});

export const insertRescueSessionSchema = createInsertSchema(rescueSessions);
export type RescueSession = typeof rescueSessions.$inferSelect;
export type InsertRescueSession = typeof rescueSessions.$inferInsert;

// ============================================================================
// RESCUE TELEMETRY (The "Black Box")
// ============================================================================

export const rescueTelemetry = pgTable("rescue_telemetry", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").references(() => rescueSessions.id, { onDelete: "cascade" }).notNull(),

    // Entity performing the movement
    entityType: text("entity_type", { enum: ["provider", "user"] }).notNull(),
    entityId: text("entity_id").notNull(),

    // Spatial Data
    lat: decimal("lat", { precision: 10, scale: 7 }).notNull(),
    lng: decimal("lng", { precision: 10, scale: 7 }).notNull(),
    accuracy: decimal("accuracy", { precision: 5, scale: 2 }), // in meters
    heading: decimal("heading", { precision: 5, scale: 2 }), // degrees
    speed: decimal("speed", { precision: 5, scale: 2 }), // m/s

    // Blockchain/Forensic Metadata
    clientTimestamp: timestamp("client_timestamp").notNull(), // When it was captured on device
    serverTimestamp: timestamp("server_timestamp").defaultNow().notNull(), // When it hit our server
    signature: text("signature"), // Cryptographic signature from the device (optional/future)

    // Contextual Data
    metadata: jsonb("metadata").default({}), // Energy status, connectivity, etc.
});

export const insertRescueTelemetrySchema = createInsertSchema(rescueTelemetry);
export type RescueTelemetry = typeof rescueTelemetry.$inferSelect;
export type InsertRescueTelemetry = typeof rescueTelemetry.$inferInsert;

// ============================================================================
// RESCUE AUDIT EVENTS (The Forensic Log)
// ============================================================================

export const rescueEvents = pgTable("rescue_events", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").references(() => rescueSessions.id, { onDelete: "cascade" }).notNull(),

    eventType: text("event_type").notNull(), // e.g. "STATUS_CHANGE", "VERIFICATION_SUCCESS", "PROVIDER_ASSIGNED"
    previousStatus: text("previous_status"),
    newStatus: text("new_status"),

    actorId: text("actor_id"), // Who triggered it (system, provider, user)
    actorType: text("actor_type"),

    details: jsonb("details").default({}).notNull(),

    // Forensic validation
    eventHash: text("event_hash"), // SHA256 of (sessionId + eventType + newStatus + timestamp + previousEventHash)
    previousEventHash: text("previous_event_hash"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRescueEventSchema = createInsertSchema(rescueEvents);
export type RescueEvent = typeof rescueEvents.$inferSelect;
export type InsertRescueEvent = typeof rescueEvents.$inferInsert;



