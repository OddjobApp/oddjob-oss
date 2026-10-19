import { pgTable, serial, text, integer, timestamp, jsonb, decimal, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from '../auth.js';
import { componentCategories } from './component-tracking.js';

/**
 * COMPONENT INDEX & BLUEPRINT LIBRARY
 * 
 * Stores indexed UI components, patterns, code snippets, and blueprints
 * that the SDLC Code Assembly Engine queries during dynamic code generation.
 */

export const componentIndex = pgTable("component_index", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id), // Nullable for system-wide global components
  
  // Component Identity & Classification
  componentName: text("component_name").notNull().unique(), // e.g., "MetricSummaryCard"
  componentCategory: text("component_category").notNull(),  // e.g., "ui-data-viz"
  exportType: text("export_type").default("named").notNull(),// "named" | "default" | "macro"
  packageSource: text("package_source").notNull(),         // "@oddjob/design-system" | "relative" | "server-domain"
  importPath: text("import_path").notNull(),               // "@oddjob/design-system" or "@/components/ui/card"
  
  // Interface & AST Specification
  propSchema: jsonb("prop_schema").default({}),             // TypeScript interface description / JSON Schema
  dependencies: jsonb("dependencies").default([]),         // Required NPM packages, Lucide icons, etc.
  codeSnippet: text("code_snippet").notNull(),             // Canonical reference usage snippet
  blueprintTemplate: text("blueprint_template"),           // Parametric template for code gen
  
  // Quality & Assembly Telemetry
  effectivenessScore: decimal("effectiveness_score", { precision: 3, scale: 2 }).default("5.00"),
  verificationSuccessRate: decimal("verification_success_rate", { precision: 5, scale: 2 }).default("100.00"),
  totalAssembleCount: integer("total_assemble_count").default(0),
  /**
   * Number of times a *verification outcome* was actually recorded for this
   * component. Distinct from totalAssembleCount, which also counts renders that
   * never produced a pass/fail signal — using that as the success-rate
   * denominator made one real failure after 40 renders read as ~97.6% success.
   * Zero here means "never measured": effectivenessScore and
   * verificationSuccessRate are still at their seeded defaults and must not be
   * presented as observed quality.
   */
  verificationRunCount: integer("verification_run_count").default(0).notNull(),
  isApprovedForAssembly: boolean("is_approved_for_assembly").default(true),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  nameIdx: index("comp_idx_name_idx").on(table.componentName),
  categoryIdx: index("comp_idx_category_idx").on(table.componentCategory),
  orgIdx: index("comp_idx_org_idx").on(table.organizationId),
  effectivenessIdx: index("comp_idx_effectiveness_idx").on(table.effectivenessScore),
}));

export const insertComponentIndexSchema = createInsertSchema(componentIndex, {
  componentCategory: z.enum(componentCategories),
  effectivenessScore: z.number().min(0).max(5).optional(),
  verificationSuccessRate: z.number().min(0).max(100).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type ComponentIndexRecord = typeof componentIndex.$inferSelect;
export type InsertComponentIndex = typeof componentIndex.$inferInsert;

/**
 * DEHYDRATED ASSEMBLY MANIFESTS
 * 
 * Stores frozen execution states compiled from ephemeral agent sessions
 * into deterministic solid-state specifications (antigravity.assembly.yaml).
 */

export const assemblyManifests = pgTable("assembly_manifests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id).notNull(),
  
  assemblyId: text("assembly_id").notNull().unique(), // e.g. "asm_984f2a10_prod"
  intent: text("intent").notNull(),                  // Goal description
  authorAgent: text("author_agent").default("antigravity-supervisor-v1").notNull(),
  
  // Frozen State & Manifest Payload
  manifestYaml: text("manifest_yaml").notNull(),     // Full YAML string
  specPayload: jsonb("spec_payload").notNull(),      // Parsed JSON specification
  artifactHashes: jsonb("artifact_hashes").default({}), // SHA-256 map per file
  
  // Build & Deployment Telemetry
  buildStatus: text("build_status").default("pending").notNull(), // "pending" | "compiled" | "deployed" | "failed"
  dockerImageTag: text("docker_image_tag"),
  endpointUrl: text("endpoint_url"),
  latencyP95Ms: decimal("latency_p95_ms", { precision: 7, scale: 2 }),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdx: index("asm_manifest_org_idx").on(table.organizationId),
  assemblyIdIdx: index("asm_manifest_id_idx").on(table.assemblyId),
  statusIdx: index("asm_manifest_status_idx").on(table.buildStatus),
}));

export const insertAssemblyManifestSchema = createInsertSchema(assemblyManifests).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export type AssemblyManifestRecord = typeof assemblyManifests.$inferSelect;
export type InsertAssemblyManifest = typeof assemblyManifests.$inferInsert;
