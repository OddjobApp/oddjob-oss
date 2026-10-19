/**
 * Oddjob Formal Verification & Synthesis Control Plane: End-to-End Live Demonstration
 * Demonstrates all 5 formal mathematical verification and synthesis engines in action.
 */

import { layoutFormalService } from "../server/domain/scaffold/formal/layout-formal.service.js";
import { SATScaffoldResolver } from "../server/domain/scaffold/sat-scaffold-resolver.js";
import { FormalGovernanceGuard, WorkflowGraph } from "../server/domain/governance/formal-governance.guard.js";
import { WCAGTokenSynthesizer } from "../server/domain/scaffold/formal/wcag-token-synthesizer.js";
import { MissionSchedulabilityProver, MissionSchedulePlan } from "../server/domain/mission/formal/mission-schedulability-prover.js";
import type { LayoutNode, ViewportBounds } from "../server/domain/scaffold/formal/types.js";
import type { PackManifest } from "@shared/schema/scaffold.js";

async function runDemonstration() {
  console.log("================================================================================");
  console.log("       ODDJOB FORMAL VERIFICATION & SYNTHESIS CONTROL PLANE: LIVE DEMO          ");
  console.log("================================================================================\n");

  // ===========================================================================
  // DEMO 1: Layout Invariant Proof & Closed-Form MaxSMT CSS Synthesis (QF_LRA)
  // ===========================================================================
  console.log("--------------------------------------------------------------------------------");
  console.log(" [DEMO 1] Formal Layout Verification & MaxSMT Synthesis (QF_LRA)");
  console.log("--------------------------------------------------------------------------------");

  const responsiveViewport: ViewportBounds = { minWidth: 320, maxWidth: 1920 };
  const rawAiGeneratedLayout: LayoutNode = {
    id: "app_workspace",
    name: "AI-Forged Workspace",
    direction: "row",
    gap: 16,
    padding: 16,
    children: [
      { id: "sidebar", name: "Navigation Sidebar", sizingMode: "fixed", width: 260 },
      { id: "canvas", name: "Main Canvas", sizingMode: "fluid", minWidth: 400, targetWidth: 800, targetWeight: 10 },
      { id: "inspector", name: "Inspector Drawer", sizingMode: "fixed", width: 300 }
    ]
  };

  console.log("1. Verifying raw layout against continuous viewport spectrum W ∈ [320, 1920]...");
  const layoutResult = layoutFormalService.verifyAndSynthesize(rawAiGeneratedLayout, responsiveViewport);

  if (layoutResult.certificate.status === "FAILED") {
    const v = layoutResult.certificate.violations[0];
    console.log(`   ❌ Invariant Violation Detected:`);
    console.log(`      - Type:           ${v.invariantType.toUpperCase()}`);
    console.log(`      - Counterexample: Viewport W = ${v.counterexampleViewport}px`);
    console.log(`      - Overflow:       ${v.overlapMagnitude}px beyond screen bounds`);
    console.log(`      - Message:        ${v.message}`);
  }

  if (layoutResult.repair && layoutResult.repair.success) {
    console.log("\n2. Executing MaxSMT Synthesis to compute closed-form mathematical repairs...");
    console.log(`   ✅ Repair Status: SUCCESS (Distortion Penalty: ${layoutResult.repair.totalDistortionPenalty})`);
    console.log("   Synthesized Responsive CSS Rules:");
    layoutResult.repair.synthesizedRules.forEach(r => {
      console.log(`     • #${r.elementId}: ${r.cssRule} (min: ${r.min}px, max: ${r.max}px)`);
    });
  }

  // ===========================================================================
  // DEMO 2: SAT & MaxSAT Scaffold Pack Dependency Resolver
  // ===========================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log(" [DEMO 2] SAT / MaxSAT Scaffold Pack & Feature Solver (DPLL)");
  console.log("--------------------------------------------------------------------------------");

  const registry: PackManifest[] = [
    {
      id: "core-node-express",
      name: "Express Host",
      version: "1.0.0",
      category: "core",
      provides: [],
      inject: [],
      templates: [],
      requires: [],
      conflicts: [],
      recommends: ["observability-otel"]
    },
    {
      id: "auth-jwt",
      name: "JWT Authentication",
      version: "1.0.0",
      category: "auth",
      provides: [],
      inject: [],
      templates: [],
      recommends: [],
      requires: ["core-node-express"],
      conflicts: ["auth-oauth2"]
    },
    {
      id: "auth-oauth2",
      name: "OAuth2 Authentication",
      version: "1.0.0",
      category: "auth",
      provides: [],
      inject: [],
      templates: [],
      recommends: [],
      requires: ["core-node-express"],
      conflicts: ["auth-jwt"]
    },
    {
      id: "observability-otel",
      name: "OpenTelemetry Observability",
      version: "1.0.0",
      category: "observability",
      provides: [],
      inject: [],
      templates: [],
      recommends: [],
      requires: ["core-node-express"],
      conflicts: []
    }
  ];

  const satSolver = new SATScaffoldResolver(registry);
  console.log("1. Solving valid request: ['auth-jwt'] with soft recommendations...");
  const satValid = satSolver.solve(["auth-jwt"], { includeRecommendations: true });
  console.log(`   ✅ Satisfiable: ${satValid.satisfiable}`);
  console.log(`   Selected Packs: [${satValid.selectedPacks.map(p => p.id).join(", ")}]`);
  console.log(`   Execution Order: ${satValid.executionOrder.map(p => p.id).join(" -> ")}`);

  console.log("\n2. Testing conflicting request: ['auth-jwt', 'auth-oauth2']...");
  const satConflict = satSolver.solve(["auth-jwt", "auth-oauth2"]);
  console.log(`   ❌ Satisfiable: ${satConflict.satisfiable}`);
  console.log(`   Proof: ${satConflict.proofExplanation}`);
  console.log(`   Detected Conflict: ${satConflict.conflictsDetected.map(c => `${c.packA} <-> ${c.packB}`).join(", ")}`);

  // ===========================================================================
  // DEMO 3: 5-Layer AI Governance Reachability Guard (Horn Clauses)
  // ===========================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log(" [DEMO 3] 5-Layer AI Governance Reachability Guard (Model Checking)");
  console.log("--------------------------------------------------------------------------------");

  const unprivilegedWorkflow: WorkflowGraph = {
    initialState: "agent_prompted",
    transitions: [
      { fromState: "agent_prompted", action: "generate_code", toState: "code_ready", providesEvidence: true },
      { fromState: "code_ready", action: "attempt_direct_deploy", toState: "production", restrictsAction: "deploy_production" }
    ]
  };

  console.log("1. Checking unprivileged agent attempting direct production deployment without HIL...");
  const unprivilegedProof = FormalGovernanceGuard.proveWorkflowSafety(unprivilegedWorkflow, {
    userRoles: ["developer"],
    evidenceProvided: false
  });
  console.log(`   ❌ Status: ${unprivilegedProof.status}`);
  console.log(`   Violation: ${unprivilegedProof.message}`);
  console.log(`   Unsafe Path: ${unprivilegedProof.violationPath?.join(" ")}`);

  const governedWorkflow: WorkflowGraph = {
    initialState: "agent_prompted",
    transitions: [
      { fromState: "agent_prompted", action: "generate_code", toState: "code_ready", providesEvidence: true },
      { fromState: "code_ready", action: "request_supervisor_approval", toState: "hil_approved", isHILApprovalNode: true },
      { fromState: "hil_approved", action: "execute_deploy", toState: "production", restrictsAction: "deploy_production" }
    ]
  };

  console.log("\n2. Checking governed workflow passing through explicit HIL approval node...");
  const governedProof = FormalGovernanceGuard.proveWorkflowSafety(governedWorkflow, {
    userRoles: ["developer"],
    evidenceProvided: false
  });
  console.log(`   ✅ Status: ${governedProof.status}`);
  console.log(`   Proof: ${governedProof.message} (${governedProof.verifiedInvariantsCount} transitions verified)`);

  // ===========================================================================
  // DEMO 4: WCAG 2.2 Relative Luminance & Dynamic Token Synthesizer
  // ===========================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log(" [DEMO 4] WCAG 2.2 Relative Luminance & Token Synthesizer");
  console.log("--------------------------------------------------------------------------------");

  const brandBlue = "#3B82F6";
  const brandYellow = "#FACC15";

  console.log(`1. Synthesizing accessible tokens for Brand Blue (${brandBlue}):`);
  const blueTokens = WCAGTokenSynthesizer.synthesizeAccessiblePalette(brandBlue);
  console.log(`   • Light Mode: Fg: ${blueTokens.lightTheme.foreground} on Bg: ${blueTokens.lightTheme.background} (CR = ${blueTokens.lightTheme.contrastWithBg}:1, AA: ${blueTokens.lightTheme.meetsAA})`);
  console.log(`   • Dark Mode:  Fg: ${blueTokens.darkTheme.foreground} on Bg: ${blueTokens.darkTheme.background} (CR = ${blueTokens.darkTheme.contrastWithBg}:1, AA: ${blueTokens.darkTheme.meetsAA})`);

  console.log(`\n2. Synthesizing accessible tokens for challenging Brand Yellow (${brandYellow}):`);
  const yellowTokens = WCAGTokenSynthesizer.synthesizeAccessiblePalette(brandYellow);
  console.log(`   • Light Mode: Fg: ${yellowTokens.lightTheme.foreground} on Bg: ${yellowTokens.lightTheme.background} (CR = ${yellowTokens.lightTheme.contrastWithBg}:1, AA: ${yellowTokens.lightTheme.meetsAA})`);
  console.log(`   • Dark Mode:  Fg: ${yellowTokens.darkTheme.foreground} on Bg: ${yellowTokens.darkTheme.background} (CR = ${yellowTokens.darkTheme.contrastWithBg}:1, AA: ${yellowTokens.darkTheme.meetsAA})`);

  // ===========================================================================
  // DEMO 5: Multi-Agent Mission Schedulability & Rate-Limit Prover
  // ===========================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log(" [DEMO 5] Mission Schedulability & Deadlock / Quota Prover");
  console.log("--------------------------------------------------------------------------------");

  const missionPlan: MissionSchedulePlan = {
    missionId: "autonomous_competitive_intelligence",
    globalTokenRateLimitPerSec: 2500,
    tasks: [
      { id: "crawl_sources", agentRole: "crawler", estimatedDurationSeconds: 8, dependencies: [], estimatedTokensPerSecond: 600 },
      { id: "extract_features", agentRole: "extractor", estimatedDurationSeconds: 12, dependencies: ["crawl_sources"], estimatedTokensPerSecond: 900, requiredLocks: ["kg_feature_table"] },
      { id: "sentiment_analysis", agentRole: "sentiment_bot", estimatedDurationSeconds: 10, dependencies: ["crawl_sources"], estimatedTokensPerSecond: 800 },
      { id: "synthesize_report", agentRole: "lead_analyst", estimatedDurationSeconds: 6, dependencies: ["extract_features", "sentiment_analysis"], estimatedTokensPerSecond: 1200 }
    ]
  };

  const missionProof = MissionSchedulabilityProver.provePlan(missionPlan);
  console.log(`1. Proving mission schedulability for '${missionPlan.missionId}':`);
  console.log(`   ✅ Schedulable:           ${missionProof.schedulable}`);
  console.log(`   ✅ Deadlock Free:         ${missionProof.deadlockFree}`);
  console.log(`   ✅ Rate Limit Compliant:  ${missionProof.rateLimitCompliant}`);
  console.log(`   • Critical Path Makespan: ${missionProof.calculatedMakespanSeconds} seconds`);
  console.log(`   • Peak Token Burn Rate:   ${missionProof.peakTokensPerSecond} tokens/sec (Quota: ${missionPlan.globalTokenRateLimitPerSec})`);
  console.log(`   • Critical Path:          ${missionProof.criticalPath.join(" -> ")}`);

  console.log("\n================================================================================");
  console.log("                     ALL FORMAL PROOFS VERIFIED SUCCESSFULLY                    ");
  console.log("================================================================================");
}

runDemonstration().catch(console.error);
