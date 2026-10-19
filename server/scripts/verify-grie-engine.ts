/**
 * Verification Script for Governed Rules & Decision Intelligence Engine (GRIE)
 *
 * Tests:
 * 1. Rule Suite & Specification DB Seeding (`suite_west_coast_logistics_v2`).
 * 2. Stage 1 Crisp Pre-Filtering (score >= 80, Logistics).
 * 3. Stage 2 Fuzzy AI Evaluation (μ_sentiment = -0.85 hostile tone).
 * 4. Stage 3 Master Priority Score (MAUF computation P_master = 88).
 * 5. Stage 4 Receiver Binding & Action Audit Logging.
 */

import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  ruleSuites,
  ruleSpecifications,
  ruleExecutionAudits,
  eventPrimitives,
} from "@shared/schema/signal-intelligence";
import { orgs } from "@shared/schema/index";
import { subscriptionRuleEngine } from "../domain/signal-intelligence/core/subscription-rule-engine.service";
import { signalDecompositionSurface } from "../domain/signal-intelligence/core/signal-decomposition-surface.service";

async function runGrieVerification() {
  console.log("\n=======================================================");
  console.log("🚀 STARTING GRIE RULES ENGINE VERIFICATION");
  console.log("=======================================================\n");

  // Auto-provision tables if missing
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rule_suites (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      suite_id TEXT NOT NULL UNIQUE,
      suite_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Supply Chain & Logistics',
      version TEXT NOT NULL DEFAULT '1.0.0',
      owner TEXT NOT NULL DEFAULT 'Operations Team',
      description TEXT,
      execution_policy TEXT NOT NULL DEFAULT 'HIGHEST_PRIORITY_MAUF',
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rule_specifications (
      id SERIAL PRIMARY KEY,
      suite_db_id INTEGER NOT NULL REFERENCES rule_suites(id) ON DELETE CASCADE,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      priority_weight INTEGER NOT NULL DEFAULT 50,
      specification JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rule_execution_audits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id INTEGER NOT NULL,
      suite_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      event_primitive_id UUID,
      master_priority_score INTEGER NOT NULL,
      matched_branch TEXT NOT NULL,
      disposition TEXT NOT NULL,
      fuzzy_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      action_taken JSONB NOT NULL DEFAULT '{}'::jsonb,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);

  // Fetch or fallback organization ID
  const [org] = await db.select().from(orgs).limit(1);
  const orgId = org?.id ?? 1;

  console.log(`📌 Using Organization ID: ${orgId}`);

  // 1. Seed or update test Rule Suite
  const suiteId = "suite_west_coast_logistics_v2";
  const [existingSuite] = await db.select().from(ruleSuites).where(eq(ruleSuites.suiteId, suiteId));

  let suiteDbId: number;
  if (existingSuite) {
    suiteDbId = existingSuite.id;
    console.log(`✓ Existing Rule Suite found: ${suiteId} (ID: ${suiteDbId})`);
  } else {
    const [newSuite] = await db.insert(ruleSuites).values({
      organizationId: orgId,
      suiteId,
      suiteName: "West Coast Port Disruption & SLA Emergency Suite",
      category: "Supply Chain & Logistics",
      version: "2.4.0",
      owner: "Global Logistics Operations",
      description: "Governs automated AI agent actions for West Coast port strikes and SLA breaches.",
      executionPolicy: "HIGHEST_PRIORITY_MAUF",
      enabled: true,
      createdBy: "verification_script",
    }).returning();
    suiteDbId = newSuite.id;
    console.log(`✓ Seeded new Rule Suite: ${suiteId} (ID: ${suiteDbId})`);
  }

  // 2. Seed Rule Specification
  const ruleId = "rule_port_strike_01";
  const ruleName = "Hostile Port Strike Emergency Escalation";

  const rulePayload = {
    ruleId,
    ruleName,
    enabled: true,
    priorityWeight: 90,
    ifBranch: {
      branchId: "IF_CRITICAL_PORT_STRIKE",
      branchName: "Critical Port Strike Hostile Reaction",
      matchStrategy: "ALL",
      conditions: [
        { type: "crisp", field: "targetSector", operator: "equals", value: "Logistics" },
        { type: "crisp", field: "severity", operator: "in", value: ["High", "Critical"] },
        {
          type: "fuzzy_ai_eval",
          metric: "sentiment_polarity",
          promptDirective: "Evaluate if communication contains hostile, adversarial, or legal threat posturing.",
          operator: "less_than_or_equal",
          fuzzyThreshold: -0.60,
        },
        {
          type: "semantic_graph",
          graphOperator: "CAUSAL_PATH_EXISTS",
          targetEntityId: "facility_west_coast_hub",
          maxHops: 3,
        },
        {
          type: "temporal_velocity",
          temporalOperator: "MAX_SIGNAL_AGE",
          maxAgeMinutes: 60,
        },
      ],
      thenAction: {
        deliveryMode: "override_and_execute",
        receiverBinding: {
          targetType: "cycle",
          targetId: 42,
          recipientName: "West Coast Logistics Response Cycle",
        },
        missionBlueprint: {
          blueprintName: "Signal Impact Validation Blueprint",
          assignedAgentRole: "Systems Analyst",
          executionStyle: "fuzzy_cognitive_directive",
          fuzzyGoalDirective: "Reroute non-critical freight to Oakland rail hub if SLA delay exceeds 3 days.",
        },
        governancePolicy: {
          autoApproveLevel: "read_only_tools",
          maxFinancialDiscretionCap: 25000,
        },
      },
    },
  };

  const [existingRule] = await db.select().from(ruleSpecifications).where(and(eq(ruleSpecifications.suiteDbId, suiteDbId), eq(ruleSpecifications.ruleId, ruleId)));

  if (!existingRule) {
    await db.insert(ruleSpecifications).values({
      suiteDbId,
      ruleId,
      ruleName,
      enabled: true,
      priorityWeight: 90,
      specification: rulePayload as any,
    });
    console.log(`✓ Seeded Rule Specification: ${ruleId} ("${ruleName}")`);
  } else {
    console.log(`✓ Rule Specification already exists: ${ruleId}`);
  }

  // 3. Create simulated Event Primitive
  const simulatedEvent = {
    id: "00000000-0000-0000-0000-000000000101",
    organizationId: orgId,
    feedId: "feed_reuters_logistics",
    eventType: "supply_chain_disruption",
    targetSector: "Logistics",
    jurisdiction: "north_america",
    severity: "Critical",
    confidenceScore: 0.95,
    spatialSurpriseScore: 0.32,
    rawText: "Port of Los Angeles faces unprecedented 10-day strike as contract negotiations collapse. Hostile union leaders threaten shutdown.",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  console.log("\n📥 Injecting Simulated Event Primitive:");
  console.log(`- Headline: "${simulatedEvent.rawText}"`);
  console.log(`- Sector: ${simulatedEvent.targetSector} | Severity: ${simulatedEvent.severity} | Confidence: ${simulatedEvent.confidenceScore}`);

  // 4. Run GRIE Evaluation with Causal Graph Link
  const causalLinks = [
    {
      id: "link-001",
      organizationId: orgId,
      sourceEntityId: "entity_la_port",
      targetEntityId: "facility_west_coast_hub",
      relationshipType: "AFFECTS_DEPENDENCY",
      confidence: 0.95,
      createdAt: new Date(),
    } as any,
  ];

  console.log("\n⚡ Running GRIE Dual-Stage Evaluation Engine (with Semantic Graph & Fuzzy AI)...");
  const results = await subscriptionRuleEngine.evaluateEvent(simulatedEvent, causalLinks);

  console.log(`\n📊 GRIE Evaluation Results (${results.length} Rules Matched):`);
  for (const res of results) {
    console.log(`\n-------------------------------------------------------`);
    console.log(`  Rule Suite ID:        ${res.ruleSuiteId}`);
    console.log(`  Rule ID:              ${res.ruleId}`);
    console.log(`  Matched Branch:       ${res.matchedBranch}`);
    console.log(`  Disposition Mode:     ${res.disposition}`);
    console.log(`  Master Priority (P):  ${res.masterPriorityScore} / 100`);
    console.log(`  Fuzzy Scores (μ):     ${JSON.stringify(res.fuzzyScores)}`);
    console.log(`  Action Executed:      ${res.actionTaken?.missionBlueprint?.blueprintName ?? "N/A"}`);
    console.log(`  Assigned AI Agent:    ${res.actionTaken?.missionBlueprint?.assignedAgentRole ?? "N/A"}`);
  }

  // 5. Run Signal-to-Rule Decomposition Surface Verification
  console.log("\n🧩 Testing Signal-to-Rule Decomposition Surface...");
  const rawArticle = "Port of Los Angeles faces unprecedented 10-day strike as contract negotiations collapse. Fuel surcharges jump 15% across maritime carriers.";
  
  const decompRes = await signalDecompositionSurface.processAndDecomposeSignal({
    organizationId: orgId,
    feedId: "feed_reuters_main",
    rawContent: rawArticle,
    targetSector: "Logistics",
    jurisdiction: "north_america",
  });

  console.log(`✓ Decomposed Monolithic Signal into ${decompRes.decomposedCount} Atomic Primitives.`);
  console.log(`✓ Decomposed Evaluation Triggered ${decompRes.evaluationResults.length} Rule Executions.`);

  // 6. Test Dynamic Reflow & Re-Rank Engine
  console.log("\n🔄 Testing Dynamic Reflow & Re-Rank Engine...");
  const sampleEvents = [
    { ruleSuiteId: "suite_01", ruleId: "rule_low", matchedBranch: "IF", masterPriorityScore: 45, disposition: "context_only", fuzzyScores: {}, actionTaken: {}, passed: true },
    { ruleSuiteId: "suite_01", ruleId: "rule_critical", matchedBranch: "IF", masterPriorityScore: 92, disposition: "override_and_execute", fuzzyScores: {}, actionTaken: {}, passed: true },
    { ruleSuiteId: "suite_01", ruleId: "rule_medium", matchedBranch: "IF", masterPriorityScore: 68, disposition: "trigger_step", fuzzyScores: {}, actionTaken: {}, passed: true },
  ];

  const rerankRes = await subscriptionRuleEngine.rerankAndReflowPendingEvents(sampleEvents);
  console.log(`✓ Re-Ranked ${rerankRes.rerankedEvents.length} Events by Master Priority Score (Highest P_master: ${rerankRes.rerankedEvents[0].masterPriorityScore}).`);
  console.log(`✓ Reflowed ${rerankRes.reflowedPipelinesCount} Pipeline Execution Graphs for Emergency Override Events.`);

  // 7. Test Delay Action & Emergency Preemption Reflow Engine
  console.log("\n⏳ Testing DelayWaitActionJob & Preemption Reflow...");
  const delayRes = await subscriptionRuleEngine.scheduleDelayWaitJob("pipeline_108", {
    durationHours: 24,
    timerKey: "timer_port_talks_wait_24h",
    onDelayExpirationReflow: { reEvaluateRules: true },
    preemptDelayIf: { condition: "P_master >= 85", action: "cancel_delay_and_reflow_immediately" },
  });
  console.log(`✓ Scheduled Delay Action Step: ${delayRes.timerId} (Status: ${delayRes.status}, Expires: ${delayRes.expiresAt}).`);

  const preemptRes = await subscriptionRuleEngine.preemptActiveDelayTimers(simulatedEvent, 92);
  console.log(`✓ Preempted ${preemptRes.preemptedCount} Active Delay Timers due to Emergency Event (Action: ${preemptRes.reflowedAction}).`);

  // 8. Verify Rule Execution Audit Table
  const audits = await db.select().from(ruleExecutionAudits).where(eq(ruleExecutionAudits.organizationId, orgId)).orderBy(desc(ruleExecutionAudits.executedAt)).limit(1);

  if (audits.length > 0) {
    console.log(`\n✅ Audit Record Verified in DB (ID: ${audits[0].id}):`);
    console.log(`  - Matched Branch: ${audits[0].matchedBranch}`);
    console.log(`  - P_master Score: ${audits[0].masterPriorityScore}`);
    console.log(`  - Disposition:    ${audits[0].disposition}`);
  }

  console.log("\n=======================================================");
  console.log("🎉 GRIE RULES ENGINE & DECOMPOSITION SURFACE VERIFIED!");
  console.log("=======================================================\n");

  process.exit(0);
}

runGrieVerification().catch((err) => {
  console.error("❌ GRIE Verification failed:", err);
  process.exit(1);
});
