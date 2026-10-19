/**
 * Register Oddjob Enterprise Hybrid AI SDLC in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace.
 *
 * Usage: npx tsx server/scripts/register-hybrid-sdlc-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n🔧 Registering Oddjob Enterprise Hybrid AI SDLC in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "hybrid-sdlc"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating registry configuration...");
        await db.update(apps).set({
            isPublic: true,
            config: {
                type: "cycle_blueprint",
                cycleYamlPath: "server/cycles/hybrid-sdlc.cycle.yaml",
                category: "development",
                features: [
                    "9 specialized AI agents with soul profiles for end-to-end SDLC",
                    "6 orchestrated missions from Sprint Zero through Production Deployment",
                    "Value Stream Management (VSM) telemetry with DORA metrics",
                    "5 comprehensive workbenches (PRD, Architecture, QA, Deployment, Ops)",
                    "Jira, Confluence, Slack, GitHub, and MCP integration",
                    "Human-in-the-loop gates for architecture, UAT, and CAB approvals",
                    "Workspace health checks and coding agent iteration controls",
                    "Prediction intelligence with defect and velocity forecasting",
                ],
                agents: 9,
                missions: 6,
                integrations: ["jira", "confluence", "slack", "github", "mcp"],
            },
            updatedAt: new Date()
        }).where(eq(apps.id, existing.id));
        console.log("  ✅ Updated.\n");
        process.exit(0);
    }

    // Register as a public marketplace app
    const [app] = await db.insert(apps).values({
        name: "Oddjob Enterprise Hybrid AI SDLC",
        slug: "hybrid-sdlc",
        description: "A highly-structured 5-day Software Development Life Cycle utilizing 9 Specialized AI Agents, 6 Orchestrated Missions, strict Value Stream Management (VSM) telemetry, and 5 comprehensive workbenches for end-to-end SDLC management.",
        icon: "🔄",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "hybrid-sdlc",
        status: "active",
        version: "1.1.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/hybrid-sdlc.cycle.yaml",
            category: "development",
            features: [
                "9 specialized AI agents with soul profiles for end-to-end SDLC",
                "6 orchestrated missions from Sprint Zero through Production Deployment",
                "Value Stream Management (VSM) telemetry with DORA metrics",
                "5 comprehensive workbenches (PRD, Architecture, QA, Deployment, Ops)",
                "Jira, Confluence, Slack, GitHub, and MCP integration",
                "Human-in-the-loop gates for architecture, UAT, and CAB approvals",
                "Workspace health checks and coding agent iteration controls",
                "Prediction intelligence with defect and velocity forecasting",
            ],
            agents: 9,
            missions: 6,
            integrations: ["jira", "confluence", "slack", "github", "mcp"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: Enterprise SDLC with 9 AI agents, VSM telemetry, and full Jira/Confluence integration.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
