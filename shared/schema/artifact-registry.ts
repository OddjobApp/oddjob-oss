import { pgTable, text, serial, integer, timestamp, jsonb, uniqueIndex, index, uuid } from "drizzle-orm/pg-core";
import { generationSessions } from './generation-sessions.js';
import { missionRuns } from './missions/runs.js';
import { orgs } from './auth.js';

// ============================================================================
// ARTIFACT REGISTRY (Versioned phase output store for SDLC pipeline)
// ============================================================================

export const artifactRegistry = pgTable("artifact_registry", {
  id: serial("id").primaryKey(),
  sessionId: uuid("session_id").references(() => generationSessions.id, { onDelete: "cascade" }).notNull(),
  phase: text("phase").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),

  // Content
  content: jsonb("content").notNull(),
  mimeType: text("mime_type").notNull().default("application/json"),

  // Validation
  contractSchema: jsonb("contract_schema"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),

  // Lineage
  missionRunId: integer("mission_run_id").references(() => missionRuns.id, { onDelete: "set null" }),
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),

  // Metadata
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueArtifact: uniqueIndex("idx_artifact_unique").on(table.sessionId, table.phase, table.name, table.version),
  sessionIdx: index("idx_artifact_session").on(table.sessionId),
  phaseIdx: index("idx_artifact_phase").on(table.sessionId, table.phase),
}));

export type ArtifactRegistryRow = typeof artifactRegistry.$inferSelect;
export type InsertArtifactRegistry = typeof artifactRegistry.$inferInsert;
