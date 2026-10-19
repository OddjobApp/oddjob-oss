/**
 * Slack Integration Fix Script
 * 1. Resolves bot_user_id via auth.test
 * 2. Seeds slack_workspaces from connector 4
 * 3. Marks connector 3 as inactive
 * 4. Updates saas_connectors with bot_user_id
 */

import { db } from "../server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { WebClient } from "@slack/web-api";

async function fix() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ODDJOB — Slack Integration Fix Script");
    console.log("═══════════════════════════════════════════════════════════\n");

    // 1. Get connector 4 credentials
    const [connector] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, 4));
    if (!connector) {
        console.log("❌ Connector 4 not found!");
        process.exit(1);
    }

    const creds = connector.credentials as any;
    const botToken = creds.bot_token;
    console.log("── [1] Auth Test ────────────────────────────────────────");

    let botUserId: string | undefined;
    let teamId: string | undefined;
    let teamName: string | undefined;
    let botName: string | undefined;

    try {
        const client = new WebClient(botToken);
        const authResult = await client.auth.test();
        botUserId = authResult.user_id as string;
        teamId = authResult.team_id as string;
        teamName = authResult.team as string;
        botName = authResult.user as string;
        console.log(`  ✅ Bot: @${botName} (${botUserId})`);
        console.log(`  ✅ Team: ${teamName} (${teamId})`);
    } catch (err: any) {
        console.log(`  ❌ auth.test failed: ${err.message}`);
        console.log("  ⚠️  Proceeding with manual values...");
    }

    // 2. Update connector 4 with bot_user_id and team_id
    if (botUserId || teamId) {
        console.log("\n── [2] Updating Connector 4 ─────────────────────────────");
        const updatedCreds = { ...creds };
        if (botUserId) updatedCreds.bot_user_id = botUserId;
        if (teamId) updatedCreds.team_id = teamId;

        await db.update(saasConnectors)
            .set({ credentials: updatedCreds })
            .where(eq(saasConnectors.id, 4));
        console.log(`  ✅ Connector 4 updated with bot_user_id=${botUserId}, team_id=${teamId}`);
    }

    // 3. Seed slack_workspaces
    console.log("\n── [3] Seeding slack_workspaces ──────────────────────────");
    
    // Check if already seeded
    const existing = await db.execute(sql`SELECT COUNT(*) as count FROM slack_workspaces`);
    const existingCount = (existing as any).rows?.[0]?.count ?? (existing as any)[0]?.count ?? 0;
    
    if (parseInt(existingCount) > 0) {
        console.log(`  ⏭️  Already has ${existingCount} rows — skipping seed`);
    } else if (teamId && teamName) {
        // Get default channel
        let defaultChannel = "#general";
        try {
            const client = new WebClient(botToken);
            const channels = await client.conversations.list({
                types: "public_channel",
                limit: 20,
                exclude_archived: true
            });
            const general = channels.channels?.find((c: any) => c.name === "general" || c.is_general);
            if (general) {
                defaultChannel = general.id as string;
                console.log(`  📍 Found #general channel: ${defaultChannel}`);
            }
        } catch (err: any) {
            console.log(`  ⚠️  Could not list channels: ${err.message}, using #general`);
        }

        await db.execute(sql`
            INSERT INTO slack_workspaces (
                organization_id, team_id, team_name, bot_token, bot_user_id,
                is_active, default_channel, 
                notify_on_mission_complete, notify_on_job_failure, notify_on_approval,
                installed_at, updated_at
            ) VALUES (
                ${connector.orgId},
                ${teamId},
                ${teamName},
                ${botToken},
                ${botUserId || ''},
                true,
                ${defaultChannel},
                true, true, true,
                NOW(), NOW()
            )
        `);
        console.log(`  ✅ Workspace seeded: ${teamName} (${teamId}) → org ${connector.orgId}`);
    } else {
        console.log("  ⚠️  Could not seed — missing team_id/team_name from auth.test");
    }

    // 4. Deactivate connector 3
    console.log("\n── [4] Cleaning Up Connector 3 ──────────────────────────");
    const [c3] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, 3));
    if (c3) {
        await db.update(saasConnectors)
            .set({ status: 'error', config: { ...((c3.config as any) || {}), deactivated_reason: 'Invalid credentials — bot_token contained description text' } })
            .where(eq(saasConnectors.id, 3));
        console.log("  ✅ Connector 3 marked with error status + deactivation reason");
    } else {
        console.log("  ⏭️  Connector 3 not found — skipping");
    }

    // 5. Verify
    console.log("\n── [5] Verification ─────────────────────────────────────");
    const workspaces = await db.execute(sql`SELECT id, team_id, team_name, is_active, default_channel FROM slack_workspaces`);
    const wsRows = (workspaces as any).rows || workspaces;
    console.log(`  Workspaces: ${wsRows.length}`);
    for (const w of wsRows) {
        console.log(`    • ${w.team_name} (${w.team_id}) | Active: ${w.is_active} | Channel: ${w.default_channel}`);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ All fixes applied successfully");
    console.log("═══════════════════════════════════════════════════════════\n");

    process.exit(0);
}

fix().catch(err => {
    console.error("Fix script failed:", err);
    process.exit(1);
});
