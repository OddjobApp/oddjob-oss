import { db } from "../database_service.js";
import { mcpServers } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function registerStitch() {
    console.log("🧵 Registering Stitch MCP Server...");

    const name = "stitch";
    const existing = await db.select().from(mcpServers).where(eq(mcpServers.name, name));

    if (existing.length > 0) {
        console.log("✅ Stitch server already registered.");
        process.exit(0);
    }

    // Using stitch-mcp (npm: stitch-mcp) — the universal MCP server for Google Stitch.
    // @google/stitch-mcp does not exist on npm; stitch-mcp is the correct package.
    // Alternatively use @_davideast/stitch-mcp which wraps @google/stitch-sdk with
    // full Google Cloud auth automation (run `npx @_davideast/stitch-mcp` once to authenticate).
    await db.insert(mcpServers).values({
        name,
        description: "Google Stitch UI Design & Generation MCP Server",
        transport: "stdio",
        command: "npx",
        args: ["-y", "stitch-mcp"],
        env: {},
        status: "active",
    });

    console.log("🚀 Stitch MCP Server registered successfully.");
    process.exit(0);
}

registerStitch().catch((err) => {
    console.error("❌ Registration failed:", err);
    process.exit(1);
});
