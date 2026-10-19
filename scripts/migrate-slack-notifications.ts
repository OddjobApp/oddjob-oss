/**
 * Migrate slack_notifications to match the Drizzle schema
 * Renames existing columns and adds missing ones
 */
import { db } from "../server/database_service.js";
import { sql } from "drizzle-orm";

async function migrate() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  Migrating slack_notifications table");
    console.log("═══════════════════════════════════════════════════════════\n");

    const alterations = [
        // Rename existing columns to match Drizzle schema
        { check: "notification_type", sql: `ALTER TABLE slack_notifications RENAME COLUMN notification_type TO type`, desc: "Rename notification_type → type" },
        { check: "related_job_id", sql: `ALTER TABLE slack_notifications RENAME COLUMN related_job_id TO job_id`, desc: "Rename related_job_id → job_id" },
        { check: "related_mission_id", sql: `ALTER TABLE slack_notifications RENAME COLUMN related_mission_id TO mission_id`, desc: "Rename related_mission_id → mission_id" },
        { check: "status", sql: `ALTER TABLE slack_notifications RENAME COLUMN status TO delivery_status`, desc: "Rename status → delivery_status" },
    ];

    const additions = [
        // Add missing columns
        { col: "mission_run_id", sql: `ALTER TABLE slack_notifications ADD COLUMN IF NOT EXISTS mission_run_id INTEGER`, desc: "Add mission_run_id" },
        { col: "collection_id", sql: `ALTER TABLE slack_notifications ADD COLUMN IF NOT EXISTS collection_id INTEGER`, desc: "Add collection_id" },
        { col: "approval_request_id", sql: `ALTER TABLE slack_notifications ADD COLUMN IF NOT EXISTS approval_request_id INTEGER`, desc: "Add approval_request_id" },
        { col: "has_interactive_blocks", sql: `ALTER TABLE slack_notifications ADD COLUMN IF NOT EXISTS has_interactive_blocks BOOLEAN DEFAULT false`, desc: "Add has_interactive_blocks" },
        { col: "interactions_count", sql: `ALTER TABLE slack_notifications ADD COLUMN IF NOT EXISTS interactions_count INTEGER DEFAULT 0`, desc: "Add interactions_count" },
        { col: "delivered_at", sql: `ALTER TABLE slack_notifications ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP`, desc: "Add delivered_at" },
    ];

    // Get current columns to check what needs renaming
    const colResult = await db.execute(sql.raw("SELECT column_name FROM information_schema.columns WHERE table_name = 'slack_notifications'"));
    const existingCols = new Set(((colResult as any).rows || colResult).map((r: any) => r.column_name));
    console.log("  Current columns:", [...existingCols].join(", "));

    // Apply renames (only if old column exists and new doesn't)
    for (const alt of alterations) {
        if (existingCols.has(alt.check)) {
            try {
                await db.execute(sql.raw(alt.sql));
                console.log(`  ✅ ${alt.desc}`);
            } catch (err: any) {
                console.log(`  ⚠️  ${alt.desc} — ${err.message.substring(0, 60)}`);
            }
        } else {
            console.log(`  ⏭️  ${alt.desc} — column already renamed`);
        }
    }

    // Apply additions
    for (const add of additions) {
        try {
            await db.execute(sql.raw(add.sql));
            console.log(`  ✅ ${add.desc}`);
        } catch (err: any) {
            console.log(`  ⚠️  ${add.desc} — ${err.message.substring(0, 60)}`);
        }
    }

    // Verify final state
    console.log("\n── Final Column State ───────────────────────────────────");
    const finalResult = await db.execute(sql.raw("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'slack_notifications' ORDER BY ordinal_position"));
    const finalRows = (finalResult as any).rows || finalResult;
    finalRows.forEach((r: any) => console.log(`  ${r.column_name.padEnd(25)} ${r.data_type}`));

    // Test Drizzle query
    console.log("\n── Drizzle Query Test ───────────────────────────────────");
    try {
        const { slackNotifications } = await import("@shared/schema/index.js");
        const notifications = await db.select().from(slackNotifications).limit(1);
        console.log(`  ✅ Drizzle query works — ${notifications.length} rows returned`);
    } catch(e: any) {
        console.log(`  ❌ Still broken: ${e.message.substring(0, 100)}`);
    }

    console.log("\n  Done.\n");
    process.exit(0);
}

migrate().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});
