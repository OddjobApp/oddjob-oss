import { describe, it, expect } from "vitest";
import { AssemblyBlueprintSchema } from "@shared/schema/assembly-blueprint.js";
import { ASSEMBLY_TOOLS } from "../../tools/v1/capabilities/assembly-tools.js";

describe("Multi-Step Application Blueprints & Cross-Screen State Passing", () => {
  it("plans distinct application archetypes instead of routing everything to a wizard", async () => {
    const spatial = await ASSEMBLY_TOOLS.plan_app_architecture.execute({
      appName: "Fleet Command",
      requirements: "A live geospatial map with asset layers and a selected asset detail panel",
      capabilities: ["alerts"],
      integrations: [],
    }, {} as any);

    const analytics = await ASSEMBLY_TOOLS.plan_app_architecture.execute({
      appName: "Revenue Intelligence",
      requirements: "An executive KPI dashboard with charts, filters and drilldowns",
      capabilities: [],
      integrations: ["warehouse"],
    }, {} as any);

    expect(spatial.plan.archetype).toBe("spatial_workspace");
    expect(spatial.plan.layout).toBe("spatial_canvas");
    expect(spatial.plan.capabilities).toContain("alerts");
    expect(spatial.type).toBe("instant_app");
    expect(spatial.module).toBe("AppArchitecturePlanPod");
    expect(spatial.props.catalog.spatial_workspace.layout).toBe("spatial_canvas");
    expect(analytics.plan.archetype).toBe("analytics_dashboard");
    expect(analytics.plan.layout).toBe("dashboard");
    expect(analytics.plan.requiresForgeGeneration).toBe(true);
  });

  it("validates AssemblyBlueprint with screen data bindings and transitions", () => {
    const validBlueprint = {
      id: "app-lead-qualification",
      name: "Lead Qualification Wizard",
      version: "1.0.0",
      category: "forged_app" as const,
      description: "A 3-step lead qualification and scoring wizard",
      layout: {
        type: "modal_wizard" as const,
        defaultVisualization: "mermaid_flowchart" as const,
      },
      stages: [
        {
          id: "intake_screen",
          name: "Lead Intake Form",
          description: "Capture company name, revenue, and contact email",
          type: "screen_step" as const,
          requires: [],
          provides: ["intake_screen"],
          conflicts: [],
          podComponent: "MultiStepScreenContainer",
          inputs: {},
          outputsSchema: {
            companyName: { type: "string", required: true },
            annualRevenue: { type: "number", required: true },
            contactEmail: { type: "string", required: true },
          },
          transitions: [
            { targetStageId: "scoring_pipeline", label: "Submit & Run Scoring" }
          ],
          completionCriteria: {
            type: "form_submitted" as const,
          },
        },
        {
          id: "scoring_pipeline",
          name: "Credit & Risk Scoring",
          description: "Runs automated ML credit scoring on the submitted lead",
          type: "pipeline" as const,
          requires: ["intake_screen"],
          provides: ["scoring_pipeline"],
          conflicts: [],
          podComponent: "PipelineBuilderPod",
          inputs: {
            targetCompany: {
              sourceStageId: "intake_screen",
              outputKey: "companyName",
            },
            revenue: {
              sourceStageId: "intake_screen",
              outputKey: "annualRevenue",
              transform: "number",
            }
          },
          outputsSchema: {
            creditScore: { type: "number" },
            tier: { type: "string" },
          },
          transitions: [
            { targetStageId: "approval_screen", label: "Proceed to Final Signoff" }
          ],
          completionCriteria: {
            type: "pipeline_valid" as const,
          },
        },
        {
          id: "approval_screen",
          name: "Executive Approval Signoff",
          description: "Final human-in-the-loop signoff with calculated credit tier",
          type: "hil_governance" as const,
          requires: ["scoring_pipeline"],
          provides: ["approval_screen"],
          conflicts: [],
          podComponent: "HILGovernancePod",
          inputs: {
            computedTier: {
              sourceStageId: "scoring_pipeline",
              outputKey: "tier",
            },
            leadName: {
              sourceStageId: "intake_screen",
              outputKey: "companyName",
            }
          },
          outputsSchema: {
            approved: { type: "boolean" },
            signerNotes: { type: "string" },
          },
          transitions: [],
          completionCriteria: {
            type: "hil_gate_configured" as const,
          },
        }
      ],
      scaffoldPacks: [],
      variables: {},
    };

    const parsed = AssemblyBlueprintSchema.parse(validBlueprint);
    expect(parsed.id).toBe("app-lead-qualification");
    expect(parsed.stages).toHaveLength(3);
    expect(parsed.stages[1].inputs?.targetCompany.outputKey).toBe("companyName");
    expect(parsed.stages[2].inputs?.computedTier.sourceStageId).toBe("scoring_pipeline");
  });

  it("executes scaffold_multistep_app tool and produces valid Mermaid data flow", async () => {
    const params = {
      appName: "Diagnostic Triage Portal",
      description: "2-screen telemetry intake and remediation action",
      stages: [
        {
          id: "screen_sensor_select",
          name: "Select Target Sensor",
          type: "screen_step" as const,
          requires: [],
          podComponent: "MultiStepScreenContainer",
          inputs: {},
          outputsSchema: { sensorId: { type: "string" } },
          transitions: [{ targetStageId: "screen_remediation_action" }],
        },
        {
          id: "screen_remediation_action",
          name: "Dispatch Remediation",
          type: "screen_step" as const,
          requires: ["screen_sensor_select"],
          podComponent: "MultiStepScreenContainer",
          inputs: {
            activeSensor: {
              sourceStageId: "screen_sensor_select",
              outputKey: "sensorId",
            }
          },
          outputsSchema: { actionResult: { type: "string" } },
          transitions: [],
        }
      ],
    };

    const result = await ASSEMBLY_TOOLS.scaffold_multistep_app.execute(params, {} as any);

    expect(result.success).toBe(true);
    expect(result.props.blueprint.stages).toHaveLength(2);
    expect(result.props.diagramMermaid).toContain("screen_sensor_select -->|passes: sensorId -> activeSensor| screen_remediation_action");
    expect(result.message).toContain("Diagnostic Triage Portal");
  });

  it("preserves planned case-management layout and capabilities in the blueprint", async () => {
    const result = await ASSEMBLY_TOOLS.scaffold_multistep_app.execute({
      appName: "Incident Desk",
      description: "Triage and resolve operational cases",
      archetype: "case_management",
      layout: "kanban_board",
      capabilities: ["sla_tracking"],
      stages: [{
        id: "triage",
        name: "Triage",
        type: "screen_step",
        requires: [],
        podComponent: "MultiStepScreenContainer",
        inputs: {},
        outputsSchema: {},
        transitions: [],
      }],
    }, {} as any);

    expect(result.props.blueprint.layout.type).toBe("kanban_board");
    expect(result.props.blueprint.archetype).toBe("case_management");
    expect(result.props.blueprint.capabilities).toContain("case_queue");
    expect(result.props.blueprint.capabilities).toContain("sla_tracking");
  });

  it("executes bind_screen_io tool to wire upstream outputs into downstream inputs", async () => {
    const bindParams = {
      targetStageId: "summary_screen",
      targetPropKey: "userAccountId",
      sourceStageId: "onboarding_form",
      sourceOutputKey: "accountId",
      transform: "number",
    };

    const result = await ASSEMBLY_TOOLS.bind_screen_io.execute(bindParams, {} as any);

    expect(result.success).toBe(true);
    expect(result.binding.sourceStageId).toBe("onboarding_form");
    expect(result.binding.outputKey).toBe("accountId");
    expect(result.binding.transform).toBe("number");
  });
});
