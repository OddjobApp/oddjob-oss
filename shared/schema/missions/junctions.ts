import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { missions } from './core.js';

// ============================================================================
// MISSION RAG ASSETS
// ============================================================================

export const missionRagAssetPurposes = ["example", "template", "reference", "context"] as const;
export type MissionRagAssetPurpose = (typeof missionRagAssetPurposes)[number];

export const missionRagAssets = pgTable("mission_rag_assets", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id")
    .references(() => missions.id, { onDelete: "cascade" })
    .notNull(),
  ragAssetId: integer("rag_asset_id").notNull(),
  purpose: text("purpose").notNull().default("reference"),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MissionRagAsset = typeof missionRagAssets.$inferSelect;
export type InsertMissionRagAsset = typeof missionRagAssets.$inferInsert;

// ============================================================================
// MISSION DOCUMENT TEMPLATES
// ============================================================================

export const missionDocumentTemplateRoles = ["output_standard", "tool", "reference"] as const;
export type MissionDocumentTemplateRole = (typeof missionDocumentTemplateRoles)[number];

export const missionDocumentTemplates = pgTable("mission_document_templates", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id")
    .references(() => missions.id, { onDelete: "cascade" })
    .notNull(),
  documentTemplateId: integer("document_template_id").notNull(),
  role: text("role").notNull().default("output_standard"),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MissionDocumentTemplate = typeof missionDocumentTemplates.$inferSelect;

// ============================================================================
// MISSION FILE ATTACHMENTS
// ============================================================================

export const missionFileAttachments = pgTable("mission_file_attachments", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id")
    .references(() => missions.id, { onDelete: "cascade" })
    .notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull().default("application/octet-stream"),
  fileSize: integer("file_size"),
  fileData: text("file_data"),
  textContent: text("text_content"),
  purpose: text("purpose").notNull().default("reference"),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MissionFileAttachment = typeof missionFileAttachments.$inferSelect;



