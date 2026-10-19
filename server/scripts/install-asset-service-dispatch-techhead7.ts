/**
 * Install QR Asset Triage & Service Dispatch for TECHHEAD7 (org id=291)
 *
 * Loads the cycle YAML, provisions it via orgForgeService.installCycleApp,
 * then seeds managed_assets, service_providers, and service_requests datasets
 * with sample data and registers providers in the Redis geospatial index.
 *
 * Usage: npx tsx server/scripts/install-asset-service-dispatch-techhead7.ts
 */
import { db } from "../database_service.js";
import { orgs, datasets, datasetItems } from "@shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import { rescueGeoService } from "../domain/rescue/core/geo-service.js";
import { createLogger } from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { eq, and } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createLogger("InstallAssetServiceDispatch");

const ORG_ID = 291;

// ─── Sample Managed Assets ─────────────────────────────────────────────────────

const MANAGED_ASSETS = [
    {
        assetId: "AST-001",
        name: "Break Room Coffee Machine",
        type: "coffee_vending",
        manufacturer: "Keurig",
        make: "Keurig",
        model: "K-3500",
        serialNumber: "KRG-2024-00847",
        address: "123 Main St, Suite 400, Los Angeles, CA",
        lat: 34.0522,
        lng: -118.2437,
        floor: "4th Floor",
        building: "HQ West",
        room: "Break Room 4B",
        accessInstructions: "Badge required. Elevator to 4th floor, turn left past reception.",
        lastServiceDate: "2025-11-15",
        warrantyExpiry: "2026-06-01",
        inventory: [
            { slot: "A1", item: "Dark Roast Coffee", category: "hot" },
            { slot: "A2", item: "Oat Milk Latte", category: "hot" },
            { slot: "A3", item: "Green Tea", category: "hot" },
            { slot: "B1", item: "Iced Coffee", category: "cold" },
            { slot: "B2", item: "Sparkling Water", category: "cold" },
            { slot: "B3", item: "Energy Drink", category: "cold" },
        ],
    },
    {
        assetId: "AST-002",
        name: "Lobby Espresso Station",
        type: "coffee_vending",
        manufacturer: "Nespresso",
        make: "Nespresso",
        model: "Momento 200",
        serialNumber: "NSP-2023-14290",
        address: "123 Main St, Los Angeles, CA",
        lat: 34.0522,
        lng: -118.2437,
        floor: "1st Floor",
        building: "HQ West",
        room: "Main Lobby",
        accessInstructions: "Open access during business hours. Security desk nearby.",
        lastServiceDate: "2025-10-28",
        warrantyExpiry: "2026-03-15",
        inventory: [
            { slot: "A1", item: "Espresso", category: "hot" },
            { slot: "A2", item: "Cappuccino", category: "hot" },
            { slot: "A3", item: "Hot Chocolate", category: "hot" },
            { slot: "A4", item: "Chai Latte", category: "hot" },
            { slot: "B1", item: "Iced Americano", category: "cold" },
            { slot: "B2", item: "Cold Brew", category: "cold" },
        ],
    },
    {
        assetId: "AST-003",
        name: "Fleet Van #7",
        type: "vehicle",
        manufacturer: "Ford",
        make: "Ford",
        model: "Transit 250",
        serialNumber: "FRD-2022-07831",
        address: "456 Industrial Blvd, Los Angeles, CA",
        lat: 34.0195,
        lng: -118.2860,
        floor: "Ground",
        building: "Fleet Depot",
        room: "Bay 7",
        accessInstructions: "Fleet key required from dispatch office. Check out on clipboard.",
        lastServiceDate: "2025-12-01",
        warrantyExpiry: "2025-09-30",
    },
    {
        assetId: "AST-004",
        name: "Server Room HVAC Unit",
        type: "hvac",
        manufacturer: "Daikin",
        make: "Daikin",
        model: "VRV IV",
        serialNumber: "DKN-2021-55102",
        address: "123 Main St, Suite 400, Los Angeles, CA",
        lat: 34.0522,
        lng: -118.2437,
        floor: "Basement",
        building: "HQ West",
        room: "Server Room B1",
        accessInstructions: "Restricted access. Requires facilities badge + PIN. Contact IT for escort.",
        lastServiceDate: "2025-11-01",
        warrantyExpiry: "2027-01-15",
    },
    {
        assetId: "AST-005",
        name: "Executive Floor Printer",
        type: "printer",
        manufacturer: "HP",
        make: "HP",
        model: "LaserJet Enterprise M611",
        serialNumber: "HPE-2023-33019",
        address: "123 Main St, Suite 400, Los Angeles, CA",
        lat: 34.0522,
        lng: -118.2437,
        floor: "6th Floor",
        building: "HQ West",
        room: "Print Center",
        accessInstructions: "Badge access to 6th floor. Printer room is unlocked during business hours.",
        lastServiceDate: "2025-10-15",
        warrantyExpiry: "2026-10-01",
    },
];

