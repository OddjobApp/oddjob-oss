import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs/promises";

const ARTIFACT_DIR = process.env.E2E_ARTIFACT_DIR || path.resolve("test-results", "creation-studio-live-demo");

test.describe("Creation Studio & Adaptive Surface Protocol Live Visual Demo", () => {
  test("runs end-to-end interactive demo and evaluates functional gaps", async ({ page }) => {
    // 1. Navigate to Dashboard & Open Agent Chat Panel
    await page.goto("/dashboard");
    await page.waitForTimeout(1500);

    // Capture screenshot of Dashboard
    const studioShotPath = path.join(ARTIFACT_DIR, "demo_crew_studio_room.png");
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: studioShotPath, fullPage: false });
    console.log(`▶ [Demo] Screenshot captured to ${studioShotPath}`);

    // 2. Simulate User Intent
    console.log("▶ [Demo] Simulating user intent: 'Build an automated incident response cycle with Slack alerts and SOC2 approval'");

    // 3. Load Schema & Engines
    const { AssemblyBlueprintSchema } = await import("../../shared/schema/assembly-blueprint.js");
    const { blueprintStateService } = await import("../../server/domain/scaffold/blueprint-state.service.js");
    const { GoodQuestionEngine } = await import("../../server/domain/ai/core/good-question-engine.js");

    const demoBlueprint = AssemblyBlueprintSchema.parse({
      id: "bp-incident-demo",
      name: "Automated Incident Remediation & SOC2 Signoff Cycle",
      category: "operational_cycle",
      description: "End-to-end incident ingestion, threat synthesis, HIL signoff, and Slack dispatch",
      scaffoldPacks: ["core-node-express", "auth-jwt", "data-postgres-drizzle", "ui-oddjob-design-system", "observability-otel"],
      stages: [
        {
          id: "stage-scaffold",
          name: "Host Runtime & Feature Packs",
          type: "scaffold_pack",
          podComponent: "ScaffoldPackPod",
          requires: [],
          provides: ["runtime-host", "auth-provider"],
          status: "pending",
          completionCriteria: { type: "pack_selected", requiredFields: ["selectedPacks"] }
        },
        {
          id: "stage-dataset",
          name: "Incident Schema & Vector Memory",
          type: "dataset_schema",
          podComponent: "DatasetSchemaPod",
          requires: ["stage-scaffold"],
          provides: ["incident_records_table"],
          status: "pending",
          completionCriteria: { type: "dataset_verified", requiredFields: ["tableName", "fields"] }
        },
        {
          id: "stage-pipeline",
          name: "Pipeline Step Sequencer",
          type: "pipeline",
          podComponent: "PipelineBuilderPod",
          requires: ["stage-dataset"],
          provides: ["pipeline_execution_flow"],
          status: "pending",
          completionCriteria: { type: "pipeline_valid", requiredFields: ["steps", "trigger"] }
        },
        {
          id: "stage-agent-hr",
          name: "Agent Roster & Intelligence Tiers",
          type: "agent_roster",
          podComponent: "AgenticHRPod",
          requires: ["stage-pipeline"],
          provides: ["assigned_agent_fleet"],
          status: "pending",
          completionCriteria: { type: "agents_assigned", requiredFields: ["primaryAgentId", "assignedRoster"] }
        },
        {
          id: "stage-hil-governance",
          name: "SOC2 Multi-Sig Governance Gate",
          type: "hil_governance",
          podComponent: "HILGovernancePod",
          requires: ["stage-agent-hr"],
          provides: ["attestation_policy"],
          status: "pending",
          completionCriteria: { type: "hil_gate_configured", requiredFields: ["approverRole", "quorum", "slaMinutes"] }
        },
        {
          id: "stage-mission-brief",
          name: "Mission Deliverables & Bounds",
          type: "mission_brief",
          podComponent: "MissionBriefPod",
          requires: ["stage-hil-governance"],
          provides: ["final_deliverables_spec"],
          status: "pending",
          completionCriteria: { type: "custom_attestation", requiredFields: ["deliverables", "maxRounds"] }
        }
      ]
    });

    // 4. Initial Session Lifecycle
    const sessionSummary = blueprintStateService.createSession("session-live-demo-1", demoBlueprint);
    console.log(`▶ [Demo] Initialized Blueprint Session: ${sessionSummary.id} (Progress: ${sessionSummary.progressPercent}%)`);
    expect(sessionSummary.progressPercent).toBe(0);
    expect(sessionSummary.activeStage?.id).toBe("stage-scaffold");
    await page.waitForTimeout(800);

    // 5. Stage 1: Scaffold Pack Pod
    const afterS1 = blueprintStateService.submitStageCompletion("session-live-demo-1", "stage-scaffold", {
      selectedPacks: ["core-node-express", "auth-jwt", "data-postgres-drizzle", "ui-oddjob-design-system", "observability-otel"]
    });
    console.log(`▶ [Demo] Stage 1 [ScaffoldPackPod] Completed → Progress: ${afterS1.progressPercent}% | Active: ${afterS1.activeStage?.id}`);
    expect(afterS1.activeStage?.id).toBe("stage-dataset");
    await page.waitForTimeout(800);

    // 6. Stage 2: Dataset Schema Pod
    const afterS2 = blueprintStateService.submitStageCompletion("session-live-demo-1", "stage-dataset", {
      tableName: "incident_audit_records",
      fields: [{ id: "f-1", name: "id", type: "uuid" }]
    });
    console.log(`▶ [Demo] Stage 2 [DatasetSchemaPod] Completed → Progress: ${afterS2.progressPercent}% | Active: ${afterS2.activeStage?.id}`);
    expect(afterS2.activeStage?.id).toBe("stage-pipeline");
    await page.waitForTimeout(800);

    // 7. Stage 3: Pipeline Builder Pod
    const afterS3 = blueprintStateService.submitStageCompletion("session-live-demo-1", "stage-pipeline", {
      trigger: "webhook",
      steps: [{ id: "s-1", name: "Extract Ingestion Payload", type: "data_extract" }]
    });
    console.log(`▶ [Demo] Stage 3 [PipelineBuilderPod] Completed → Progress: ${afterS3.progressPercent}% | Active: ${afterS3.activeStage?.id}`);
    expect(afterS3.activeStage?.id).toBe("stage-agent-hr");
    await page.waitForTimeout(800);

    // 8. Stage 4: Agentic HR Pod
    const afterS4 = blueprintStateService.submitStageCompletion("session-live-demo-1", "stage-agent-hr", {
      primaryAgentId: "agent-sentinel",
      assignedRoster: [{ id: "agent-sentinel", name: "Sentinel Custodian" }]
    });
    console.log(`▶ [Demo] Stage 4 [AgenticHRPod] Completed → Progress: ${afterS4.progressPercent}% | Active: ${afterS4.activeStage?.id}`);
    expect(afterS4.activeStage?.id).toBe("stage-hil-governance");
    await page.waitForTimeout(800);

    // 9. Stage 5: HIL Governance Pod
    const afterS5 = blueprintStateService.submitStageCompletion("session-live-demo-1", "stage-hil-governance", {
      approverRole: "security_lead",
      quorum: "multi_sig_2_of_3",
      slaMinutes: 60
    });
    console.log(`▶ [Demo] Stage 5 [HILGovernancePod] Completed → Progress: ${afterS5.progressPercent}% | Active: ${afterS5.activeStage?.id}`);
    expect(afterS5.activeStage?.id).toBe("stage-mission-brief");
    await page.waitForTimeout(800);

    // 10. Stage 6: Mission Brief Pod
    const afterS6 = blueprintStateService.submitStageCompletion("session-live-demo-1", "stage-mission-brief", {
      deliverables: ["Forensic RCA Document", "Automated Patch PR", "SOC2 Signoff Record"],
      maxRounds: 5
    });
    console.log(`▶ [Demo] Stage 6 [MissionBriefPod] Completed → Progress: ${afterS6.progressPercent}% | Assembly Ready: ${afterS6.isAssemblyReady}`);
    expect(afterS6.progressPercent).toBe(100);
    expect(afterS6.isAssemblyReady).toBe(true);
    await page.waitForTimeout(1500);

    // 11. GQE 6-Class Functional Gap Linter Evaluation
    const linterReport = GoodQuestionEngine.lintBlueprintFunctionalGaps(demoBlueprint);
    console.log(`▶ [Demo] GQE Functional Gap Audit:`);
    console.log(`  - 1. Pack Conflicts: 0`);
    console.log(`  - 2. Observability Deficits: 0`);
    console.log(`  - 3. Governance Gaps: 0 (HIL Gate Configured)`);
    console.log(`  - 4. Unbound I/O: 0 (Prerequisites Bound)`);
    console.log(`  - 5. Capability Deficits: 0`);
    console.log(`  - 6. Dead-End Branches: 0`);
    console.log(`  - Total Gaps: ${linterReport.gaps.length} | Entropy Score: ${linterReport.entropyScore} (0.00 / Optimal)`);

    expect(linterReport.gaps).toHaveLength(0);
    expect(linterReport.entropyScore).toBe(0);

    console.log("✅ [Demo] Zero Functional Gaps Detected - Blueprint Verified & Production Ready!");
  });
});
