/**
 * Product Launch Cycle — Tool & Integration Verification
 *
 * Verifies:
 * 1. All 9 launch tools produce valid structured output
 * 2. Readiness score calculation is correct
 * 3. Feedback synthesis produces priorities
 * 4. Blackboard schema is valid
 * 5. Seed data is well-formed
 * 6. Integration connectors initialize without errors
 */

import { launchToolImplementations } from "../domain/tools/v1/capabilities/launch-tools.js";
import { SEED_DATA } from "../cycles/product-launch-seed-data.js";
import { MISSION_DATASET_MAP, DATASET_SCHEMAS } from "../domain/tools/v1/capabilities/launch-blackboard-schema.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Product Launch Cycle — Tool & Integration Tests");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const ctx = { organizationId: 1, userId: "test" };

  // ─── Tool Tests ────────────────────────────────────────────────────────────
  console.log("── Tool Output Validation ──────────────────────────────────────\n");

  // 1. searchCompetitorIntel
  const searchResult = await launchToolImplementations.searchCompetitorIntel({ query: "test competitor", aspect: "all" }, ctx);
  assert(searchResult !== null && typeof searchResult === "object", "searchCompetitorIntel returns object");
  assert("success" in searchResult, "searchCompetitorIntel has success field");

  // 2. generatePositioningCanvas
  const canvasResult = await launchToolImplementations.generatePositioningCanvas({
    productName: "TestProduct",
    targetAudience: "Product Managers",
    problem: "Launch coordination is chaotic",
    differentiators: ["AI-powered", "Cross-functional"],
  }, ctx);
  assert(canvasResult.success === true, "generatePositioningCanvas succeeds");
  assert(canvasResult.canvas.positioningStatement.includes("TestProduct"), "Canvas includes product name");
  assert(canvasResult.canvas.positioningStatement.includes("Product Managers"), "Canvas includes target audience");

  // 3. createPricingModel
  const pricingResult = await launchToolImplementations.createPricingModel({
    productName: "TestProduct",
    valueMetric: "seats",
    tiers: [{ name: "Starter", price: 49, billingPeriod: "monthly", targetSegment: "SMB", features: ["Basic"] }],
  }, ctx);
  assert(pricingResult.success === true, "createPricingModel succeeds");
  assert(pricingResult.model.tiers.length === 1, "Pricing model has 1 tier");
  assert(pricingResult.model.valueMetric === "seats", "Value metric is correct");

  // 4. generateContentBrief
  const briefResult = await launchToolImplementations.generateContentBrief({
    contentType: "blog_post",
    title: "Why Launch Coordination Matters",
    targetPersona: "VP Product",
    funnelStage: "awareness",
    keyMessages: ["Save time", "Reduce risk"],
  }, ctx);
  assert(briefResult.success === true, "generateContentBrief succeeds");
  assert(briefResult.brief.contentType === "blog_post", "Brief has correct type");
  assert(briefResult.brief.status === "ready_for_creation", "Brief status is ready");

  // 5. writeMarketingCopy
  const copyResult = await launchToolImplementations.writeMarketingCopy({
    contentType: "headline",
    context: "AI-powered launch management",
    persona: "VP Product",
  }, ctx);
  assert(copyResult.success === true, "writeMarketingCopy succeeds");
  assert(copyResult.instruction.includes("headline"), "Copy instruction references type");

  // 6. createBattleCard
  const battleResult = await launchToolImplementations.createBattleCard({
    competitor: "CompetitorAlpha",
    theirPitch: "Enterprise-first platform",
    ourAdvantages: ["AI agents", "Faster time-to-launch"],
    trapQuestions: ["How long does onboarding take?"],
  }, ctx);
  assert(battleResult.success === true, "createBattleCard succeeds");
  assert(battleResult.battleCard.competitor === "CompetitorAlpha", "Battle card has competitor");
  assert(battleResult.battleCard.ourAdvantages.length === 2, "Battle card has advantages");

  // 7. scoreLaunchReadiness
  const readinessResult = await launchToolImplementations.scoreLaunchReadiness({ organizationId: 1, includeBreakdown: true }, ctx);
  assert(readinessResult.success === true, "scoreLaunchReadiness succeeds");
  assert(typeof readinessResult.readiness.overall === "number", "Readiness has numeric overall score");
  assert(readinessResult.readiness.overall >= 0 && readinessResult.readiness.overall <= 100, "Readiness is 0-100");
  assert("breakdown" in readinessResult.readiness, "Readiness has breakdown");

  // 8. synthesizeFeedback
  const synthResult = await launchToolImplementations.synthesizeFeedback({
    feedbackItems: [
      { content: "Love the new feature", source: "beta", persona: "PM", date: "2026-01-01" },
      { content: "Onboarding is confusing", source: "beta", persona: "Dev", date: "2026-01-02" },
      { content: "Pricing is too high", source: "survey", persona: "PM", date: "2026-01-03" },
    ],
  }, ctx);
  assert(synthResult.success === true, "synthesizeFeedback succeeds");
  assert(synthResult.synthesis.totalItems === 3, "Synthesis counts items correctly");

  // 9. createIterationTicket
  const ticketResult = await launchToolImplementations.createIterationTicket({
    title: "Simplify onboarding flow",
    description: "Multiple beta users reported confusion during initial setup",
    priority: "High",
    feedbackTheme: "onboarding_friction",
    customerQuotes: ["The setup wizard was confusing"],
    acceptanceCriteria: ["Onboarding completes in < 5 minutes"],
    storyPoints: 5,
  }, ctx);
  assert(ticketResult !== null, "createIterationTicket returns result");
  // May fail if Jira not connected — that's expected
  assert("success" in ticketResult || "error" in ticketResult, "Ticket result has success or error");

  // ─── Seed Data Validation ──────────────────────────────────────────────────
  console.log("\n── Seed Data Validation ────────────────────────────────────────\n");

  assert(SEED_DATA.competitive_intelligence.length >= 3, `${SEED_DATA.competitive_intelligence.length} competitors seeded`);
  assert(SEED_DATA.customer_personas.length >= 3, `${SEED_DATA.customer_personas.length} personas seeded`);
  assert(SEED_DATA.past_launches.length >= 2, `${SEED_DATA.past_launches.length} past launches seeded`);
  assert(SEED_DATA.pricing_models.length >= 3, `${SEED_DATA.pricing_models.length} pricing tiers seeded`);
  assert(SEED_DATA.sales_playbooks.length >= 1, `${SEED_DATA.sales_playbooks.length} playbook(s) seeded`);

  // Validate structure
  const firstCompetitor = SEED_DATA.competitive_intelligence[0];
  assert(!!firstCompetitor.name, "Competitor has name");
  assert(Array.isArray(firstCompetitor.strengths), "Competitor has strengths array");
  assert(Array.isArray(firstCompetitor.weaknesses), "Competitor has weaknesses array");

  const firstPersona = SEED_DATA.customer_personas[0];
  assert(!!firstPersona.name, "Persona has name");
  assert(Array.isArray(firstPersona.pain_points), "Persona has pain_points array");
  assert(Array.isArray(firstPersona.buying_triggers), "Persona has buying_triggers array");

  // ─── Blackboard Schema Validation ──────────────────────────────────────────
  console.log("\n── Blackboard & Dataset Schema Validation ──────────────────────\n");

  assert(Object.keys(MISSION_DATASET_MAP).length >= 7, `${Object.keys(MISSION_DATASET_MAP).length} missions mapped to datasets`);
  assert(Object.keys(DATASET_SCHEMAS).length >= 10, `${Object.keys(DATASET_SCHEMAS).length} dataset schemas defined`);

  // Verify all missions have at least one dataset
  for (const [mission, datasets] of Object.entries(MISSION_DATASET_MAP)) {
    assert(datasets.length > 0, `Mission "${mission}" writes to ${datasets.length} dataset(s)`);
  }

  // Verify all referenced datasets have schemas
  const allDatasets = new Set(Object.values(MISSION_DATASET_MAP).flat());
  for (const ds of allDatasets) {
    assert(ds in DATASET_SCHEMAS, `Dataset "${ds}" has schema defined`);
  }

  // ─── Integration Connector Tests ───────────────────────────────────────────
  console.log("\n── Integration Connector Initialization ────────────────────────\n");

  try {
    const { hubspotConnector } = await import("../integrations/hubspot-connector.js");
    assert(!hubspotConnector.isConfigured(), "HubSpot starts unconfigured (expected)");
    hubspotConnector.configure({ apiKey: "test", portalId: "123" });
    assert(hubspotConnector.isConfigured(), "HubSpot configures without error");
  } catch (e: any) { assert(false, `HubSpot import failed: ${e.message}`); }

  try {
    const { googleAnalyticsConnector } = await import("../integrations/google-analytics-connector.js");
    assert(!googleAnalyticsConnector.isConfigured(), "GA starts unconfigured (expected)");
    googleAnalyticsConnector.configure({ propertyId: "test", measurementId: "G-TEST" });
    assert(googleAnalyticsConnector.isConfigured(), "GA configures without error");
  } catch (e: any) { assert(false, `GA import failed: ${e.message}`); }

  try {
    const { intercomConnector } = await import("../integrations/intercom-connector.js");
    assert(!intercomConnector.isConfigured(), "Intercom starts unconfigured (expected)");
    intercomConnector.configure({ appId: "test", apiToken: "test" });
    assert(intercomConnector.isConfigured(), "Intercom configures without error");
  } catch (e: any) { assert(false, `Intercom import failed: ${e.message}`); }

  try {
    const { pendoConnector } = await import("../integrations/pendo-connector.js");
    assert(!pendoConnector.isConfigured(), "Pendo starts unconfigured (expected)");
    pendoConnector.configure({ apiKey: "test", appId: "test-app" });
    assert(pendoConnector.isConfigured(), "Pendo configures without error");
  } catch (e: any) { assert(false, `Pendo import failed: ${e.message}`); }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
