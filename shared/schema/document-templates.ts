import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

// ============================================================================
// DOCUMENT TEMPLATES (for AI Agent Output Standards)
// ============================================================================

export const documentTemplates = pgTable("document_templates", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    source: text("source").notNull().default("direct"), // 'direct' or 'knowledge'
    type: text("type").notNull().default("markdown"), // 'markdown', 'pdf', 'excel', 'image', 'word', 'google_doc'
    content: text("content"), // Markdown or text template (null if knowledge)
    knowledgeDocumentId: integer("knowledge_document_id"), // Reference to knowledge_documents.id
    category: text("category").default("general"),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplates, {
    name: z.string().min(1, "Name is required").max(200),
    content: z.string().optional().nullable(),
    source: z.enum(["direct", "knowledge"]).default("direct"),
    type: z.enum(["markdown", "pdf", "excel", "image", "word", "google_doc", "presentation_deck"]).default("markdown"),
    knowledgeDocumentId: z.number().int().optional().nullable(),
    organizationId: z.number().int().positive().optional().nullable(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const updateDocumentTemplateSchema = insertDocumentTemplateSchema.partial();

export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;



