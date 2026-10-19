/**
 * Register BudgetMaster — Sovereign Algorithmic Wealth Matrix in the App Arsenal Global Market
 *
 * Creates a public app entry so it appears in the marketplace.
 *
 * Usage: npx tsx server/scripts/register-budgetmaster-market.ts
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function register() {
    console.log("\n💰 Registering BudgetMaster in App Arsenal...\n");

    // Check if already registered
    const [existing] = await db.select().from(apps)
        .where(eq(apps.slug, "budgetmaster"))
        .limit(1);

    if (existing) {
        console.log(`  Already registered: "${existing.name}" (ID: ${existing.id})`);
        console.log("  Updating registry configuration...");
        await db.update(apps).set({
            isPublic: true,
            config: {
                type: "cycle_blueprint",
                cycleYamlPath: "server/cycles/budgetmaster.cycle.yaml",
                category: "finance",
                features: [
                    "Hot-folder statement ingestion (OFX/QIF/CSV) with AI categorization",
                    "Multi-context envelope, CapEx, and Schedule-E ledger management",
                    "Dead Man's Switch monitoring for missed recurring cashflows",
                    "Cash Drag / Yield Arbitrage engine with sweep recommendations",
                    "Subscription Decay analysis with quarantine and cancellation workflow",
                    "Capital Purchase Sandbox with amortization and opportunity-cost simulation",
                    "13-week rolling cash-flow forecasting with shortfall alerts",
                    "Self-employment quarterly estimated tax projections with safe-harbor",
                    "1099/W-2 information return preparation and filing tracking",
                    "Forecast calibration and prediction intelligence scoring",
                    "All money movement gated by human-in-the-loop approval",
                ],
                agents: 4,
                missions: 10,
                integrations: ["database", "slack", "email"],
            },
            updatedAt: new Date()
        }).where(eq(apps.id, existing.id));
        console.log("  ✅ Updated.\n");
        process.exit(0);
    }

    // Register as a public marketplace app
    const [app] = await db.insert(apps).values({
        name: "BudgetMaster — Sovereign Algorithmic Wealth Matrix",
        slug: "budgetmaster",
        description: "Personal-finance operating system: hot-folder statement ingestion (OFX/QIF/CSV), AI categorization, an envelope/CapEx/Schedule-E ledger, and four autonomous treasury engines — Dead Man's Switch, Cash Drag / Yield Arbitrage, Subscription Decay, and the Capital Purchase Sandbox — all gated by human approval.",
        icon: "💰",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        blueprint: "budgetmaster",
        status: "active",
        version: "1.0.0",
        createdBy: "system",
        config: {
            type: "cycle_blueprint",
            cycleYamlPath: "server/cycles/budgetmaster.cycle.yaml",
            category: "finance",
            features: [
                "Hot-folder statement ingestion (OFX/QIF/CSV) with AI categorization",
                "Multi-context envelope, CapEx, and Schedule-E ledger management",
                "Dead Man's Switch monitoring for missed recurring cashflows",
                "Cash Drag / Yield Arbitrage engine with sweep recommendations",
                "Subscription Decay analysis with quarantine and cancellation workflow",
                "Capital Purchase Sandbox with amortization and opportunity-cost simulation",
                "13-week rolling cash-flow forecasting with shortfall alerts",
                "Self-employment quarterly estimated tax projections with safe-harbor",
                "1099/W-2 information return preparation and filing tracking",
                "Forecast calibration and prediction intelligence scoring",
                "All money movement gated by human-in-the-loop approval",
            ],
            agents: 4,
            missions: 10,
            integrations: ["database", "slack", "email"],
        },
        pricePerLaunchUsd: "0",
        changelog: "Initial release: Personal finance OS with statement ingestion, 4 treasury engines, tax projections, and forecast calibration.",
    } as any).returning();

    console.log(`  ✅ Registered: "${app.name}" (ID: ${app.id})`);
    console.log(`  Slug: ${app.slug}`);
    console.log(`  Public: true (visible in Global Market)`);
    console.log("\n  Users can now find it in App Arsenal → Global Market.\n");

    process.exit(0);
}

register().catch(err => { console.error("Failed:", err); process.exit(1); });
