/**
 * Register Sales Pipeline Management in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace.
 *
 * Usage: npx tsx server/scripts/register-sales-pipeline-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n💼 Registering Sales Pipeline Management in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "sales-pipeline-management"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating registry configuration...");
        await db.update(apps).set({
            isPublic: true,
            config: {
                type: "cycle_blueprint",
                cycleYamlPath: "server/cycles/sales-pipeline-management.cycle.yaml",
                category: "sales",
                features: [
                    "Automated lead qualification with AI-powered research and scoring",
                    "Pipeline tracking with stage management and win probability",
                    "Revenue forecasting from pipeline stage velocity and conversion rates",
                    "CRM synchronization for lead and opportunity management",
                    "Jira integration for opportunity tracking across sales stages",
                    "Confluence publishing for forecast reports",
                    "Human-in-the-loop pipeline review and approval workflow",
                ],
                agents: 2,
                missions: 5,
                integrations: ["jira", "confluence", "slack", "database"],
            },
            updatedAt: new Date()
        }).where(eq(apps.id, existing.id));
        console.log("  ✅ Updated.\n");
        process.exit(0);
    }

    // Register as a public marketplace app
    const [app] = await db.insert(apps).values({
        name: "Sales Pipeline Management",
        slug: "sales-pipeline-management",
        description: "Automated lead qualification, pipeline tracking, and revenue forecasting. Integrates with CRM for lead management and JIRA for opportunity tracking.",
        icon: "💼",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "sales-pipeline-management",
        status: "active",
        version: "1.0.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/sales-pipeline-management.cycle.yaml",
            category: "sales",
            features: [
                "Automated lead qualification with AI-powered research and scoring",
                "Pipeline tracking with stage management and win probability",
                "Revenue forecasting from pipeline stage velocity and conversion rates",
                "CRM synchronization for lead and opportunity management",
                "Jira integration for opportunity tracking across sales stages",
                "Confluence publishing for forecast reports",
                "Human-in-the-loop pipeline review and approval workflow",
            ],
            agents: 2,
            missions: 5,
            integrations: ["jira", "confluence", "slack", "database"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: Lead qualification, pipeline management, and revenue forecasting with CRM/Jira integration.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
