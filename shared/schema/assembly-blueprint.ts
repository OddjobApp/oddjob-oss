import { z } from "zod";

export const BlueprintCategorySchema = z.enum([
  "workstream",
  "operational_cycle",
  "mission",
  "pipeline",
  "forged_app",
  "custom_workbench"
]);

export type BlueprintCategory = z.infer<typeof BlueprintCategorySchema>;

export const BlueprintStageTypeSchema = z.enum([
  "scaffold_pack",
  "pipeline",
  "agent_roster",
  "hil_governance",
  "mission_brief",
  "dataset_schema",
  "custom_surface",
  "screen_step"
]);

export type BlueprintStageType = z.infer<typeof BlueprintStageTypeSchema>;

export const ScreenDataBindingSchema = z.object({
  sourceStageId: z.string().describe("Stage ID producing the source data"),
  outputKey: z.string().describe("Specific field key in the upstream stage's output bag"),
  defaultValue: z.unknown().optional().describe("Fallback value if output key is undefined"),
  transform: z.string().optional().describe("Optional transform expression e.g. 'json_parse', 'number'"),
});

export type ScreenDataBinding = z.infer<typeof ScreenDataBindingSchema>;

export const ScreenTransitionSchema = z.object({
  targetStageId: z.string().describe("Target stage ID to navigate to"),
  condition: z.string().optional().describe("CEL or boolean expression to evaluate against step results"),
  label: z.string().optional().describe("User-facing button or transition label"),
});

export type ScreenTransition = z.infer<typeof ScreenTransitionSchema>;

export const BlueprintStageSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string(),
  description: z.string().optional(),
  type: BlueprintStageTypeSchema,
  requires: z.array(z.string()).default([]).describe("Prerequisite stage IDs in this blueprint"),
  provides: z.array(z.string()).default([]).describe("Capabilities or slots yielded upon completion"),
  conflicts: z.array(z.string()).default([]).describe("Incompatible pack or stage IDs"),
  podComponent: z.string().describe("Packaged Builder Pod component identifier"),
  responsibleAgentRole: z.string().optional().describe("Domain custodian agent persona taking lead for this stage"),
  defaultConfig: z.record(z.unknown()).default({}),
  inputs: z.record(ScreenDataBindingSchema).default({}).describe("Upstream stage output bindings mapped to this stage's props"),
  outputsSchema: z.record(z.unknown()).default({}).describe("JSON Schema definition of the data fields produced upon submission"),
  transitions: z.array(ScreenTransitionSchema).default([]).describe("Conditional or sequential navigation transitions to subsequent stages"),
  completionCriteria: z.object({
    type: z.enum([
      "pack_selected",
      "form_submitted",
      "pipeline_valid",
      "agents_assigned",
      "hil_gate_configured",
      "dataset_verified",
      "custom_attestation"
    ]),
    schema: z.record(z.unknown()).optional(),
  }),
});

export type BlueprintStage = z.infer<typeof BlueprintStageSchema>;
/** Caller-supplied shape: `.default()` fields are optional on the way IN.
 *  z.infer is z.output, so it is the wrong type for anything constructing a stage. */
export type BlueprintStageInput = z.input<typeof BlueprintStageSchema>;

export const BlueprintLayoutTypeSchema = z.enum([
  "chat_inline",
  "split_workbench",
  "modal_wizard",
  "dashboard",
  "operations_console",
  "kanban_board",
  "portal",
  "spatial_canvas",
  "collaborative_workspace",
]);

export type BlueprintLayoutType = z.infer<typeof BlueprintLayoutTypeSchema>;

export const AssemblyBlueprintSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  version: z.string().default("1.0.0"),
  category: BlueprintCategorySchema,
  description: z.string(),
  organizationId: z.number().int().positive().optional(),
  
  // Visual layout & workbench settings
  layout: z.object({
    type: BlueprintLayoutTypeSchema.default("chat_inline"),
    defaultVisualization: z.enum(["mermaid_flowchart", "reactflow_graph"]).default("mermaid_flowchart"),
  }).default({ type: "chat_inline", defaultVisualization: "mermaid_flowchart" }),

  // Product intent used by CREW and Forge to choose appropriate surfaces rather
  // than treating every application as a form wizard.
  archetype: z.enum([
    "workflow_wizard",
    "analytics_dashboard",
    "operations_console",
    "case_management",
    "knowledge_portal",
    "spatial_workspace",
    "collaboration_hub",
    "data_studio",
    "custom",
  ]).optional(),
  capabilities: z.array(z.string()).default([]),

  // Target execution DAG
  stages: z.array(BlueprintStageSchema).min(1),
  
  // Resulting scaffold assembly injection rules
  scaffoldPacks: z.array(z.string()).default([]),
  variables: z.record(z.unknown()).default({}),
});

export type AssemblyBlueprint = z.infer<typeof AssemblyBlueprintSchema>;
/** Caller-supplied shape — see BlueprintStageInput. Parse it to get an AssemblyBlueprint. */
export type AssemblyBlueprintInput = z.input<typeof AssemblyBlueprintSchema>;
