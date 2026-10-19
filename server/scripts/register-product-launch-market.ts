/**
 * Register Product Launch Cycle in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace
 * alongside "AI Prospector & Co-Pilot" and other global apps.
 *
 * Usage: npx tsx server/scripts/register-product-launch-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n🚀 Registering Product Launch Cycle in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "product-launch-cycle"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating to ensure it's public...");
        await db.update(apps).set({ isPublic: true, updatedAt: new Date() }).where(eq(apps.id, existing.id));
        console.log("  ✅ Updated.\n");
        process.exit(0);
    }

    // Register as a public marketplace app
    const [app] = await db.insert(apps).values({
        name: "Product Launch Cycle",
        slug: "product-launch-cycle",
        description: "An AI-powered launch operations center that coordinates market research, content creation, sales enablement, and go-to-market execution across your entire team — from first idea to post-launch optimization. Includes 7 specialized AI agents, 8 orchestrated missions, and 5 interactive workbenches.",
        icon: "🚀",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "product-launch-workbench",
        status: "active",
        version: "1.0.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/product-launch.cycle.yaml",
            category: "product",
            features: [
                "7 AI Agents (Market Researcher, Product Strategist, GTM Strategist, Content Creator, Sales Enablement, Launch Coordinator, Feedback Analyst)",
                "8 Orchestrated Missions with mixed execution strategies",
                "5 Interactive Workbenches (Command Center, Market Research, Content Studio, Sales Enablement, Feedback & Insights)",
                "Prediction Intelligence (launch timing, risk scoring, Day-1 forecast)",
                "Real-time event stream with live agent execution feed",
                "Jira + Confluence + Slack + HubSpot + Pendo integration",
                "BANT/behavioral scoring via Behavioral Intelligence Engine",
            ],
            agents: 7,
            missions: 8,
            workbenches: 5,
            integrations: ["jira", "confluence", "slack", "hubspot", "google_analytics", "intercom", "pendo"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: Full product launch lifecycle management with AI agents.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log(`  Blueprint: product-launch-workbench`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
