import { pgTable, text, serial, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const pipelineTemplates = pgTable("pipeline_templates", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").default("general"),
    icon: text("icon"),
    config: jsonb("config").notNull(),
    parameterSchema: jsonb("parameter_schema"),
    isFeatured: boolean("is_featured").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by"),
});

export const insertPipelineTemplateSchema = createInsertSchema(pipelineTemplates, {
    name: z.string().min(1, "Name is required"),
    config: z.unknown(),
    parameterSchema: z.unknown(),
}).omit({
    id: true,
    createdAt: true
});

export type PipelineTemplate = typeof pipelineTemplates.$inferSelect;
export type InsertPipelineTemplate = z.infer<typeof insertPipelineTemplateSchema>;

export const schemaMappingTemplates = pgTable("schema_mapping_templates", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    mappingConfig: jsonb("mapping_config").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    organizationId: integer("organization_id").notNull(),
});

export const insertSchemaMappingTemplateSchema = createInsertSchema(schemaMappingTemplates, {
    name: z.string().min(1, "Name is required"),
    mappingConfig: z.unknown(),
}).omit({
    id: true,
    createdAt: true,
    organizationId: true
});

export type SchemaMappingTemplate = typeof schemaMappingTemplates.$inferSelect;
export type InsertSchemaMappingTemplate = z.infer<typeof insertSchemaMappingTemplateSchema>;



