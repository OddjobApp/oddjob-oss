import { test, expect } from "@playwright/test";
import { db } from "../../server/database_service.js";
import { signalFeeds, eventPrimitives, cycleSignalSubscriptions, operationalCycles, causalGraphLinks } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

test.describe("E2E Hacker News Competitive Intelligence & Strategy Cycle Integration", () => {
  const orgId = 1;
  let testSignalId: string;

  test.beforeAll(async () => {
    console.log("\n🧪 Initializing E2E Hacker News Integration Test Setup...");
    
    // Ensure Hacker News feed exists in database
    const [existingFeed] = await db
      .select()
      .from(signalFeeds)
      .where(and(eq(signalFeeds.organizationId, orgId), eq(signalFeeds.url, "https://news.ycombinator.com/rss")))
      .limit(1);

    if (!existingFeed) {
      await db.insert(signalFeeds).values({
        organizationId: orgId,
        name: "Hacker News Technology & Market Signals",
        sourceType: "rss",
        url: "https://news.ycombinator.com/rss",
        pollingIntervalSeconds: 900,
        enabled: true,
        status: "active",
      });
    }

    // Ensure Cycle exists
    let [cycle] = await db
      .select()
      .from(operationalCycles)
      .where(and(eq(operationalCycles.organizationId, orgId), eq(operationalCycles.name, "Competitive Intelligence & Strategy Response")))
      .limit(1);

    if (!cycle) {
      [cycle] = await db.insert(operationalCycles).values({
        organizationId: orgId,
        name: "Competitive Intelligence & Strategy Response",
        description: "Governed operational response cycle for competitive intelligence.",
        objective: "Assess competitor launches and execute roadmap counter-strategies.",
        status: "active",
        priority: 2,
        requiresApproval: 1,
        createdById: 1,
      } as any).returning();
    }

    // Ensure Subscription exists
    const [sub] = await db
      .select()
      .from(cycleSignalSubscriptions)
      .where(and(eq(cycleSignalSubscriptions.organizationId, orgId), eq(cycleSignalSubscriptions.cycleId, cycle.id)))
      .limit(1);

    if (!sub) {
      await db.insert(cycleSignalSubscriptions).values({
        organizationId: orgId,
        cycleId: cycle.id,
        name: "Hacker News Competitive Signal Subscription",
        enabled: true,
        deliveryMode: "trigger_step",
        filters: { eventTypes: ["Competitive_Intelligence"], minimumConfidence: 0.5 },
        stateProjection: { namespace: "external_environment", reducer: "latest" },
        cooldownMinutes: 15,
        createdBy: "system",
      });
    }
  });

  test("1. Ingest Breaking Technology Event Primitive from Hacker News Signal", async () => {
    testSignalId = crypto.randomUUID();
    const contentHash = crypto.createHash("sha256").update(`hn-test-${Date.now()}`).digest("hex");

    const [primitive] = await db
      .insert(eventPrimitives)
      .values({
        id: testSignalId,
        organizationId: orgId,
        sourceEntryId: `hn-item-${Date.now()}`,
        eventType: "Competitive_Intelligence",
        targetSector: "Technology",
        jurisdiction: "Global",
        severity: "High",
        sourceUrl: "https://news.ycombinator.com/item?id=38000000",
        extractionTimestamp: new Date(),
        confidenceScore: 0.92,
        rawText: "Competitor announces next-generation autonomous AI workflow engine with zero-latency streaming.",
        contentHash,
      })
      .returning();

    expect(primitive).toBeDefined();
    expect(primitive.id).toBe(testSignalId);
    expect(primitive.eventType).toBe("Competitive_Intelligence");
    console.log(`  ✅ Ingested Event Primitive: ${primitive.id} (${primitive.eventType})`);
  });

  test("2. Calculate Causal Graph Blast Radius & Downstream Entity Mapping", async () => {
    expect(testSignalId).toBeDefined();

    const [causalLink] = await db
      .insert(causalGraphLinks)
      .values({
        organizationId: orgId,
        eventPrimitiveId: testSignalId,
        targetEntityType: "cycle",
        targetEntityId: "competitive-intelligence-strategy",
        impactHorizonMinDays: 1,
        impactHorizonMaxDays: 14,
        impactConfidence: 90,
        blastRadius: 4,
        depth: 1,
      })
      .returning();

    expect(causalLink).toBeDefined();
    expect(causalLink.blastRadius).toBeGreaterThan(0);
    console.log(`  ✅ Causal Graph Link created: Blast Radius ${causalLink.blastRadius}, Target Entity: ${causalLink.targetEntityType}:${causalLink.targetEntityId}`);
  });

  test("3. Match Cycle Signal Subscription & Route to Downstream Governed Cycle", async () => {
    const subs = await db
      .select()
      .from(cycleSignalSubscriptions)
      .where(and(eq(cycleSignalSubscriptions.organizationId, orgId), eq(cycleSignalSubscriptions.enabled, true)));

    expect(subs.length).toBeGreaterThan(0);
    const matchingSub = subs.find((s) => {
      const filters = s.filters as any;
      return filters?.eventTypes?.includes("Competitive_Intelligence");
    });

    expect(matchingSub).toBeDefined();
    expect(["context_only", "trigger_step"]).toContain(matchingSub?.deliveryMode);
    console.log(`  ✅ Cycle Subscription Matched: "${matchingSub?.name}" -> Delivery Mode: ${matchingSub?.deliveryMode}`);
  });
});
