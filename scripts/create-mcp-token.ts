/**
 * Quick script to create an MCP token for testing
 */
import { db } from "../server/db/index.js";
import { mcpApiTokens } from "@shared/schema";
import { generateApiToken } from "../server/mcp/auth";
import { writeFileSync } from "fs";

async function main() {
    const { token, hash, prefix } = generateApiToken();

    const [created] = await db.insert(mcpApiTokens).values({
        name: "Onyx Full Access Token",
        tokenHash: hash,
        tokenPrefix: prefix,
        userId: "0e81f5e9-4ac6-43bd-9fdd-f5bec5347cab",
        organizationId: 1,
        permissions: ["admin:full"],
        isActive: true,
    }).returning();

    // Write token to a file for easy retrieval
    writeFileSync("mcp-token.txt", `MCP API Token\n=============\nToken: ${token}\nID: ${created.id}\nPrefix: ${prefix}\n\nUsage:\ncurl -H "Authorization: Bearer ${token}" http://localhost:3001/health\n`);

    console.log("");
    console.log("=====================================================");
    console.log("  MCP API TOKEN CREATED!");
    console.log("  Token saved to: mcp-token.txt");
    console.log("=====================================================");
    console.log("");
    console.log("Token ID:", created.id);
    console.log("Name:", created.name);
    console.log("Permissions: admin:full (full access)");
    console.log("");

    process.exit(0);
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
