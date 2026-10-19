/**
 * Register Technical Research & RFC Synthesis in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace.
 *
 * Usage: npx tsx server/scripts/register-technical-research-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n🚀 Registering Technical Research & RFC Synthesis in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "technical-research"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating registry configuration...");
        await db.update(apps).set({ 
            isPublic: true, 
            config: {
                type: "cycle_blueprint",
                cycleYamlPath: "server/cycles/technical-research.cycle.yaml",
                category: "operations",
                features: [
                    "3-stage chained cycles (Discovery -> Audit & Feasibility -> RFC & Wiki Publish)",
                    "Specialized AI Agents (Technical Researcher, Technical Writer)",
                    "Academic paper discovery using literature search tools (arXiv)",
                    "Codebase feasibility dependency scans and mock integration PoCs",
                    "Automated Wiki publication to the Organizational Memory Graph",
                    "Engineering backlog provisioning directly into Jira boards",
                    "Human-in-the-loop (HIL) selection and sign-off forms",
                ],
                agents: 2,
                missions: 6,
                integrations: ["jira", "slack", "source_control", "database"],
            },
            updatedAt: new Date() 
        }).where(eq(apps.id, existing.id));
        console.log("  ✅ Updated.\n");
        process.exit(0);
    }

    // Register as a public marketplace app
    const [app] = await db.insert(apps).values({
        name: "Technical Research & RFC Synthesis",
        slug: "technical-research",
        description: "An AI-powered technical research assistant that audits codebase files, summarizes academic specifications, publishes RFCs to the Knowledge Wiki, and files task backlogs in Jira.",
        icon: "📚",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "technical-research",
        status: "active",
        version: "1.0.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/technical-research.cycle.yaml",
            category: "operations",
            features: [
                "3-stage chained cycles (Discovery -> Audit & Feasibility -> RFC & Wiki Publish)",
                "Specialized AI Agents (Technical Researcher, Technical Writer)",
                "Academic paper discovery using literature search tools (arXiv)",
                "Codebase feasibility dependency scans and mock integration PoCs",
                "Automated Wiki publication to the Organizational Memory Graph",
                "Engineering backlog provisioning directly into Jira boards",
                "Human-in-the-loop (HIL) selection and sign-off forms",
            ],
            agents: 2,
            missions: 6,
            integrations: ["jira", "slack", "source_control", "database"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: Academic discovery, codebase audit, and automated wiki serialization.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
