/**
 * Verify Slack Security Database Schema
 * 
 * Run after db:push to confirm encrypted_credentials table exists
 * and test the full encryption flow with actual database.
 */

import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";
import { encrypt, decrypt, isEncryptionAvailable } from "@server/utils/encryption.js";
import { encryptedCredentialsService } from "@domain/auth/core/encrypted-credentials.service.js";
import { slackService } from "@domain/integrations/core/slack.service.js";

console.log("🔐 Slack Security Database Verification\n");

async function verifyTableExists() {
    console.log("1️⃣ Checking encrypted_credentials table...");
    
    try {
        const result = await db.execute(sql`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'encrypted_credentials'
            );
        `);
        
        const exists = result.rows[0]?.exists;
        if (exists) {
            console.log("   ✅ encrypted_credentials table exists\n");
            return true;
        } else {
            console.log("   ❌ encrypted_credentials table NOT found");
            console.log("   Run: npm run db:push\n");
            return false;
        }
    } catch (err: any) {
        console.error("   ❌ Error checking table:", err.message, "\n");
        return false;
    }
}

async function verifyEncryptionAvailable() {
    console.log("2️⃣ Checking encryption configuration...");
    
    const available = isEncryptionAvailable();
    if (available) {
        console.log("   ✅ ENCRYPTION_KEY is configured\n");
        return true;
    } else {
        console.log("   ⚠️  ENCRYPTION_KEY not set");
        console.log("   Generate: openssl rand -hex 32");
        console.log("   Set in .env: ENCRYPTION_KEY=<your-key>\n");
        return false;
    }
}

async function testEndToEndEncryption() {
    console.log("3️⃣ Testing end-to-end encryption flow...");
    
    if (!isEncryptionAvailable()) {
        console.log("   ⏭️  Skipping (encryption not available)\n");
        return true;
    }
    
    try {
        const testOrgId = 999999;
        const testEntityId = 888888;
        const testData = { 
            token: "xoxb-test-slack-token-12345",
            scope: "chat:write,commands"
        };
        
        // Store
        await encryptedCredentialsService.store(
            testOrgId,
            'slack_workspace',
            testEntityId,
            'bot_token',
            testData
        );
        console.log("   ✅ Stored encrypted credentials");
        
        // Retrieve
        const retrieved = await encryptedCredentialsService.retrieve(
            testOrgId,
            'slack_workspace',
            testEntityId,
            'bot_token'
        );
        
        if (!retrieved || retrieved.token !== testData.token) {
            console.log("   ❌ Retrieved data doesn't match");
            return false;
        }
        console.log("   ✅ Retrieved and verified encrypted credentials");
        
        // Cleanup
        await encryptedCredentialsService.delete(testOrgId, 'slack_workspace', testEntityId, 'bot_token');
        console.log("   ✅ Cleaned up test data\n");
        
        return true;
    } catch (err: any) {
        console.error("   ❌ End-to-end test failed:", err.message, "\n");
        return false;
    }
}

async function checkExistingSlackWorkspaces() {
    console.log("4️⃣ Checking existing Slack workspaces...");
    
    try {
        const { slackWorkspaces } = await import("@shared/schema/index.js");
        const workspaces = await db.select({
            id: slackWorkspaces.id,
            teamName: slackWorkspaces.teamName,
            botToken: slackWorkspaces.botToken,
            hasToken: sql<boolean>`${slackWorkspaces.botToken} IS NOT NULL`
        }).from(slackWorkspaces);
        
        console.log(`   Found ${workspaces.length} workspace(s)`);
        
        const withTokens = workspaces.filter(w => w.hasToken);
        const plaintextTokens = workspaces.filter(w => 
            w.hasToken && w.botToken !== '[encrypted]'
        );
        
        console.log(`   - ${withTokens.length} with tokens`);
        console.log(`   - ${plaintextTokens.length} with plaintext tokens (need migration)\n`);
        
        if (plaintextTokens.length > 0) {
            console.log("   📋 Run migration:");
            console.log("      npx tsx scripts/migrate-slack-tokens.ts --dry-run");
            console.log("      npx tsx scripts/migrate-slack-tokens.ts\n");
        }
        
        return true;
    } catch (err: any) {
        console.error("   ❌ Error checking workspaces:", err.message, "\n");
        return false;
    }
}

async function runAll() {
    console.log("=" .repeat(50));
    console.log("SLACK SECURITY DATABASE VERIFICATION");
    console.log("=" .repeat(50) + "\n");
    
    const results = {
        table: await verifyTableExists(),
        encryption: await verifyEncryptionAvailable(),
        endToEnd: await testEndToEndEncryption(),
        workspaces: await checkExistingSlackWorkspaces(),
    };
    
    console.log("=" .repeat(50));
    console.log("SUMMARY");
    console.log("=" .repeat(50));
    
    const allPassed = Object.values(results).every(r => r);
    
    for (const [test, passed] of Object.entries(results)) {
        console.log(`${passed ? '✅' : '❌'} ${test}`);
    }
    
    console.log("=" .repeat(50));
    
    if (allPassed) {
        console.log("\n🎉 All verifications passed!");
        console.log("Slack security enhancements are ready to use.");
    } else {
        console.log("\n⚠️  Some verifications failed.");
        console.log("Review the output above for details.");
    }
    
    process.exit(allPassed ? 0 : 1);
}

runAll().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
