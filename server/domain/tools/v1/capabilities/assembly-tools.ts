import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import type { ToolDefinition, ToolContext } from "./types.js";
import { DAGResolver } from "../../../scaffold/dag-resolver.js";
import { scaffoldRegistryService } from "../../../scaffold/scaffold-registry.service.js";
import { GoodQuestionEngine } from "../../../ai/core/good-question-engine.js";
import { AssemblyBlueprintSchema } from "@shared/schema/assembly-blueprint.js";
import { createLogger } from "@server/utils/logger.js";
import { requireToolOrgId } from "./org-context.js";
import { projectPlanFieldsSchema } from "@shared/project-plan-commit.js";

const logger = createLogger("AssemblyTools");

const AppArchetypeSchema = z.enum([
  "workflow_wizard",
  "analytics_dashboard",
  "operations_console",
  "case_management",
  "knowledge_portal",
  "spatial_workspace",
  "collaboration_hub",
  "data_studio",
  "custom",
]);

const AppLayoutSchema = z.enum([
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

const ARCHETYPE_CATALOG = {
  workflow_wizard: { layout: "modal_wizard", surfaces: ["forms", "review", "approvals"], builder: "scaffold_multistep_app" },
  analytics_dashboard: { layout: "dashboard", surfaces: ["kpis", "charts", "filters", "detail_drilldown"], builder: "mount_builder_pod" },
  operations_console: { layout: "operations_console", surfaces: ["live_status", "queue", "timeline", "actions"], builder: "mount_builder_pod" },
  case_management: { layout: "kanban_board", surfaces: ["case_queue", "record_detail", "activity", "approvals"], builder: "scaffold_multistep_app" },
  knowledge_portal: { layout: "portal", surfaces: ["search", "collections", "document_viewer", "recommendations"], builder: "mount_builder_pod" },
  spatial_workspace: { layout: "spatial_canvas", surfaces: ["map", "layers", "selection", "detail_panel"], builder: "mount_builder_pod" },
  collaboration_hub: { layout: "collaborative_workspace", surfaces: ["shared_canvas", "presence", "comments", "activity"], builder: "mount_builder_pod" },
  data_studio: { layout: "split_workbench", surfaces: ["dataset_browser", "query", "visualization", "lineage"], builder: "mount_builder_pod" },
  custom: { layout: "split_workbench", surfaces: ["custom_surface"], builder: "synthesize_fullstack_spec" },
} as const;

type AppArchetype = keyof typeof ARCHETYPE_CATALOG;
type AppArchitecturePlan = {
  appName: string;
  requirements?: string;
  archetype: AppArchetype;
  layout: string;
  surfaces: readonly string[];
  capabilities: readonly string[];
  integrations: readonly string[];
  recommendedTool: string;
  requiresForgeGeneration: boolean;
};

function inferAppArchetype(requirements: string): AppArchetype {
  const value = requirements.toLowerCase();
  if (/map|spatial|geo|location|geofence/.test(value)) return "spatial_workspace";
  if (/kanban|case management|ticket|queue|triage/.test(value)) return "case_management";
  if (/dashboard|analytics|kpi|chart|report/.test(value)) return "analytics_dashboard";
  if (/operations|command center|monitor|real.?time|incident/.test(value)) return "operations_console";
  if (/knowledge|research|library|document|search portal/.test(value)) return "knowledge_portal";
  if (/collaborat|whiteboard|canvas|crew room|shared workspace/.test(value)) return "collaboration_hub";
  if (/dataset|query|data studio|lineage|schema/.test(value)) return "data_studio";
  if (/form|wizard|onboarding|step.?by.?step|intake/.test(value)) return "workflow_wizard";
  return "custom";
}

async function resolveCrewSessionId(context: ToolContext): Promise<number | null> {
  if (context?.sessionId && Number.isFinite(Number(context.sessionId))) return Number(context.sessionId);
  const sessionKey = (context as any)?.sessionKey;
  if (!sessionKey) return null;
  const { db } = await import("@server/database_service.js");
  const { crewSessions } = await import("@shared/schema/index.js");
  const { eq } = await import("drizzle-orm");
  const [session] = await db.select({ id: crewSessions.id }).from(crewSessions).where(eq(crewSessions.sessionKey, String(sessionKey))).limit(1);
  return session?.id ?? null;
}

async function readActiveAppPlan(context: ToolContext): Promise<AppArchitecturePlan | null> {
  const sessionId = await resolveCrewSessionId(context);
  if (!sessionId) return null;
  const { db } = await import("@server/database_service.js");
  const { crewSessions } = await import("@shared/schema/index.js");
  const { eq } = await import("drizzle-orm");
  const [session] = await db.select({ memory: crewSessions.memory }).from(crewSessions).where(eq(crewSessions.id, sessionId)).limit(1);
  return (session?.memory as any)?.activeAppArchitecturePlan ?? null;
}

async function persistActiveAppPlan(context: ToolContext, plan: AppArchitecturePlan): Promise<void> {
  const sessionId = await resolveCrewSessionId(context);
  if (!sessionId) return;
  const { db } = await import("@server/database_service.js");
  const { crewSessions } = await import("@shared/schema/index.js");
  const { eq } = await import("drizzle-orm");
  const [session] = await db.select({ memory: crewSessions.memory }).from(crewSessions).where(eq(crewSessions.id, sessionId)).limit(1);
  await db.update(crewSessions).set({
    memory: { ...(session?.memory ?? {}), activeAppArchitecturePlan: plan } as any,
    updatedAt: new Date(),
  }).where(eq(crewSessions.id, sessionId));
}

/**
 * Stage shapes for the multi-step tools, named so their inferred types are
 * available to the execute() bodies.
 *
 * ASSEMBLY_TOOLS is declared `Record<string, ToolDefinition>`, which pins the
 * generic P to its default `z.ZodTypeAny`; `z.infer<z.ZodTypeAny>` is `any`, so
 * `params` arrives untyped and every callback parameter below it is an implicit
 * any. Annotating from these schemas restores the checking rather than papering
 * over it with `: any`.
 */
const ScreenBindingSchema = z.object({
  sourceStageId: z.string(),
  outputKey: z.string(),
  defaultValue: z.unknown().optional(),
  transform: z.string().optional(),
});

const MultiStepStageSchema = z.object({
  id: z.string().describe("Unique stage ID e.g. 'intake_form', 'analysis_view'"),
  name: z.string().describe("Screen title"),
  description: z.string().optional(),
  type: z.enum([
    "scaffold_pack",
    "pipeline",
    "agent_roster",
    "hil_governance",
    "mission_brief",
    "dataset_schema",
    "custom_surface",
    "screen_step"
  ]).default("screen_step"),
  requires: z.array(z.string()).default([]).describe("Prerequisite stage IDs"),
  podComponent: z.string().default("MultiStepScreenContainer").describe("Pod or screen component identifier"),
  inputs: z.record(ScreenBindingSchema).default({}).describe('Each input must be an object binding, e.g. propertyData: { sourceStageId: "intake", outputKey: "propertyData" }. Never use a string reference.'),
  outputsSchema: z.record(z.unknown()).default({}),
  transitions: z.array(z.object({
    targetStageId: z.string(),
    condition: z.string().optional(),
    label: z.string().optional(),
  })).default([]),
});
type MultiStepStage = z.infer<typeof MultiStepStageSchema>;

const ScreenFlowStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  inputs: z.record(z.object({
    sourceStageId: z.string(),
    outputKey: z.string(),
  })).default({}),
});
type ScreenFlowStage = z.infer<typeof ScreenFlowStageSchema>;
type ScreenBinding = z.infer<typeof ScreenBindingSchema>;

