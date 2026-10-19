/**
 * Slack Token Encryption Migration Script
 * 
 * This script encrypts existing plaintext Slack tokens stored in the database.
 * Run this after setting up ENCRYPTION_KEY or APP_TOKEN_ENCRYPTION_KEY.
 * 
 * Usage:
 *   npx tsx scripts/migrate-slack-tokens.ts
 * 
 * Options:
 *   --dry-run    Preview changes without modifying database
 *   --workspace  <id>  Encrypt only specific workspace
 */

import { db } from "@server/database_service.js";
import { slackWorkspaces } from "@shared/schema/index.js";
import { slackService } from "@domain/integrations/core/slack.service.js";
import { isEncryptionAvailable } from "@server/utils/encryption.js";
import { eq } from "drizzle-orm";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const workspaceArg = args.find(arg => arg.startsWith("--workspace="));
const specificWorkspaceId = workspaceArg ? parseInt(workspaceArg.split("=")[1]) : null;

async function main() {
    console.log("🔐 Slack Token Encryption Migration");
    console.log("=====================================\n");

    // Check encryption is available
    if (!isEncryptionAvailable()) {
        console.error("❌ Encryption is not configured!");
        console.error("Set ENCRYPTION_KEY or APP_TOKEN_ENCRYPTION_KEY environment variable.");
        console.error("Generate a key with: openssl rand -hex 32");
        process.exit(1);
    }

    console.log("✅ Encryption is available\n");

    // Get workspaces to process
    let workspaces;
    if (specificWorkspaceId) {
        workspaces = await db.select()
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.id, specificWorkspaceId));
    } else {
        workspaces = await db.select()
            .from(slackWorkspaces);
    }

    console.log(`Found ${workspaces.length} workspace(s) to process\n`);

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const workspace of workspaces) {
        console.log(`Processing workspace ${workspace.id} (${workspace.teamName})...`);

        // Skip if tokens are already encrypted (indicated by placeholder '[encrypted]')
        if (workspace.botToken === '[encrypted]' || !workspace.botToken) {
            console.log(`  ℹ️  Skipped (already encrypted or no token)\n`);
            skipped++;
            continue;
        }

        if (isDryRun) {
            console.log(`  🔍 Would encrypt bot token: ${workspace.botToken.substring(0, 10)}...***`);
            if (workspace.userToken) {
                console.log(`  🔍 Would encrypt user token: ${workspace.userToken.substring(0, 10)}...***`);
            }
            console.log(`  ✅ Dry run - no changes made\n`);
            success++;
            continue;
        }

        try {
            const result = await slackService.encryptWorkspaceTokens(workspace.id);
            if (result) {
                console.log(`  ✅ Successfully encrypted tokens\n`);
                success++;
            } else {
                console.log(`  ❌ Failed to encrypt tokens\n`);
                failed++;
            }
        } catch (err: any) {
            console.log(`  ❌ Error: ${err.message}\n`);
            failed++;
        }
    }

    console.log("\n=====================================");
    console.log("Migration Summary");
    console.log("=====================================");
    console.log(`✅ Success: ${success}`);
    console.log(`⚠️  Skipped: ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`\nTotal: ${workspaces.length} workspaces`);

    if (isDryRun) {
        console.log("\n📝 This was a dry run. No changes were made.");
        console.log("Run without --dry-run to apply changes.");
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
