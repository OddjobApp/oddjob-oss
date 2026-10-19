/**
 * Register QR Asset Triage & Service Dispatch in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace.
 *
 * Usage: npx tsx server/scripts/register-asset-service-dispatch-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n🔧 Registering QR Asset Triage & Service Dispatch in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "asset-service-dispatch"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating registry configuration...");
        await db.update(apps).set({
            isPublic: true,
            config: {
                type: "cycle_blueprint",
                cycleYamlPath: "server/cycles/asset-service-dispatch.cycle.yaml",
                category: "operations",
                features: [
                    "QR code scan triggers AI-powered triage conversation for any physical asset",
                    "Adaptive diagnostic flow based on asset type (coffee machines, vehicles, HVAC, printers, elevators)",
                    "Self-service resolution with step-by-step guided fixes before escalation",
                    "Proximity × rating provider matching with specialty filters",
                    "Real-time dispatch tracking with ETA sent via Email or SMS",
                    "Managed asset dataset with full location and equipment metadata",
                    "Human-in-the-loop escalation confirmation form",
                ],
                agents: 2,
                missions: 3,
                integrations: ["slack", "database"],
            },
            updatedAt: new Date()
        }).where(eq(apps.id, existing.id));
        console.log("  ✅ Updated.\n");
        process.exit(0);
    }

    // Register as a public marketplace app
    const [app] = await db.insert(apps).values({
        name: "QR Asset Triage & Service Dispatch",
        slug: "asset-service-dispatch",
        description: "AI-powered triage and service dispatch for any QR-linked physical asset. Users scan a QR code to reach ServiceBot for guided troubleshooting. Unresolved issues automatically dispatch the nearest rated service provider with live tracking.",
        icon: "🔧",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "asset-service-dispatch",
        status: "active",
        version: "1.0.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/asset-service-dispatch.cycle.yaml",
            category: "operations",
            features: [
                "QR code scan triggers AI-powered triage conversation for any physical asset",
                "Adaptive diagnostic flow based on asset type (coffee machines, vehicles, HVAC, printers, elevators)",
                "Self-service resolution with step-by-step guided fixes before escalation",
                "Proximity × rating provider matching with specialty filters",
                "Real-time dispatch tracking with ETA sent via Email or SMS",
                "Managed asset dataset with full location and equipment metadata",
                "Human-in-the-loop escalation confirmation form",
            ],
            agents: 2,
            missions: 3,
            integrations: ["slack", "database"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: QR-based asset triage, adaptive diagnostics, proximity-rated service dispatch.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
