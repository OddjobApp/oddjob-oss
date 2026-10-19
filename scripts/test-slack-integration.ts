/**
 * Bi-Directional Slack Integration Diagnostic Test
 * Tests: DB tables, Socket Mode health, outbound messaging, connector state
 */

import { db } from "../server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { SlackSocketListener } from "../server/domain/integrations/slack-socket-listener.js";

async function runDiagnostics() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ODDJOB — Bi-Directional Slack Integration Diagnostics");
    console.log("═══════════════════════════════════════════════════════════\n");

    // ──────────────────────────────────────
    // 1. DATABASE TABLE EXISTENCE CHECK
    // ──────────────────────────────────────
    console.log("── [1] Database Tables ──────────────────────────────────");
    const tables = ['slack_workspaces', 'slack_commands', 'slack_interactions', 'slack_notifications', 'slack_channel_subscriptions'];
    for (const table of tables) {
        try {
            const result = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM ${table}`));
            const count = (result as any).rows?.[0]?.count ?? (result as any)[0]?.count ?? '?';
            console.log(`  ✅ ${table.padEnd(30)} — ${count} rows`);
        } catch (err: any) {
            console.log(`  ❌ ${table.padEnd(30)} — MISSING (${err.message.substring(0, 60)})`);
        }
    }

    // ──────────────────────────────────────
    // 2. SAAS CONNECTORS (Slack entries)
    // ──────────────────────────────────────
    console.log("\n── [2] SaaS Connectors (Slack) ──────────────────────────");
    const connectors = await db.select().from(saasConnectors).where(eq(saasConnectors.platform, 'slack'));
    if (connectors.length === 0) {
        console.log("  ⚠️  No Slack connectors found in saas_connectors table");
    } else {
        for (const c of connectors) {
            const creds = c.credentials as any;
            console.log(`  Connector ID: ${c.id}`);
            console.log(`    Org ID:      ${c.orgId}`);
            console.log(`    Status:      ${c.status}`);
            console.log(`    Bot Token:   ${creds?.bot_token ? '✅ Present (' + creds.bot_token.substring(0, 12) + '...)' : '❌ Missing'}`);
            console.log(`    App Token:   ${creds?.app_token ? '✅ Present (' + creds.app_token.substring(0, 12) + '...)' : '❌ Missing'}`);
            console.log(`    Bot User ID: ${creds?.bot_user_id || '⚠️  Not set'}`);
            console.log(`    Team ID:     ${creds?.team_id || (c.config as any)?.team_id || '⚠️  Not set'}`);
        }
    }

    // ──────────────────────────────────────
    // 3. SLACK WORKSPACES TABLE
    // ──────────────────────────────────────
    console.log("\n── [3] Slack Workspaces ─────────────────────────────────");
    try {
        const workspaces = await db.execute(sql`SELECT id, organization_id, team_id, team_name, is_active, default_channel FROM slack_workspaces`);
        const rows = (workspaces as any).rows || workspaces;
        if (rows.length === 0) {
            console.log("  ⚠️  No workspaces registered in slack_workspaces table");
            console.log("  💡 This means the workspace API endpoints will return empty arrays.");
            console.log("     The Socket Mode listener uses saas_connectors directly,");
            console.log("     but the REST API reads from slack_workspaces.");
        } else {
            for (const w of rows) {
                console.log(`  Workspace: ${w.team_name} (${w.team_id}) | Active: ${w.is_active} | Channel: ${w.default_channel || 'none'}`);
            }
        }
    } catch (err: any) {
        console.log(`  ❌ Table missing: ${err.message.substring(0, 80)}`);
    }

    // ──────────────────────────────────────
    // 4. SOCKET MODE HEALTH
    // ──────────────────────────────────────
    console.log("\n── [4] Socket Mode Health ───────────────────────────────");
    const health = SlackSocketListener.getHealthStatus();
    if (health.length === 0) {
        console.log("  ⚠️  No Socket Mode connections active");
        console.log("  💡 The listener initializes during server boot (index.ts line ~380)");
    } else {
        for (const h of health) {
            console.log(`  Connector ${h.connectorId}: ${h.isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY'} | Reconnects: ${h.reconnectAttempts}`);
        }
    }

    // ──────────────────────────────────────
    // 5. OUTBOUND MESSAGE TEST (Dry Run)
    // ──────────────────────────────────────
    console.log("\n── [5] Outbound Message Capability ──────────────────────");
    const activeConnector = connectors.find(c => c.status === 'connected');
    if (activeConnector) {
        const creds = activeConnector.credentials as any;
        const botToken = creds?.bot_token;
        if (botToken) {
            try {
                const { getSlackClient } = await import("../server/domain/integrations/slack-service.js");
                const client = await getSlackClient(botToken);
                
                // Try to list channels (validates token)
                const channels = await client.getChannels(5);
                console.log(`  ✅ Bot token is valid — can see ${channels.length} channels`);
                if (channels.length > 0) {
                    console.log(`     Channels: ${channels.map((c: any) => '#' + c.name).join(', ')}`);
                }
                
                // Try auth.test to get bot identity
                const { WebClient } = await import("@slack/web-api");
                const webClient = new WebClient(botToken);
                const authResult = await webClient.auth.test();
                console.log(`  ✅ Bot identity: @${authResult.user} (Team: ${authResult.team})`);
                console.log(`     Bot User ID: ${authResult.user_id}`);
                console.log(`     Team ID:     ${authResult.team_id}`);
            } catch (err: any) {
                console.log(`  ❌ Bot token validation failed: ${err.message}`);
            }
        } else {
            console.log("  ❌ No bot_token available for outbound test");
        }
    } else {
        console.log("  ⏭️  Skipped — no connectors to test");
    }

    // ──────────────────────────────────────
    // 6. INBOUND PATH VALIDATION
    // ──────────────────────────────────────
    console.log("\n── [6] Inbound Pipeline Components ──────────────────────");
    
    // Check conversational bridge
    try {
        const { conversationalBridgeService } = await import("../server/domain/integrations/conversational-bridge.service.js");
        console.log(`  ✅ ConversationalBridge service loaded`);
        console.log(`     Methods: ${Object.keys(conversationalBridgeService).join(', ')}`);
    } catch (err: any) {
        console.log(`  ❌ ConversationalBridge failed to load: ${err.message}`);
    }

    // Check mission messaging bridge
    try {
        const { missionMessagingBridge } = await import("../server/domain/integrations/mission-messaging-bridge.js");
        console.log(`  ✅ MissionMessagingBridge service loaded`);
    } catch (err: any) {
        console.log(`  ❌ MissionMessagingBridge failed to load: ${err.message}`);
    }

    // ──────────────────────────────────────
    // 7. ENV VARS
    // ──────────────────────────────────────
    console.log("\n── [7] Environment Variables ────────────────────────────");
    const envVars = [
        'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET',
        'SLACK_APP_TOKEN', 'SLACK_BOT_USER_ID', 'SLACK_REDIRECT_URI'
    ];
    for (const v of envVars) {
        const val = process.env[v];
        console.log(`  ${val ? '✅' : '⚠️ '} ${v.padEnd(25)} ${val ? '= ' + val.substring(0, 15) + '...' : '= (not set)'}`);
    }

    // ──────────────────────────────────────
    // SUMMARY
    // ──────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  DIAGNOSTIC SUMMARY");
    console.log("═══════════════════════════════════════════════════════════");
    
    const issues: string[] = [];
    if (connectors.length === 0) issues.push("No Slack connectors in saas_connectors");
    if (health.length === 0) issues.push("Socket Mode not active (runs during server boot only)");
    if (!process.env.SLACK_APP_TOKEN) issues.push("SLACK_APP_TOKEN not set");
    if (!process.env.SLACK_BOT_USER_ID) issues.push("SLACK_BOT_USER_ID not set");
    
    if (issues.length === 0) {
        console.log("  ✅ All systems nominal");
    } else {
        issues.forEach(i => console.log(`  ⚠️  ${i}`));
    }
    
    console.log("\n  Done.\n");
    process.exit(0);
}

runDiagnostics().catch(err => {
    console.error("Diagnostic failed:", err);
    process.exit(1);
});
