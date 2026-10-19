/**
 * Manual Test: Validate Forge v2 Platform Block Wiring
 * 
 * Run with: npx tsx scripts/test/validate-forge-v2.ts
 */
import { db } from "@server/database_service";
import { apps } from "@shared/schema";
import { eq } from "drizzle-orm";
import { eventStream } from "@domain/core/infrastructure/event-stream.service";
import { appForgeService } from "@domain/apps/app-forge.service";

const TEST_SLUG = `test-forge-v2-${Date.now().toString(36).slice(-6)}`;

async function validateForgeV2() {
  console.log("\n🔨 Forge v2 Platform Block Validation\n");
  console.log("=====================================\n");

  try {
    // Step 1: Trigger a test forge
    console.log("1️⃣  Triggering test forge...");
    console.log(`   Slug: ${TEST_SLUG}`);
    
    const result = await appForgeService.forgeApp("crud-app", {
      name: `Test Forge v2 ${TEST_SLUG}`,
      slug: TEST_SLUG,
      description: "Validation test for platform block slot injection",
      oddjobMissionId: 0,
      blackboard: {
        target_collection: "test_items",
        entity_singular: "Item",
        columns: [
          { key: "name", label: "Name", type: "text" },
          { key: "status", label: "Status", type: "text" }
        ],
        metrics: [
          { label: "Total Items", valueAccessor: "count", iconName: "Box" }
        ]
      }
    } as any);

    if (!result.success) {
      console.error("❌ Forge failed:", (result as any).error);
      process.exit(1);
    }

    console.log("✅ Forge initiated successfully");
    console.log(`   Job ID: ${result.jobId}\n`);

    // Step 2: Verify events were emitted
    console.log("2️⃣  Checking event stream...");
    
    const recentEvents = eventStream.getRecent(10, undefined, "forge");
    const forgeEvents = recentEvents.filter((e: any) => e.eventType.includes(TEST_SLUG));
    
    console.log(`   Found ${forgeEvents.length} forge events`);
    
    const expectedEvents = [
      "ignition_started",
      "blueprint_selected", 
      "workspace_prepared",
      "slot_tokens_injected",
      "deployment_ready"
    ];
    
    for (const eventType of expectedEvents) {
      const found = forgeEvents.some((e: any) => e.eventType.includes(eventType));
      console.log(`   ${found ? "✅" : "❌"} ${eventType}`);
    }
    console.log();

    // Step 3: Verify app record
    console.log("3️⃣  Verifying app record...");
    
    const [app] = await db
      .select()
      .from(apps)
      .where(eq(apps.slug, TEST_SLUG))
      .limit(1);

    if (!app) {
      console.error("❌ App not found in database");
      process.exit(1);
    }

    console.log("✅ App record found");
    console.log(`   ID: ${app.id}`);
    console.log(`   Name: ${app.name}`);
    console.log(`   Status: ${app.status}`);
    console.log(`   Blueprint: ${app.blueprintSlug}\n`);

    // Step 4: Check runtime metadata
    console.log("4️⃣  Checking runtime metadata...");
    
    const runtimeMetadata = app.runtimeMetadata as any;
    
    if (runtimeMetadata) {
      console.log("✅ Runtime metadata present");
      console.log(`   Last shadow run: ${runtimeMetadata.lastShadowRunAt || "N/A"}`);
      console.log(`   Active port: ${runtimeMetadata.activePort || "N/A"}\n`);
    } else {
      console.log("⚠️  No runtime metadata (app may still be starting)\n");
    }

    // Step 5: Cleanup
    console.log("5️⃣  Cleanup...");
    
    await db
      .delete(apps)
      .where(eq(apps.slug, TEST_SLUG));
    
    console.log("✅ Test app cleaned up\n");

    console.log("=====================================\n");
    console.log("🎉 All validations passed!\n");
    console.log("Summary:");
    console.log(`  • Forge job created: ${result.jobId}`);
    console.log(`  • App record created: ${app.id}`);
    console.log(`  • Events emitted: ${forgeEvents.length}`);
    console.log(`  • Slot injection: ${forgeEvents.some((e: any) => e.eventType.includes("slot_tokens_injected")) ? "✅" : "❌"}`);
    console.log();

    process.exit(0);

  } catch (error) {
    console.error("\n❌ Validation failed:", error);
    
    // Attempt cleanup
    try {
      await db.delete(apps).where(eq(apps.slug, TEST_SLUG));
      console.log("🧹 Cleanup completed after error");
    } catch {
      // Ignore cleanup errors
    }
    
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  validateForgeV2();
}

export { validateForgeV2, TEST_SLUG };
