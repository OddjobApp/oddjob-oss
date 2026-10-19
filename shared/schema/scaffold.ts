import { z } from "zod";

export const InjectionActionSchema = z.enum([
  "AST_ADD_IMPORT",
  "AST_ADD_MIDDLEWARE",
  "AST_REGISTER_ROUTE",
  "MERGE_JSON",
  "APPEND_YAML",
  "ENV_VARIABLE"
]);

export const TargetRuleSchema = z.object({
  target: z.string().describe("Relative target file path, e.g. 'src/app.ts'"),
  action: InjectionActionSchema,
  import: z.string().optional(),
  use: z.string().optional(),
  path: z.string().optional().describe("JSON path for MERGE_JSON, e.g. 'dependencies'"),
  content: z.record(z.any()).optional()
});

export type TargetRule = z.infer<typeof TargetRuleSchema>;

export const TemplateRuleSchema = z.object({
  source: z.string().describe("Source template path relative to pack templates/ dir"),
  destination: z.string().describe("Destination path relative to generated app root")
});

export const PackManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  version: z.string(),
  category: z.enum(["core", "auth", "data", "observability", "transport", "security", "ui"]),
  extends: z.string().optional().describe("Base host framework required, e.g. 'core-node-express'"),
  requires: z.array(z.string()).default([]).describe("Prerequisite packs that must execute before this pack"),
  conflicts: z.array(z.string()).default([]).describe("Mutually exclusive pack IDs"),
  recommends: z.array(z.string()).default([]).describe("Suggested optional packs"),
  provides: z.array(z.string()).default([]).describe("Virtual capability slots provided"),
  inject: z.array(TargetRuleSchema).default([]),
  templates: z.array(TemplateRuleSchema).default([]),
  hooks: z.object({
    postAssemble: z.string().optional()
  }).optional()
});

export type PackManifest = z.infer<typeof PackManifestSchema>;

export const AssemblyManifestSchema = z.object({
  appName: z.string().regex(/^[a-z0-9-]+$/),
  targetDir: z.string(),
  packs: z.array(z.string()).min(1, "At least one host pack must be selected"),
  variables: z.record(z.unknown()).default({}),
  /** Owning org. Required to refresh the X-Ray composition graph after assembly. */
  organizationId: z.number().int().positive().optional()
});

export type AssemblyManifest = z.infer<typeof AssemblyManifestSchema>;
