/**
 * Register Chaos Engineering & Auto-Recovery Drill in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace.
 *
 * Usage: npx tsx server/scripts/register-chaos-drill-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n🚀 Registering Chaos Engineering & Auto-Recovery Drill in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "chaos-drill"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating registry configuration...");
        await db.update(apps).set({ 
            isPublic: true, 
            config: {
                type: "cycle_blueprint",
                cycleYamlPath: "server/cycles/chaos-drill.cycle.yaml",
                category: "operations",
                features: [
                    "3-stage chained cycles (Chaos Injection -> Diagnosis & Healing -> Audit & Close)",
                    "Specialized AI Agents (Chaos Monkey, SRE Remediation Agent, Post-Mortem Writer)",
                    "Controlled latency simulation in staging database configurations",
                    "Integration with Datadog metrics and PagerDuty alert triggers",
                    "Automated self-healing and config remediation scripts",
                    "Parent-to-child context serialization and data bridging",
                    "Human-in-the-loop (HIL) safety checks for recovery abort validation",
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
        name: "Chaos Engineering & Auto-Recovery Drill",
        slug: "chaos-drill",
        description: "An AI-powered SRE Chaos Engineering drill that safely injects database latency in staging, fires alerts, executes diagnostic playbooks, auto-heals systems, and compiles recovery timelines.",
        icon: "🐒",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "chaos-drill",
        status: "active",
        version: "1.0.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/chaos-drill.cycle.yaml",
            category: "operations",
            features: [
                "3-stage chained cycles (Chaos Injection -> Diagnosis & Healing -> Audit & Close)",
                "Specialized AI Agents (Chaos Monkey, SRE Remediation Agent, Post-Mortem Writer)",
                "Controlled latency simulation in staging database configurations",
                "Integration with Datadog metrics and PagerDuty alert triggers",
                "Automated self-healing and config remediation scripts",
                "Parent-to-child context serialization and data bridging",
                "Human-in-the-loop (HIL) safety checks for recovery abort validation",
            ],
            agents: 3,
            missions: 6,
            integrations: ["jira", "slack", "source_control", "database"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: Automated chaos drill, Datadog/PagerDuty integration, and self-healing.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
