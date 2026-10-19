/**
 * Seed Hacker News Signal Source & Subscription Rule
 *
 * Usage: npx tsx server/scripts/seed-hacker-news-source.ts
 */
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("\n📡 Seeding Hacker News RSS Source & Cycle Subscription Rule...\n");

  const orgId = 1;
  const hnUrl = "https://news.ycombinator.com/rss";

  // 1. Get or insert Hacker News signal feed
  let feedRes = await db.execute(sql`SELECT id, name FROM signal_feeds WHERE organization_id = ${orgId} AND url = ${hnUrl} LIMIT 1`);
  let feedId = feedRes.rows[0]?.id;

  if (!feedId) {
    feedRes = await db.execute(sql`
      INSERT INTO signal_feeds (organization_id, name, source_type, url, polling_interval_seconds, enabled, status, created_at, updated_at)
      VALUES (${orgId}, 'Hacker News Technology & Market Signals', 'rss', ${hnUrl}, 900, true, 'active', NOW(), NOW())
      RETURNING id, name;
    `);
    feedId = feedRes.rows[0]?.id;
    console.log(`  ✅ Inserted Signal Feed: "${feedRes.rows[0]?.name}" (ID: ${feedId})`);
  } else {
    console.log(`  Existing Signal Feed ready: "${feedRes.rows[0]?.name}" (ID: ${feedId})`);
  }

  // 2. Get or insert Operational Cycle
  let cycleRes = await db.execute(sql`SELECT id, name FROM operational_cycles WHERE organization_id = ${orgId} AND name = 'Competitive Intelligence & Strategy Response' LIMIT 1`);
  let cycleId = cycleRes.rows[0]?.id;

  if (!cycleId) {
    cycleRes = await db.execute(sql`
      INSERT INTO operational_cycles (organization_id, name, description, objective, status, priority, requires_approval, created_by, created_at, updated_at)
      VALUES (${orgId}, 'Competitive Intelligence & Strategy Response', 'Governed operational response cycle for competitive intelligence & technology market shifts.', 'Assess competitor launches, feature gaps, and execute roadmap counter-strategies.', 'active', 2, 1, 'system', NOW(), NOW())
      RETURNING id, name;
    `);
    cycleId = cycleRes.rows[0]?.id;
    console.log(`  ✅ Inserted Operational Cycle: "${cycleRes.rows[0]?.name}" (ID: ${cycleId})`);
  } else {
    console.log(`  Existing Operational Cycle ready: "${cycleRes.rows[0]?.name}" (ID: ${cycleId})`);
  }

  // 3. Get or insert Cycle Signal Subscription Rule
  let subRes = await db.execute(sql`SELECT id, name, delivery_mode FROM cycle_signal_subscriptions WHERE organization_id = ${orgId} AND cycle_id = ${cycleId} LIMIT 1`);
  let subId = subRes.rows[0]?.id;

  if (!subId) {
    subRes = await db.execute(sql`
      INSERT INTO cycle_signal_subscriptions (organization_id, cycle_id, name, enabled, delivery_mode, filters, state_projection, cooldown_minutes, created_by, created_at, updated_at)
      VALUES (${orgId}, ${cycleId}, 'Hacker News Competitive Signal Subscription', true, 'context_only', '{"eventTypes":["Competitive_Intelligence","Market_Signal","Regulatory_Update","Business_State_Changed"],"minimumConfidence":0.5}'::jsonb, '{"namespace":"external_environment","reducer":"latest"}'::jsonb, 15, 'system', NOW(), NOW())
      RETURNING id, name, delivery_mode;
    `);
    subId = subRes.rows[0]?.id;
    console.log(`  ✅ Created Cycle Subscription Rule: "${subRes.rows[0]?.name}" (ID: ${subId}, Delivery: ${subRes.rows[0]?.delivery_mode})`);
  } else {
    console.log(`  Existing Subscription Rule ready: "${subRes.rows[0]?.name}" (ID: ${subId})`);
  }

  console.log("\n  ✨ Seed completed successfully. Live Hacker News RSS signals are ready to route into the Competitive Strategy cycle.\n");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