// ─── Sample Service Providers ───────────────────────────────────────────────────

const SERVICE_PROVIDERS = [
    {
        providerId: "PRV-001",
        name: "QuickFix Services",
        lat: 34.0612,
        lng: -118.2500,
        rating: 4.8,
        specialties: ["coffee_vending", "printer"],
        availability: "weekdays_8_to_6",
    },
    {
        providerId: "PRV-002",
        name: "FleetCare Mobile",
        lat: 34.0300,
        lng: -118.2700,
        rating: 4.5,
        specialties: ["vehicle"],
        availability: "24_7",
    },
    {
        providerId: "PRV-003",
        name: "CoolTech HVAC",
        lat: 34.0450,
        lng: -118.2300,
        rating: 4.9,
        specialties: ["hvac"],
        availability: "weekdays_7_to_7",
    },
    {
        providerId: "PRV-004",
        name: "AllPro Facilities",
        lat: 34.0580,
        lng: -118.2550,
        rating: 4.2,
        specialties: ["coffee_vending", "hvac", "printer", "elevator"],
        availability: "weekdays_8_to_5",
    },
];

// ─── Service Requests Seed (empty — populated at runtime) ───────────────────────

const SERVICE_REQUESTS_SEED: any[] = []; // Dataset created empty, populated at runtime

// ─── Helpers ────────────────────────────────────────────────────────────────────

async function ensureDataset(name: string, description: string, tags: string[]): Promise<number> {
    const existing = await db.query.datasets.findFirst({
        where: and(
            eq(datasets.name, name),
            eq(datasets.organizationId, ORG_ID)
        ),
    });

    if (existing) {
        console.log(`  📂 Dataset "${name}" already exists (ID: ${existing.id})`);
        return existing.id;
    }

    const [newDs] = await db.insert(datasets).values({
        name,
        description,
        organizationId: ORG_ID,
        tags,
    }).returning();

    console.log(`  ✅ Dataset created: "${name}" (ID: ${newDs.id})`);
    return newDs.id;
}

/**
 * Idempotently upsert a dataset item keyed by a field inside `data`
 * (e.g. "assetId" / "providerId"). Updates the existing record in place and
 * removes any duplicate copies left by earlier non-idempotent runs, so re-running
 * the installer converges to exactly one canonical record per key.
 */
async function upsertDatasetItem(datasetId: number, idField: string, data: Record<string, any>): Promise<"created" | "updated"> {
    const idValue = data[idField];
    const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
    const matches = (items as any[]).filter((i) => (i.data as any)?.[idField] === idValue);

    if (matches.length === 0) {
        await db.insert(datasetItems).values({ datasetId, data });
        return "created";
    }

    // Keep the first record, refresh it with the canonical data, and prune duplicates.
    await db.update(datasetItems).set({ data }).where(eq(datasetItems.id, matches[0].id));
    for (const dup of matches.slice(1)) {
        await db.delete(datasetItems).where(eq(datasetItems.id, dup.id));
    }
    if (matches.length > 1) {
        console.log(`    🧹 Removed ${matches.length - 1} duplicate(s) of ${idField}=${idValue}`);
    }
    return "updated";
}

// ─── Main Install ───────────────────────────────────────────────────────────────

