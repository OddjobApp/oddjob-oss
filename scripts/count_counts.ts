import "dotenv/config";
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
    const res = await db.execute(sql`SELECT count(*) FROM knowledge_edges`);
    console.log(`Edges:`, res.rows[0].count);

    const nodes = await db.execute(sql`SELECT count(*) FROM knowledge_nodes`);
    console.log(`Nodes:`, nodes.rows[0].count);

    process.exit(0);
}

main().catch(console.error);
