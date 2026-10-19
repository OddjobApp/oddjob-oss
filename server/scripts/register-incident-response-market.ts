/**
 * Register Incident Response Chain in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace.
 *
 * Usage: npx tsx server/scripts/register-incident-response-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n🚀 Registering Incident Response Chain in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "incident-response-chain"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating registry configuration...");
        await db.update(apps).set({ 
            isPublic: true, 
            config: {
                type: "cycle_blueprint",
                cycleYamlPath: "server/cycles/incident-response-chain.cycle.yaml",
                category: "operations",
                features: [
                    "3-stage chained cycles (Triage & Diagnosis -> Mitigation & Hotfix -> Post-Mortem & Remediation)",
                    "Specialized AI Agents (Incident Commander, SRE Debugging Agent, Post-Mortem Writer)",
                    "Change Advisory Board (CAB) gate for production deployments",
                    "Interactive HIL Triage Sign-off Form for human approval routing",
                    "Automated log tracing, past incident search, and error vector mapping",
                    "Parent-to-child context serialization and data bridging",
                    "Jira + Slack + GitHub integration",
                ],
                agents: 3,
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
        name: "Incident Response Chain",
        slug: "incident-response-chain",
        description: "An AI-powered 3-stage Incident Response operations center that automates alert diagnostics, logs analysis, code hotfixes, QA verification, and blameless 5-whys post-mortems across chained cycles.",
        icon: "🚨",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "incident-response-workbench",
        status: "active",
        version: "1.0.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/incident-response-chain.cycle.yaml",
            category: "operations",
            features: [
                "3-stage chained cycles (Triage & Diagnosis -> Mitigation & Hotfix -> Post-Mortem & Remediation)",
                "Specialized AI Agents (Incident Commander, SRE Debugging Agent, Post-Mortem Writer)",
                "Change Advisory Board (CAB) gate for production deployments",
                "Interactive HIL Triage Sign-off Form for human approval routing",
                "Automated log tracing, past incident search, and error vector mapping",
                "Parent-to-child context serialization and data bridging",
                "Jira + Slack + GitHub integration",
            ],
            agents: 3,
            missions: 6,
            integrations: ["jira", "slack", "source_control", "database"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: Automated incident response, hotfixing, and post-mortem loop.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
