/**
 * Register SRE Operations Suite in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace.
 *
 * Usage: npx tsx server/scripts/register-sre-operations-suite-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n🚀 Registering SRE Operations Suite in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "sre-operations-suite"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating registry configuration...");
        await db.update(apps).set({
            isPublic: true,
            config: {
                type: "cycle_blueprint",
                cycleYamlPath: "server/cycles/sre-operations-suite.cycle.yaml",
                category: "operations",
                features: [
                    "Dual-mode operation: proactive chaos drills (manual) + reactive incident response (webhook)",
                    "4 specialized AI agents: Chaos Monkey, Incident Commander, SRE Debugging Agent, Post-Mortem Writer",
                    "Controlled latency injection with auto-healing and abort safety gates",
                    "Real-time incident triage with Slack webhook triggers and severity classification",
                    "Automated hotfix development, PR creation, and CAB-gated deployment",
                    "Blameless 5-Whys root cause analysis and post-mortem report generation",
                    "Human-in-the-loop (HIL) forms for chaos abort, incident triage, and deployment approval",
                    "Integration with PagerDuty, Datadog, Slack, JIRA, and source control",
                ],
                agents: 4,
                missions: 12,
                integrations: ["jira", "slack", "source_control", "database"],
            },
            updatedAt: new Date()
        }).where(eq(apps.id, existing.id));
        console.log("  ✅ Updated.\n");
        process.exit(0);
    }

    // Register as a public marketplace app
    const [app] = await db.insert(apps).values({
        name: "SRE Operations Suite",
        slug: "sre-operations-suite",
        description: "Unified SRE operations cycle: proactive chaos engineering drills + reactive incident response with auto-healing, 5-Whys RCA, and post-mortem documentation. Four specialized AI agents handle fault injection, diagnostics, remediation, and reporting.",
        icon: "🛡️",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "sre-operations-suite",
        status: "active",
        version: "1.0.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/sre-operations-suite.cycle.yaml",
            category: "operations",
            features: [
                "Dual-mode operation: proactive chaos drills (manual) + reactive incident response (webhook)",
                "4 specialized AI agents: Chaos Monkey, Incident Commander, SRE Debugging Agent, Post-Mortem Writer",
                "Controlled latency injection with auto-healing and abort safety gates",
                "Real-time incident triage with Slack webhook triggers and severity classification",
                "Automated hotfix development, PR creation, and CAB-gated deployment",
                "Blameless 5-Whys root cause analysis and post-mortem report generation",
                "Human-in-the-loop (HIL) forms for chaos abort, incident triage, and deployment approval",
                "Integration with PagerDuty, Datadog, Slack, JIRA, and source control",
            ],
            agents: 4,
            missions: 12,
            integrations: ["jira", "slack", "source_control", "database"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: Unified SRE Operations Suite merging chaos drills with incident response.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
