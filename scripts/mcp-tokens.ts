/**
 * MCP Token Management Script
 * 
 * Create and manage MCP API tokens for users.
 * 
 * Usage:
 *   npx tsx scripts/mcp-tokens.ts create --user <userId> --org <orgId> --name "Token Name"
 *   npx tsx scripts/mcp-tokens.ts list --org <orgId>
 *   npx tsx scripts/mcp-tokens.ts revoke --id <tokenId>
 *   npx tsx scripts/mcp-tokens.ts enable-org --org <orgId>
 */

import { db } from "../server/db/index.js";
import { mcpApiTokens, orgSettings, users, orgs, McpPermission, mcpPermissions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateApiToken, hashToken } from "../server/mcp/auth";

const args = process.argv.slice(2);
const command = args[0];

function parseArgs(args: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i]?.replace(/^--/, "");
        const value = args[i + 1];
        if (key && value) {
            result[key] = value;
        }
    }
    return result;
}

async function createToken() {
    const params = parseArgs(args.slice(1));

    if (!params.user || !params.org || !params.name) {
        console.error("Usage: npx tsx scripts/mcp-tokens.ts create --user <userId> --org <orgId> --name \"Token Name\" [--permissions perm1,perm2]");
        console.error("\nAvailable permissions:");
        mcpPermissions.forEach(p => console.error(`  - ${p}`));
        process.exit(1);
    }

    const userId = params.user;  // userId is a string (UUID)
    const orgId = parseInt(params.org);
    const name = params.name;
    const permissions: McpPermission[] = params.permissions
        ? params.permissions.split(",").filter(p => mcpPermissions.includes(p as McpPermission)) as McpPermission[]
        : [];

    // Verify user exists
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
        console.error(`Error: User with ID ${userId} not found`);
        process.exit(1);
    }

    // Verify org exists
    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
    if (!org) {
        console.error(`Error: Organization with ID ${orgId} not found`);
        process.exit(1);
    }

    // Generate token
    const { token, hash, prefix } = generateApiToken();

    // Create token record
    const [created] = await db.insert(mcpApiTokens).values({
        name,
        tokenHash: hash,
        tokenPrefix: prefix,
        userId,
        organizationId: orgId,
        permissions,
        isActive: true,
    }).returning();

    console.log("\n✅ MCP API Token Created Successfully!\n");
    console.log("=".repeat(60));
    console.log("⚠️  IMPORTANT: Copy this token now. It will not be shown again!");
    console.log("=".repeat(60));
    console.log(`\n  Token: ${token}\n`);
    console.log("=".repeat(60));
    console.log(`\nToken Details:`);
    console.log(`  ID: ${created.id}`);
    console.log(`  Name: ${created.name}`);
    console.log(`  Prefix: ${created.tokenPrefix}...`);
    console.log(`  User ID: ${created.userId}`);
    console.log(`  Org ID: ${created.organizationId}`);
    console.log(`  Permissions: ${permissions.length > 0 ? permissions.join(", ") : "none (read-only)"}`);
    console.log(`\nUsage:`);
    console.log(`  curl -H "Authorization: Bearer ${token}" http://localhost:3001/sse`);
}

async function listTokens() {
    const params = parseArgs(args.slice(1));

    const orgId = params.org ? parseInt(params.org) : undefined;

    let tokens;
    if (orgId) {
        tokens = await db.select().from(mcpApiTokens).where(eq(mcpApiTokens.organizationId, orgId));
    } else {
        tokens = await db.select().from(mcpApiTokens);
    }

    console.log(`\n📋 MCP API Tokens${orgId ? ` (Org ${orgId})` : ""}\n`);
    console.log("ID  | Name                         | Prefix      | User | Org | Active | Permissions");
    console.log("-".repeat(100));

    for (const t of tokens) {
        const perms = (t.permissions as string[])?.join(", ") || "none";
        console.log(
            `${t.id.toString().padEnd(4)}| ${t.name.padEnd(28)} | ${t.tokenPrefix.padEnd(12)} | ${t.userId.toString().padEnd(5)}| ${t.organizationId.toString().padEnd(4)}| ${t.isActive ? "Yes" : "No ".padEnd(7)}| ${perms.substring(0, 40)}`
        );
    }

    console.log(`\nTotal: ${tokens.length} token(s)`);
}

async function revokeToken() {
    const params = parseArgs(args.slice(1));

    if (!params.id) {
        console.error("Usage: npx tsx scripts/mcp-tokens.ts revoke --id <tokenId>");
        process.exit(1);
    }

    const tokenId = parseInt(params.id);

    const [updated] = await db
        .update(mcpApiTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(mcpApiTokens.id, tokenId))
        .returning();

    if (updated) {
        console.log(`✅ Token ${tokenId} has been revoked.`);
    } else {
        console.error(`Error: Token ${tokenId} not found.`);
        process.exit(1);
    }
}

async function enableOrgMcp() {
    const params = parseArgs(args.slice(1));

    if (!params.org) {
        console.error("Usage: npx tsx scripts/mcp-tokens.ts enable-org --org <orgId>");
        process.exit(1);
    }

    const orgId = parseInt(params.org);

    // Check if settings exist
    const [existing] = await db
        .select()
        .from(orgSettings)
        .where(eq(orgSettings.organizationId, orgId))
        .limit(1);

    if (existing) {
        // Update
        await db
            .update(orgSettings)
            .set({ mcpHttpEnabled: true, updatedAt: new Date() })
            .where(eq(orgSettings.organizationId, orgId));
    } else {
        // Insert
        await db.insert(orgSettings).values({
            organizationId: orgId,
            mcpHttpEnabled: true,
        });
    }

    console.log(`✅ MCP HTTP access enabled for organization ${orgId}`);
}

async function disableOrgMcp() {
    const params = parseArgs(args.slice(1));

    if (!params.org) {
        console.error("Usage: npx tsx scripts/mcp-tokens.ts disable-org --org <orgId>");
        process.exit(1);
    }

    const orgId = parseInt(params.org);

    await db
        .update(orgSettings)
        .set({ mcpHttpEnabled: false, updatedAt: new Date() })
        .where(eq(orgSettings.organizationId, orgId));

    console.log(`✅ MCP HTTP access disabled for organization ${orgId}`);
}

async function showHelp() {
    console.log(`
MCP Token Management

Commands:
  create        Create a new MCP API token
  list          List all tokens (optionally filter by org)
  revoke        Revoke (disable) a token
  enable-org    Enable MCP HTTP access for an organization
  disable-org   Disable MCP HTTP access for an organization

Examples:
  npx tsx scripts/mcp-tokens.ts create --user 1 --org 1 --name "Onyx Integration"
  npx tsx scripts/mcp-tokens.ts create --user 1 --org 1 --name "Full Access" --permissions knowledge:read,pipeline:read,pipeline:execute
  npx tsx scripts/mcp-tokens.ts list --org 1
  npx tsx scripts/mcp-tokens.ts revoke --id 5
  npx tsx scripts/mcp-tokens.ts enable-org --org 1

Available Permissions:
${mcpPermissions.map(p => `  - ${p}`).join("\n")}
`);
}

async function main() {
    switch (command) {
        case "create":
            await createToken();
            break;
        case "list":
            await listTokens();
            break;
        case "revoke":
            await revokeToken();
            break;
        case "enable-org":
            await enableOrgMcp();
            break;
        case "disable-org":
            await disableOrgMcp();
            break;
        case "help":
        case "--help":
        case "-h":
        default:
            await showHelp();
            break;
    }

    process.exit(0);
}

main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
});