async function install() {
    try {
        // 1. Verify TECHHEAD7 org exists
        const [org] = await db.select().from(orgs).where(eq(orgs.id, ORG_ID)).limit(1);
        if (!org) throw new Error(`TECHHEAD7 org (id=${ORG_ID}) not found in database`);

        console.log(`\n🔧 Installing QR Asset Triage & Service Dispatch for "${org.name}" (ID: ${org.id})...\n`);

        // 2. Load and install cycle YAML
        const yamlPath = path.resolve(__dirname, "../cycles/asset-service-dispatch.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log("  Loading cycle YAML from:", yamlPath);
        console.log(`  Installing Cycle App via Org Forge into Org ${org.id}...`);

        const result = await orgForgeService.installCycleApp(org.id, yamlContent);

        console.log("\n  ══════════════════════════════════════════");
        console.log("  ✅ Cycle Installation Successful!");
        console.log("  ══════════════════════════════════════════");
        console.log("  Result:", JSON.stringify(result, null, 2));

        // 3. Seed managed_assets dataset
        console.log("\n  📦 Seeding Managed Assets dataset...\n");
        const assetsDatasetId = await ensureDataset(
            "Managed Assets",
            "Physical assets linked via QR codes for triage and service dispatch.",
            ["platform:asset-dispatch", "utility:assets"]
        );

        for (const asset of MANAGED_ASSETS) {
            const op = await upsertDatasetItem(assetsDatasetId, "assetId", asset);
            console.log(`    ${op === "created" ? "✅" : "♻️"} Asset (${op}): ${asset.name} (${asset.assetId}) — ${asset.building}, ${asset.floor}`);
        }

        // 4. Seed service_providers dataset + Redis geo index
        console.log("\n  🚐 Seeding Service Providers dataset + geo index...\n");
        const providersDatasetId = await ensureDataset(
            "Service Providers",
            "Active service technicians and companies for proximity-based dispatch.",
            ["platform:asset-dispatch", "utility:providers"]
        );

        for (const provider of SERVICE_PROVIDERS) {
            const op = await upsertDatasetItem(providersDatasetId, "providerId", {
                providerId: provider.providerId,
                name: provider.name,
                rating: provider.rating,
                specialties: provider.specialties,
                availability: provider.availability,
                lat: provider.lat,
                lng: provider.lng,
            });

            // Register in Redis Geospatial Index for proximity search (idempotent)
            await rescueGeoService.updateHelperLocation(provider.providerId, provider.lat, provider.lng);

            console.log(`    ${op === "created" ? "✅" : "♻️"} Provider (${op}): ${provider.name} (${provider.providerId}) — Rating: ${provider.rating}, Specialties: [${provider.specialties.join(", ")}]`);
        }

        // 5. Create Service Requests dataset (empty, populated at runtime)
        console.log("\n  📋 Creating Service Requests dataset...\n");
        const serviceRequestsDatasetId = await ensureDataset(
            "Service Requests",
            "Runtime-populated dataset for service requests, restock logs, and feedback entries.",
            ["platform:asset-dispatch", "utility:service-requests"]
        );

        // Seed any initial items if provided
        for (const request of SERVICE_REQUESTS_SEED) {
            await db.insert(datasetItems).values({
                datasetId: serviceRequestsDatasetId,
                data: request,
            });
        }

        console.log("\n  ══════════════════════════════════════════");
        console.log("  ✅ Full Installation Complete!");
        console.log("  ══════════════════════════════════════════");
        console.log(`  • Cycle app installed for org ${org.id}`);
        console.log(`  • ${MANAGED_ASSETS.length} managed assets seeded`);
        console.log(`  • ${SERVICE_PROVIDERS.length} service providers seeded + geo-indexed`);
        console.log(`  • Service Requests dataset created (empty, runtime-populated)`);
        console.log("  ══════════════════════════════════════════\n");

        process.exit(0);
    } catch (e) {
        console.error("\n❌ Installation failed:", e);
        logger.error("Asset service dispatch install failed", e);
        process.exit(1);
    }
}

install();
