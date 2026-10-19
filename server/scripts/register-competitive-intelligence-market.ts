/**
 * Register Competitive Intelligence & Strategy Chain in App Arsenal Global Market
 *
 * Usage: npx tsx server/scripts/register-competitive-intelligence-market.ts
 */
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function register() {
    console.log("\n🌐 Registering Competitive Intelligence & Strategy Chain in App Arsenal...\n");

    const slug = "competitive-intelligence-strategy";
    const name = "Competitive Intelligence & Strategy";
    const description = "An AI-powered intelligence engine that monitors breaking technology signals from Hacker News, maps causal market blast radius, and executes governed product roadmap counter-strategies.";
    const icon = "🌐";
    const config = JSON.stringify({
        type: "cycle_blueprint",
        cycleYamlPath: "server/cycles/competitive-intelligence-strategy.cycle.yaml",
        category: "product_strategy",
        features: [
            "100% Free Hacker News RSS live signal polling & primitive ingestion",
            "Causal Graph blast radius calculation & market impact prediction",
            "Automated Cycle Signal Subscription routing",
            "3-phase governed cycle execution (Triage -> HIL PM Approval -> Backlog Generation)",
            "Interactive Human-in-the-Loop Strategy Sign-off Form",
        ],
        agents: 2,
        missions: 3,
        integrations: ["rss", "database", "jira"],
    });

    const result = await db.execute(sql`
        INSERT INTO apps (name, slug, description, icon, is_public, is_system, blueprint, status, version, created_by, config, updated_at)
        VALUES (${name}, ${slug}, ${description}, ${icon}, true, true, 'competitive-intelligence-workbench', 'active', '1.0.0', 'system', ${config}::jsonb, NOW())
        ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            icon = EXCLUDED.icon,
            config = EXCLUDED.config,
            updated_at = NOW()
        RETURNING id, name, slug;
    `);

    const row = result.rows[0];
    console.log(`  ✅ Successfully Registered/Updated: "${row?.name || name}" (ID: ${row?.id || 'OK'})`);
    console.log(`  Slug: ${slug}`);
    console.log("  Public: true (visible in Global Market)\n");

    process.exit(0);
}

register().catch(err => {
    console.error("Failed to register competitive intelligence app:", err);
    process.exit(1);
});
