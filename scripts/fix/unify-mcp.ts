
import { db } from "../../server/database_service.js";
import { mcpServers } from "../../shared/schema/index.js";
import { isNull } from "drizzle-orm";

async function unifyMcpServers() {
    console.log("Unifying MCP Servers into Organization 1...");
    const result = await db.update(mcpServers)
        .set({ organizationId: 1 })
        .where(isNull(mcpServers.organizationId));
    console.log(`Success! Updated ${result.rowCount} MCP servers.`);
    process.exit(0);
}

unifyMcpServers().catch(err => {
    console.error(err);
    process.exit(1);
});