export const ASSEMBLY_TOOLS: Record<string, ToolDefinition> = {
  plan_app_architecture: {
    name: "plan_app_architecture",
    label: "Plan Application Architecture",
    description: "Classifies application requirements into a supported archetype and returns the layout, surfaces, capabilities, and best CREW/Forge construction path. Use before selecting a builder for a new app.",
    idempotency: "read-safe",
    parameters: z.object({
      appName: z.string(),
      requirements: z.string().min(3),
      preferredArchetype: AppArchetypeSchema.optional(),
      capabilities: z.array(z.string()).default([]),
      integrations: z.array(z.string()).default([]),
    }),
    execute: async (params, context: ToolContext) => {
      const archetype = (params.preferredArchetype as AppArchetype | undefined) || inferAppArchetype(params.requirements);
      const catalogEntry = ARCHETYPE_CATALOG[archetype];
      const capabilities = [...new Set([...catalogEntry.surfaces, ...params.capabilities])];
      const plan = {
        appName: params.appName,
        requirements: params.requirements,
        archetype,
        layout: catalogEntry.layout,
        surfaces: catalogEntry.surfaces,
        capabilities,
        integrations: params.integrations,
        recommendedTool: catalogEntry.builder,
        requiresForgeGeneration: archetype === "custom" || params.integrations.length > 0,
      };
      try {
        await persistActiveAppPlan(context, plan);
      } catch (error: any) {
        logger.warn("Failed to persist active app architecture plan", { error: error?.message ?? String(error) });
      }
      return {
        success: true,
        type: "instant_app",
        module: "AppArchitecturePlanPod",
        component: "AppArchitecturePlanPod",
        componentName: "AppArchitecturePlanPod",
        title: `Architecture Plan: ${params.appName}`,
        props: { plan, catalog: ARCHETYPE_CATALOG },
        plan,
        message: `Planned ${params.appName} as a ${archetype} using the ${catalogEntry.layout} layout. Continue with ${catalogEntry.builder}.`,
      };
    },
  },
  /**
   * Enumerates the scaffold packs that actually exist.
   *
   * The crew allowlist has named `list_scaffold_packs` all along, but the only
   * implementation lived in `server/mcp/scaffold-tools.ts` — an MCP tool, never
   * registered here — so the name was silently dropped and no agent was ever
   * offered it. Both the deployment tool's refusal message and the persona
   * prompt told agents to "call list_scaffold_packs first", which meant telling
   * them to call something they did not have. With no way to discover pack ids,
   * an agent asked to deploy invents one (`full-stack-app`), the id fails
   * validation, and the deployment can never be proposed.
   */
  list_scaffold_packs: {
    name: "list_scaffold_packs",

    idempotency: "read-safe",
    label: "List Available Scaffold Packs",
    group: "App Forge",
    description:
      "Lists every scaffold pack in the registry with its id, category, what it provides and what it requires. " +
      "Call this before proposing a deployment so the pack ids are real ones rather than guesses.",
    parameters: z.object({}),
    execute: async () => {
      try {
        const packs = await scaffoldRegistryService.loadAllPacks();
        if (packs.length === 0) {
          return JSON.stringify({
            success: true,
            totalPacks: 0,
            packs: [],
            message:
              "The scaffold registry is empty — no application can be assembled until packs are added to packages/scaffold-registry.",
          });
        }
        return JSON.stringify({
          success: true,
          totalPacks: packs.length,
          packs: packs.map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            provides: p.provides,
            requires: p.requires,
            conflicts: p.conflicts,
          })),
          message:
            `${packs.length} scaffold pack(s) available: ${packs.map((p) => p.id).join(", ")}. ` +
            `These are the only valid pack ids — do not propose any others.`,
        });
      } catch (err: any) {
        logger.error("[AssemblyTools] Failed to list scaffold packs", err.message);
        return `Failed to list scaffold packs: ${err.message}`;
      }
    },
  },

  resolve_assembly_dag: {
    name: "resolve_assembly_dag",

    idempotency: "read-safe",
    label: "Resolve Assembly DAG & Prerequisites",
    description: "Evaluates an Assembly Blueprint or list of scaffold packs to compute the topological execution order, identify missing prerequisites, and detect pack conflicts.",
    parameters: z.object({
      requestedPacks: z.array(z.string()).describe("List of pack IDs to resolve (e.g. ['auth-jwt', 'data-postgres-drizzle'])"),
    }),
    execute: async (params, _context) => {
      try {
        const packs = await scaffoldRegistryService.loadAllPacks();
        const resolver = new DAGResolver(packs);
        const resolvedOrder = resolver.resolveExecutionOrder(params.requestedPacks);

        return {
          success: true,
          executionOrder: resolvedOrder.map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            provides: p.provides,
            requires: p.requires,
          })),
          totalPacks: resolvedOrder.length,
          message: `Successfully resolved topological DAG with ${resolvedOrder.length} packs.`,
        };
      } catch (err: any) {
        logger.error("[AssemblyTools] DAG resolution failed", err.message);
        return {
          success: false,
          error: err.message,
          message: `DAG resolution error: ${err.message}`,
        };
      }
    },
  },

  render_workflow_diagram: {
    name: "render_workflow_diagram",

    idempotency: "read-safe",
    label: "Render Workflow Dependency Diagram",
    description:
      "Generates and renders a Mermaid diagram inline in the chat. " +
      "Two modes: (1) Pass 'stages' to auto-generate a Blueprint execution flowchart with ready/active/blocked status classes. " +
      "(2) Pass raw 'code' to render ANY Mermaid diagram type inline — sequenceDiagram, classDiagram, erDiagram, gantt, mindmap, timeline, pie, etc. " +
      "Always use this for sequence diagrams, class diagrams, ER diagrams, Gantt charts, and any other Mermaid diagram you want rendered in the chat. " +
      "Do NOT use generate_mermaid_diagram for inline rendering — that saves to file storage.",
    parameters: z.object({
      /*
        Loosened deliberately. `id` was required and `status` accepted only
        ready/active/blocked, so a model describing a pipeline in the room's own
        vocabulary — steps with names but no ids, statuses like "pending" or
        "completed" — failed validation outright and the round was spent
        narrating the failure. Both are now forgiving: ids are derived from the
        name when absent, and the wider status vocabulary is normalised onto the
        three classes the diagram actually draws.
      */
      stages: z.array(z.object({
        id: z.string().optional().describe("Stable id. Derived from the name when omitted."),
        name: z.string(),
        status: z
          .enum(["ready", "active", "blocked", "pending", "in_progress", "running", "completed", "done", "failed"])
          .default("blocked")
          .describe("Drawn as ready (green), active (amber) or blocked (grey); synonyms are mapped onto those."),
        dependsOn: z.array(z.string()).default([]),
      })).optional().describe("List of stages for a Blueprint flowchart (use this OR code, not both)"),
      code: z.string().optional().describe(
        "Raw Mermaid diagram code to render inline. Use this for any Mermaid diagram type: " +
        "sequenceDiagram, classDiagram, erDiagram, gantt, mindmap, timeline, pie, sankey-beta, xychart-beta, etc. " +
        "Example: 'sequenceDiagram\\n    Alice->>Bob: Hello\\n    Bob-->>Alice: Hi'"
      ),
      title: z.string().optional().describe("Optional title for the diagram"),
    }),
    execute: async (params, _context) => {
      try {
        let chart: string;
        let title = params.title || "Workflow Diagram";

        if (params.code) {
          // Raw Mermaid pass-through — any diagram type
          chart = params.code.trim();
          // Infer a readable title from the diagram type if none given
          if (!params.title) {
            const firstLine = chart.split("\n")[0].trim().toLowerCase();
            if (firstLine.startsWith("sequencediagram")) title = "Sequence Diagram";
            else if (firstLine.startsWith("classdiagram")) title = "Class Diagram";
            else if (firstLine.startsWith("erdiagram")) title = "Entity-Relationship Diagram";
            else if (firstLine.startsWith("gantt")) title = "Gantt Chart";
            else if (firstLine.startsWith("mindmap")) title = "Mindmap";
            else if (firstLine.startsWith("timeline")) title = "Timeline";
            else if (firstLine.startsWith("pie")) title = "Pie Chart";
            else if (firstLine.startsWith("sankey")) title = "Sankey Diagram";
            else if (firstLine.startsWith("xychart")) title = "XY Chart";
            else if (firstLine.startsWith("quadrant")) title = "Quadrant Chart";
          }
        } else if (params.stages && params.stages.length > 0) {
          // Auto-generate a blueprint flowchart from stages
          const lines: string[] = ["graph TD"];
          lines.push("    classDef ready fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;");
          lines.push("    classDef active fill:#f59e0b,stroke:#d97706,stroke-width:3px,color:#fff;");
          lines.push("    classDef blocked fill:#1e293b,stroke:#475569,stroke-dasharray: 5 5,color:#94a3b8;");
          lines.push("");
          // Only three classDefs exist above, so every accepted status has to
          // land on one of them or Mermaid renders an unstyled node.
          const STATUS_CLASS: Record<string, "ready" | "active" | "blocked"> = {
            ready: "ready", completed: "ready", done: "ready",
            active: "active", in_progress: "active", running: "active",
            blocked: "blocked", pending: "blocked", failed: "blocked",
          };
          const idOf = (stage: { id?: string; name: string }) =>
            (stage.id || stage.name).replace(/[^a-zA-Z0-9_]/g, "_");

          for (const stage of params.stages) {
            const safeId = idOf(stage);
            const cls = STATUS_CLASS[stage.status] ?? "blocked";
            const label = `${stage.name} (${stage.status.toUpperCase()})`;
            lines.push(`    ${safeId}["${label}"]:::${cls}`);
          }
          lines.push("");
          for (const stage of params.stages) {
            const safeId = idOf(stage);
            for (const dep of stage.dependsOn) {
              const safeDep = dep.replace(/[^a-zA-Z0-9_]/g, "_");
              lines.push(`    ${safeDep} --> ${safeId}`);
            }
          }
          chart = lines.join("\n");
          title = params.title || "Blueprint Workflow & Execution Diagram";
        } else {
          return { success: false, error: "Provide either 'stages' for a blueprint flowchart or 'code' for a raw Mermaid diagram." };
        }

        return {
          success: true,
          type: "workflow_diagram",
          title,
          chart,
          markdownBlock: `\`\`\`mermaid\n${chart}\n\`\`\``,
          message: `Rendered diagram "${title}":\n\`\`\`mermaid\n${chart}\n\`\`\``,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },

  render_mermaid_diagram: {
    name: "render_mermaid_diagram",

    idempotency: "read-safe",
    label: "Render Mermaid Diagram (Inline)",
    description:
      "Renders any Mermaid diagram type directly inline in the assistant chat. " +
      "Use this for sequence diagrams, class diagrams, ER diagrams, Gantt charts, Sankey diagrams, mindmaps, timelines, pie charts, XY charts, and quadrant charts. " +
      "Always use this instead of describing diagrams in prose or emitting raw markdown code blocks — this renders an interactive visual component. " +
      "Supported types: sequenceDiagram, classDiagram, erDiagram, gantt, mindmap, timeline, pie, sankey-beta, xychart-beta, quadrantChart, requirementDiagram, flowchart.",
    parameters: z.object({
      code: z.string().describe(
        "Complete Mermaid diagram code. Must start with the diagram type keyword, e.g. " +
        "'sequenceDiagram', 'classDiagram', 'erDiagram', 'gantt', 'mindmap', 'sankey-beta', etc."
      ),
      title: z.string().optional().describe("Optional title shown above the rendered diagram."),
    }),
    execute: async (params, _context) => {
      try {
        const chart = params.code.trim();
        let title = params.title || "";
        if (!title) {
          const firstLine = chart.split("\n")[0].trim().toLowerCase();
          if (firstLine.startsWith("sequencediagram")) title = "Sequence Diagram";
          else if (firstLine.startsWith("classdiagram")) title = "Class Diagram";
          else if (firstLine.startsWith("erdiagram")) title = "Entity-Relationship Diagram";
          else if (firstLine.startsWith("gantt")) title = "Gantt Chart";
          else if (firstLine.startsWith("mindmap")) title = "Mindmap";
          else if (firstLine.startsWith("timeline")) title = "Timeline";
          else if (firstLine.startsWith("pie")) title = "Pie Chart";
          else if (firstLine.startsWith("sankey")) title = "Sankey Diagram";
          else if (firstLine.startsWith("xychart")) title = "XY Chart";
          else if (firstLine.startsWith("quadrant")) title = "Quadrant Chart";
          else title = "Diagram";
        }
        return {
          success: true,
          type: "workflow_diagram",
          title,
          chart,
          markdownBlock: `\`\`\`mermaid\n${chart}\n\`\`\``,
          message: `Rendered diagram "${title}":\n\`\`\`mermaid\n${chart}\n\`\`\``,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },

  /**
   * Starts a multi-step run and mounts it inline in chat.
   *
   * The session is created SERVER-SIDE and only its id travels to the client:
   * stage prerequisites are a gate, and a gate enforced in the browser is not a
   * gate. The pod reads and advances the run through /api/blueprint-sessions.
   */
  start_multistep_run: {
    name: "start_multistep_run",

    idempotency: "none",
    label: "Start Multi-Step Run",
    description:
      "Create a multi-step assembly run from a blueprint and mount it inline in chat as a step-by-step wizard. Use when a task needs several ordered stages with dependencies between them, rather than a single form.",
    parameters: z.object({
      blueprint: AssemblyBlueprintSchema.describe("The blueprint whose stages the run walks through"),
      title: z.string().optional().describe("Title displayed on the card"),
    }),
    execute: async (params: any, context: ToolContext) => {
      const { assertOrgId } = await import("@server/utils/auth-context.js");
      const organizationId = assertOrgId(context?.organizationId);

      const parsed = AssemblyBlueprintSchema.safeParse(params.blueprint);
      if (!parsed.success) {
        return JSON.stringify({
          success: false,
          message: `Invalid blueprint: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        });
      }

      const { randomUUID } = await import("node:crypto");
      const sessionId = randomUUID();

      try {
        const { blueprintStateService } = await import("@domain/scaffold/blueprint-state.service.js");
        // createSession validates the DAG (missing prerequisites, cycles) and throws.
        const summary = await blueprintStateService.createSession(
          sessionId,
          parsed.data,
          organizationId,
          context?.userId ? String(context.userId) : undefined,
        );

        const title = params.title || `${summary.blueprintName} — ${summary.totalStages} steps`;
        const props = { sessionId };

        return {
          success: true,
          type: "assistant_app",
          module: "MultiStepAppPod",
          component: "MultiStepAppPod",
          componentName: "MultiStepAppPod",
          title,
          props,
          artifact: {
            type: "assistant_app",
            module: "MultiStepAppPod",
            component: "MultiStepAppPod",
            componentName: "MultiStepAppPod",
            title,
            props,
          },
          message: `Started run '${sessionId}' for blueprint '${summary.blueprintId}' (${summary.totalStages} stages, first: ${summary.activeStage?.name ?? "none"}).`,
        };
      } catch (e: any) {
        // A blueprint whose stages cannot be ordered is a real authoring error.
        // Report it rather than mounting a pod over a run that does not exist.
        logger.warn(`start_multistep_run failed: ${e?.message}`);
        return JSON.stringify({
          success: false,
          message: `Could not start the run: ${e?.message || String(e)}`,
        });
      }
    },
  },

  mount_builder_pod: {
    name: "mount_builder_pod",

    idempotency: "idempotent",
    label: "Mount In-Chat Builder Pod",
    description: "Returns an assistant_app payload to mount an adaptive Builder Pod (ScaffoldPackPod, PipelineBuilderPod, AgenticHRPod, HILGovernancePod, MissionBriefPod, DatasetSchemaPod, DocumentDeckPod, OntologyLinkTypePod, ProjectPlanningPod, ProjectStudioPod, DecisionMatrixPod, AgentUpskillingPod, ToolScaffoldPod) inline in chat. 'podComponent' is required. 'stageId' is optional.",
    parameters: z.object({
      podComponent: z.string().describe("The component name in the packaged registry (e.g. 'MissionBriefPod', 'ScaffoldPackPod', 'PipelineBuilderPod', 'AgenticHRPod', 'HILGovernancePod', 'DatasetSchemaPod', 'DocumentDeckPod', 'OntologyLinkTypePod', 'ProjectPlanningPod', 'ProjectStudioPod', 'DecisionMatrixPod', 'AgentUpskillingPod', 'ToolScaffoldPod')"),
      stageId: z.string().optional().default("stage-intake").describe("Optional stage ID being fulfilled (defaults to 'stage-intake')"),
      title: z.string().optional().describe("Title displayed on the pod card"),
      props: z.record(z.unknown()).default({}).describe("Props passed into the builder pod component"),
    }),
    execute: async (params, _context) => {
      const stageId = params.stageId || "stage-intake";
      const title = params.title || `Configure ${params.podComponent.replace(/Pod$/, "")}`;
      
      // FullStackAssemblyPod was retired when calculators and intake forms moved to
      // Form Studio. A model that still names it gets told where they went, rather
      // than a mount that renders "component isn't available".
      if (params.podComponent === "FullStackAssemblyPod") {
        return {
          success: false,
          message:
            "FullStackAssemblyPod has been retired. Calculators, intake forms and other forms are built in Form Studio: " +
            "call mount_form_studio to open an existing form, and the room drafts a new one when the user asks to create it.",
        };
      }

      const mergedProps = {
        stageId,
        ...params.props,
      };

      return {
        success: true,
        type: "assistant_app",
        module: params.podComponent,
        component: params.podComponent,
        componentName: params.podComponent,
        podComponent: params.podComponent,
        title,
        props: mergedProps,
        artifact: {
          type: "assistant_app",
          module: params.podComponent,
          component: params.podComponent,
          componentName: params.podComponent,
          podComponent: params.podComponent,
          title,
          props: mergedProps,
        },
        message: `Mounted builder pod '${params.podComponent}' for stage '${stageId}'.`,
      };
    },
  },

  synthesize_fullstack_spec: {
    name: "synthesize_fullstack_spec",

    idempotency: "read-safe",
    label: "Synthesize Full-Stack Application Spec",
    description: "Infers and synthesizes an end-to-end 5-layer application architecture (UI form fields, pipeline DAG execution steps, Dataset schema, and project scoping) from a prompt or intake form fields, returning a ready-to-deploy spec.",
    parameters: z.object({
      appName: z.string().describe("Application name"),
      description: z.string().optional().describe("App summary"),
      fields: z.array(z.object({
        name: z.string(),
        type: z.string().default("text"),
        label: z.string().optional(),
        formula: z.string().optional(),
      })).default([]).describe("Input fields from user intake or discussion"),
      trigger: z.string().default("form_submit").describe("Pipeline trigger type"),
      projectKey: z.string().default("default").describe("Target project key"),
    }),
    execute: async (params, _context) => {
      const datasetFields = [
        { id: "col-1", name: "id", type: "uuid", isPrimary: true, isNullable: false },
        ...params.fields.map((f: { name: string; type?: string; label?: string; formula?: string }, i: number) => {
          let colType = "text";
          if (f.type === "number") colType = "numeric";
          else if (f.type === "location" || f.type === "geo") colType = "jsonb";
          else if (f.type === "boolean") colType = "boolean";
          else if (f.type === "computed") colType = "numeric";
          return {
            id: `col-${i + 2}`,
            name: f.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
            type: colType,
            isNullable: true,
          };
        }),
        { id: `col-${params.fields.length + 2}`, name: "vector_embedding", type: "vector_embedding", isNullable: true },
        { id: `col-${params.fields.length + 3}`, name: "created_at", type: "timestamp", isNullable: false },
      ];

      const steps = [
        { id: "step-1", name: "Extract & Validate Ingestion Payload", type: "data_extract" },
        // No tool binding for step 2: "calculation_evaluator" was never a registered tool.
        { id: "step-2", name: "Execute Business Logic & Calculations", type: "ai_inference" },
        { id: "step-3", name: `Persist Records to Dataset "${params.appName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}_records"`, type: "action_dispatch", toolName: "add_dataset_items" },
      ];

      const tableName = `${params.appName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}_records`;

      return {
        success: true,
        appName: params.appName,
        tableName,
        datasetFields,
        pipelineSteps: steps,
        trigger: params.trigger,
        projectKey: params.projectKey,
      };
    },
  },

  evaluate_functional_gaps: {
    name: "evaluate_functional_gaps",

    idempotency: "read-safe",
    label: "Evaluate Blueprint Functional Gaps (GQE)",
    description: "Lints an Assembly Blueprint for the 6 defect classes: Unbound I/O, High-Blast-Radius Governance Gaps, Dead-End Branches, Capability Deficits, Observability Deficits, and Pack Conflicts.",
    parameters: z.object({
      blueprint: AssemblyBlueprintSchema.describe("The target assembly blueprint to lint"),
    }),
    execute: async (params, _context) => {
      try {
        const stages = params.blueprint.stages || [];
        const scaffoldPacks = params.blueprint.scaffoldPacks || [];
        const gaps: Array<{ class: string; description: string; severity: "low" | "medium" | "high" | "critical"; recommendation: string }> = [];

        // 1. Governance Gap: High blast-radius pipeline without HIL gate
        const hasPipeline = stages.some((s: any) => s.type === "pipeline");
        const hasHIL = stages.some((s: any) => s.type === "hil_governance");
        if (hasPipeline && !hasHIL) {
          gaps.push({
            class: "governance_gap",
            description: "Blueprint contains automated execution pipeline without a Human-in-the-Loop approval gate.",
            severity: "high",
            recommendation: "Insert an HILGovernancePod before deployment steps.",
          });
        }

        // 2. Pack Conflicts: JWT vs Session
        if (scaffoldPacks.includes("auth-jwt") && scaffoldPacks.includes("auth-session")) {
          gaps.push({
            class: "pack_conflict",
            description: "Mutually exclusive authentication packs selected ('auth-jwt' and 'auth-session').",
            severity: "critical",
            recommendation: "Select either JWT Bearer tokens or Session Cookies.",
          });
        }

        // 3. Database Dependency for Auth
        if (scaffoldPacks.includes("auth-jwt") && !scaffoldPacks.includes("data-postgres-drizzle")) {
          gaps.push({
            class: "capability_deficit",
            description: "JWT authentication pack requires a persistent database layer.",
            severity: "high",
            recommendation: "Add 'data-postgres-drizzle' to selected packs.",
          });
        }

        return {
          success: true,
          isValid: gaps.length === 0,
          gapsCount: gaps.length,
          gaps,
          message: gaps.length === 0
            ? "Blueprint passed all functional gap verification checks."
            : `Detected ${gaps.length} functional gap(s) requiring remediation.`,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
        };
      }
    },
  },

  propose_cycle_draft: {
    name: "propose_cycle_draft",

    idempotency: "idempotent",
    label: "Propose Operational Cycle Draft",
    description:
      "Proposes an Operational Cycle or Pipeline Blueprint draft for human review and approval. " +
      "This does NOT deploy or execute the cycle — it creates an approval-gated proposal row in the database " +
      "inheriting the requester's organizational and security permissions, rendering an inline approval card in chat.",
    parameters: z.object({
      name: z.string().describe("The name of the proposed cycle or pipeline"),
      reason: z.string().describe("Why this cycle draft solves the user's objective"),
      scaffoldPacks: z.array(z.string()).default([]).describe("Scaffold packs required (e.g. ['auth-jwt', 'observability-otel'])"),
      stages: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.string().default("task"),
        description: z.string().optional(),
      })).default([]).describe("Stages in the proposed operational cycle"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";

        let proposalId: number;
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");
          const { v4: uuidv4 } = await import("uuid");

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: `cycle_draft_${uuidv4()}`,
              toolName: "propose_cycle_draft",
              toolArgs: params as any,
              approverType: "user",
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.reason,
              organizationId: orgId,
              // NOT NULL with no default; omitting it made every insert throw
              // into the catch below, which fell back to a Date.now() id.
              token: randomBytes(16).toString("hex"),
            })
            .returning({ id: approvalRequests.id });

          proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert approvalRequest database row: ${dbErr.message}`);
          proposalId = Date.now();
        }

        // Marker consumed by client to render inline approval request card
        return JSON.stringify({
          type: "approval_request",
          kind: "cycle_draft",
          proposalId,
          title: `Operational Cycle Draft: "${params.name}"`,
          reason: params.reason,
          cycleName: params.name,
          scaffoldPacks: params.scaffoldPacks,
          stages: params.stages,
          requestedBy,
          organizationId: orgId,
          status: "pending",
          message: `I've prepared a draft for Operational Cycle "${params.name}". It requires human review and approval before execution.`,
        });
      } catch (err: any) {
        return `Failed to propose cycle draft: ${err.message}`;
      }
    },
  },

  propose_app_draft: {
    name: "propose_app_draft",

    idempotency: "idempotent",
    label: "Propose Application Draft",
    description:
      "Configures and saves a new Application Draft to the Organization's App Forge registry and creates an approval-gated proposal card in chat. " +
      "Use this whenever asked to create, draft, or save an application or forged app.",
    parameters: z.object({
      name: z.string().describe("The human-readable name of the application"),
      description: z.string().optional().describe("Description of what the app does and its components"),
      blueprintSlug: z.string().default("custom-app").describe("Blueprint template slug (e.g. 'custom-app', 'calculator-pipeline', 'dashboard')"),
      projectId: z.number().optional().describe("Optional Project ID to scope this application to"),
      components: z.array(z.string()).default([]).describe("UI blocks or components included in the app"),
      pipelineIds: z.array(z.number()).default([]).describe("Optional linked Pipeline IDs triggered by the app"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const requestedBy = context.userId || "assistant";
        const { randomUUID } = await import("node:crypto");
        const jobId = `draft_${randomUUID()}`;
        const slug = params.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        // 1. Persist to App Forge Draft Service
        try {
          const { forgeDraftService } = await import("@domain/apps/core/forge-draft.service.js");
          await forgeDraftService.createOrUpdateDraft({
            jobId,
            blueprintSlug: params.blueprintSlug,
            options: {
              organizationId: orgId,
              name: params.name,
              slug,
              description: params.description || `Draft app created by ${requestedBy}`,
              blueprintSlug: params.blueprintSlug,
              projectId: params.projectId,
              components: params.components,
              pipelineIds: params.pipelineIds,
            } as any,
            status: "awaiting_wave_approval",
            progress: 10,
            message: `Draft App "${params.name}" configured and saved to App Forge workspace.`,
          });
        } catch (forgeErr: any) {
          logger.warn(`Failed to persist to forgeDraftService: ${forgeErr.message}`);
        }

        // 2. Persist to Approval Requests table for 1-click in-chat review
        let proposalId: number;
        try {
          const { db } = await import("@server/database_service.js");
          const { approvalRequests } = await import("@shared/schema/index.js");

          const [inserted] = await db
            .insert(approvalRequests)
            .values({
              executionId: jobId,
              toolName: "propose_app_draft",
              toolArgs: params as any,
              approverType: "user",
              approverEmail: typeof requestedBy === "string" ? requestedBy : String(requestedBy),
              status: "pending",
              comments: params.description || `Draft application: ${params.name}`,
              organizationId: orgId,
              token: randomBytes(16).toString("hex"),
            })
            .returning({ id: approvalRequests.id });

          proposalId = inserted.id;
        } catch (dbErr: any) {
          logger.warn(`Failed to insert approvalRequest database row: ${dbErr.message}`);
          proposalId = Date.now();
        }

        return JSON.stringify({
          type: "approval_request",
          kind: "app_draft",
          proposalId,
          jobId,
          appName: params.name,
          slug,
          blueprintSlug: params.blueprintSlug,
          components: params.components,
          pipelineIds: params.pipelineIds,
          projectId: params.projectId,
          status: "draft_saved",
          href: `/apps/forge?draftId=${jobId}`,
          message: `I've configured and saved the draft for Application "${params.name}". It is registered in App Forge and ready for review.`,
        });
      } catch (err: any) {
        return `Failed to propose app draft: ${err.message}`;
      }
    },
  },

  scaffold_multistep_app: {
    name: "scaffold_multistep_app",
    idempotency: "none",
    label: "Scaffold Multi-Step Application",
    description: "Assembles a multi-screen application blueprint where forms and submitted results on previous screens flow into subsequent screens, pipelines, and ontology actions.",
    parameters: z.object({
      appName: z.string().describe("Human-readable application name"),
      description: z.string().optional().describe("Application summary and business goal"),
      archetype: AppArchetypeSchema.default("workflow_wizard"),
      layout: AppLayoutSchema.optional().describe("Presentation layout selected by plan_app_architecture"),
      capabilities: z.array(z.string()).default([]),
      stages: z.array(MultiStepStageSchema).min(1).describe("List of sequential or branching screen stages"),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const { randomUUID } = await import("node:crypto");
        const activePlan = await readActiveAppPlan(context).catch(() => null);
        const planMatches = !activePlan?.appName || activePlan.appName === params.appName;
        const archetype = (params.archetype as AppArchetype | undefined) || (planMatches ? activePlan?.archetype as AppArchetype | undefined : undefined) || "workflow_wizard";
        const archetypeConfig = ARCHETYPE_CATALOG[archetype];
        const blueprintId = `app-${params.appName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
        
        const blueprint = {
          id: blueprintId,
          name: params.appName,
          version: "1.0.0",
          category: "forged_app" as const,
          description: params.description || `Multi-step application: ${params.appName}`,
          layout: {
            type: params.layout || (planMatches ? activePlan?.layout : undefined) || archetypeConfig.layout,
            defaultVisualization: archetype === "workflow_wizard" ? "mermaid_flowchart" as const : "reactflow_graph" as const,
          },
          archetype,
          capabilities: [...new Set([...archetypeConfig.surfaces, ...(planMatches ? activePlan?.capabilities || [] : []), ...(params.capabilities || [])])],
          stages: (params.stages as MultiStepStage[]).map((s: MultiStepStage, idx: number) => ({
            ...s,
            requires: s.requires.length > 0 ? s.requires : idx > 0 ? [params.stages[idx - 1].id] : [],
            provides: [s.id],
            conflicts: [],
            defaultConfig: {},
            completionCriteria: {
              type: "form_submitted" as const,
            },
          })),
          scaffoldPacks: [],
          variables: {},
        };

        // Generate Mermaid diagram showing data pass-through
        let mermaid = "graph LR\n";
        mermaid += "    classDef ready fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;\n";
        mermaid += "    classDef active fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;\n";

        (params.stages as MultiStepStage[]).forEach((stage: MultiStepStage, idx: number) => {
          mermaid += `    ${stage.id}["${idx + 1}. ${stage.name}"]:::${idx === 0 ? "active" : "ready"}\n`;
        });

        (params.stages as MultiStepStage[]).forEach((stage: MultiStepStage) => {
          if (stage.inputs && Object.keys(stage.inputs).length > 0) {
            Object.entries(stage.inputs).forEach(([targetProp, binding]: [string, ScreenBinding]) => {
              mermaid += `    ${binding.sourceStageId} -->|passes: ${binding.outputKey} -> ${targetProp}| ${stage.id}\n`;
            });
          } else if (stage.requires && stage.requires.length > 0) {
            stage.requires.forEach((reqId: string) => {
              mermaid += `    ${reqId} --> ${stage.id}\n`;
            });
          }
        });

        // Persist blueprint to session memory if available
        if (context?.sessionId || (context as any)?.sessionKey) {
          try {
            const { db } = await import("@server/database_service.js");
            const { crewSessions } = await import("@shared/schema/index.js");
            const { and, eq } = await import("drizzle-orm");
            const sId = context?.sessionId
              ? Number(context.sessionId)
              : (context as any)?.sessionKey
              ? await (async () => {
                  const [s] = await db.select({ id: crewSessions.id }).from(crewSessions).where(eq(crewSessions.sessionKey, String((context as any).sessionKey))).limit(1);
                  return s?.id;
                })()
              : null;
            if (sId) {
              const [existingSession] = await db.select({ memory: crewSessions.memory }).from(crewSessions).where(eq(crewSessions.id, sId)).limit(1);
              const currentMemory = (existingSession?.memory ?? {}) as any;
              const existingApps = Array.isArray(currentMemory.activeAppBlueprints) ? currentMemory.activeAppBlueprints : [];
              const updatedApps = [...existingApps.filter((b: any) => b.id !== blueprint.id), blueprint].slice(-10);
              await db.update(crewSessions).set({
                memory: { ...currentMemory, activeAppBlueprints: updatedApps },
                updatedAt: new Date(),
              }).where(eq(crewSessions.id, sId));
            }
          } catch (memErr: any) {
            // Structured, not the raw unknown: logger.warn's second argument is a
            // fields object, and passing the caught value straight in dropped it.
            logger.warn("Failed to persist app blueprint into session memory", {
              error: memErr?.message ?? String(memErr),
            });
          }
        }

        return {
          success: true,
          type: "assistant_app",
          module: "MultiStepAppPod",
          component: "MultiStepAppPod",
          componentName: "MultiStepAppPod",
          title: `Multi-Step App: ${params.appName}`,
          props: {
            blueprint,
            diagramMermaid: mermaid,
          },
          artifact: {
            type: "assistant_app",
            module: "MultiStepAppPod",
            component: "MultiStepAppPod",
            componentName: "MultiStepAppPod",
            title: `Multi-Step App: ${params.appName}`,
            props: {
              blueprint,
              diagramMermaid: mermaid,
            },
          },
          message: `Successfully assembled Multi-Step Application blueprint "${params.appName}" with ${params.stages.length} screen stages and cross-screen data bindings.\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },

  bind_screen_io: {
    name: "bind_screen_io",

    idempotency: "idempotent",
    label: "Bind Screen Input/Output",
    description: "Wires an output field submitted on an upstream screen into a prop/input required by a downstream screen or action.",
    parameters: z.object({
      targetStageId: z.string().describe("Target screen receiving the data"),
      targetPropKey: z.string().describe("Property name on the target screen"),
      sourceStageId: z.string().describe("Upstream screen providing the data"),
      sourceOutputKey: z.string().describe("Field key submitted on the upstream screen"),
      defaultValue: z.unknown().optional(),
      transform: z.string().optional().describe("Optional transform e.g. 'json_parse', 'number'"),
    }),
    execute: async (params, _context) => {
      return {
        success: true,
        binding: {
          sourceStageId: params.sourceStageId,
          outputKey: params.sourceOutputKey,
          defaultValue: params.defaultValue,
          transform: params.transform,
        },
        message: `Bound {{stages.${params.sourceStageId}.outputs.${params.sourceOutputKey}}} to stage '${params.targetStageId}' prop '${params.targetPropKey}'.`,
      };
    },
  },

  preview_screen_flow: {
    name: "preview_screen_flow",

    idempotency: "read-safe",
    label: "Preview Screen Data Flow",
    description: "Generates a visual Mermaid diagram and data lineage summary for a multi-step screen application.",
    parameters: z.object({
      stages: z.array(ScreenFlowStageSchema),
    }),
    execute: async (params, _context) => {
      let mermaid = "graph LR\n";
      (params.stages as ScreenFlowStage[]).forEach((s: ScreenFlowStage, idx: number) => {
        mermaid += `    ${s.id}["Step ${idx + 1}: ${s.name}"]\n`;
      });
      (params.stages as ScreenFlowStage[]).forEach((s: ScreenFlowStage) => {
        if (s.inputs) {
          Object.entries(s.inputs).forEach(([prop, binding]: [string, { sourceStageId: string; outputKey: string }]) => {
            mermaid += `    ${binding.sourceStageId} -->|${binding.outputKey} ➔ ${prop}| ${s.id}\n`;
          });
        }
      });

      return {
        success: true,
        diagram: mermaid,
        message: `\`\`\`mermaid\n${mermaid}\n\`\`\``,
      };
    },
  },

  deploy_forged_app: {
    name: "deploy_forged_app",

    idempotency: "none",
    label: "Deploy Forged Application",
    description:
      "Deploys an application blueprint or draft into the active workspace apps registry with status 'active'. " +
      "Generates the live app URL, links pipelines, components, and registers the app in the App Gallery and X-Ray Architecture.",
    parameters: z.object({
      name: z.string().describe("Human-readable name of the application"),
      slug: z.string().optional().describe("Unique URL slug (e.g. 'incident-triage-app')"),
      description: z.string().optional().describe("Description of what the app does"),
      blueprintSlug: z.string().default("custom-app").describe("Blueprint template slug"),
      projectId: z.number().optional().describe("Project ID to scope the application to"),
      components: z.array(z.string()).default([]).describe("UI blocks/components in the app"),
      pipelineIds: z.array(z.number()).default([]).describe("Linked Pipeline IDs triggered by the app"),
      stages: z.array(z.unknown()).optional().describe("Optional multi-step screen stages"),
      isPublic: z.boolean().default(false),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        const activePlan = await readActiveAppPlan(context).catch(() => null);
        const architecturePlan = (!activePlan?.appName || activePlan.appName === params.name) ? activePlan : null;
        const createdBy = typeof context.userId === "string" ? context.userId : "crew_agent";
        const baseSlug = (params.slug || params.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const uniqueSlug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;

        const { db } = await import("@server/database_service.js");
        const { apps } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");

        // Check if existing app with name or slug
        const [existing] = await db
          .select()
          .from(apps)
          .where(and(eq(apps.organizationId, orgId), eq(apps.name, params.name)))
          .limit(1);

        let deployedApp;
        if (existing) {
          const [updated] = await db
            .update(apps)
            .set({
              description: params.description || existing.description,
              status: "active",
              blueprintSlug: params.blueprintSlug || existing.blueprintSlug,
              projectId: params.projectId ?? existing.projectId,
              config: {
                ...(existing.config || {}),
                components: params.components.length ? params.components : (existing.config as any)?.components,
                pipelineIds: params.pipelineIds.length ? params.pipelineIds : (existing.config as any)?.pipelineIds,
                stages: params.stages || (existing.config as any)?.stages,
                architecturePlan: architecturePlan || (existing.config as any)?.architecturePlan,
                deployedVia: "CREW_ROOM",
                deployedAt: new Date().toISOString(),
              },
              updatedAt: new Date(),
            })
            .where(eq(apps.id, existing.id))
            .returning();
          deployedApp = updated;
        } else {
          const [inserted] = await db
            .insert(apps)
            .values({
              name: params.name,
              slug: uniqueSlug,
              description: params.description || `Application created in CREW Room`,
              organizationId: orgId,
              developerOrgId: orgId,
              blueprintSlug: params.blueprintSlug,
              status: "active",
              createdBy,
              isPublic: params.isPublic ?? false,
              isSystem: false,
              distribution: "custom",
              projectId: params.projectId,
              config: {
                components: params.components,
                pipelineIds: params.pipelineIds,
                stages: params.stages || [],
                architecturePlan,
                deployedVia: "CREW_ROOM",
                deployedAt: new Date().toISOString(),
              },
              version: "1.0.0",
            })
            .returning();
          deployedApp = inserted;
        }

        return JSON.stringify({
          type: "app_deployed",
          success: true,
          appId: deployedApp.id,
          name: deployedApp.name,
          slug: deployedApp.slug,
          status: deployedApp.status,
          launchUrl: `/apps/forge?appId=${deployedApp.id}`,
          dashboardUrl: `/apps`,
          components: params.components,
          pipelineIds: params.pipelineIds,
          message: `🚀 Application "${deployedApp.name}" has been successfully deployed! It is live and active in the organization app registry.\n\n- **Launch URL:** [/apps/forge?appId=${deployedApp.id}](file:///apps/forge?appId=${deployedApp.id})\n- **Status:** Active\n- **Version:** ${deployedApp.version}`,
        });
      } catch (err: any) {
        logger.error("[AssemblyTools] Failed to deploy forged app:", err);
        return JSON.stringify({
          success: false,
          error: `Deployment error: ${err?.message || String(err)}`,
        });
      }
    },
  },

  commit_project_plan_to_cycle: {
    name: "commit_project_plan_to_cycle",
    // A retry of the same plan in the same room returns the same cycle (the
    // commit key is derived from both), but this stays "none": the planner runs
    // "idempotent" tools speculatively, and saving a cycle nobody asked for is a
    // side effect even when repeating it is harmless.
    idempotency: "none",
    label: "Save Project Plan as Cycle (pending approval)",
    description:
      "Saves a Project Studio wave plan as an Operational Cycle that is PENDING APPROVAL. Nothing runs until " +
      "someone approves the cycle. Waves carry dependencies (predecessor wave ids), acceptance criteria, " +
      "tasks, studio targets and assignees; human-assigned waves become approval milestones, not AI missions.",
    parameters: projectPlanFieldsSchema.extend({
      projectId: z.number().int().positive().optional()
        .describe("Project Space ID. Ignored in favour of the room's project when the room belongs to one; must match it otherwise."),
    }),
    execute: async (params, context: ToolContext) => {
      try {
        const orgId = requireToolOrgId(context);
        if (typeof context.userId !== "string" || !context.userId) {
          throw new Error("A signed-in user is required to save a plan as a cycle.");
        }
        const { commitProjectPlan, resolvePlanActorRoles } = await import("@domain/mission/core/project-plan-commit.service.js");
        const { projectId, ...plan } = params;
        const sessionKey = typeof context.sessionKey === "string" ? context.sessionKey : undefined;
        const contextProjectId = Number.isInteger(Number(context.projectId)) && Number(context.projectId) > 0
          ? Number(context.projectId)
          : null;
        const idempotencyKey = `tool:${createHash("sha256")
          .update(JSON.stringify({ sessionKey: sessionKey ?? null, projectId: projectId ?? contextProjectId, plan }))
          .digest("hex")
          .slice(0, 48)}`;

        const result = await commitProjectPlan(
          { plan, idempotencyKey, sessionKey, projectId, contextProjectId },
          {
            organizationId: orgId,
            userId: context.userId,
            // Roles come from the database, not from the context: CREW's context
            // carries none, and a tool must not be able to assert them.
            ...(await resolvePlanActorRoles(context.userId, orgId)),
            // CREW's buildCrewToolContext names the speaker `agentName`; project
            // grants are keyed by that same name, so it is the ceiling to apply.
            agentId: typeof context.agentId === "string" ? context.agentId
              : typeof context.agentName === "string" ? context.agentName : undefined,
          },
        );

        return JSON.stringify({
          type: "cycle_committed",
          success: true,
          ...result,
          launchUrl: result.cycleUrl,
          message: `Saved "${result.name}" as cycle #${result.cycleId} with ${result.blueprintCount} waves. ` +
            `Status: ${result.status} — nothing runs until the cycle is approved at ${result.cycleUrl}.` +
            (result.replayed ? " (This plan had already been saved; returning the existing cycle.)" : ""),
        });
      } catch (err: any) {
        logger.error("[AssemblyTools] Failed to commit project plan to cycle:", err);
        return JSON.stringify({
          success: false,
          error: `Failed to commit cycle: ${err?.message || String(err)}`,
        });
      }
    },
  },
};
