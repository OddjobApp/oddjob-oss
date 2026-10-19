
import 'dotenv/config';
import { db } from "@server/database_service.js";
import { knowledgeNodes } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";

async function debug() {
    console.log("Checking for nodes with source 'system_introspection'...");

    const nodes = await db.query.knowledgeNodes.findMany({
        where: sql`data->>'source' = 'system_introspection'`,
        limit: 10
    });

    console.log(`Found ${nodes.length} sample nodes.`);
    if (nodes.length > 0) {
        console.log("Sample nodes:", nodes.map(n => ({ id: n.id, name: n.name, label: n.label })));
    }

    const count = await db.select({ count: sql<number>`count(*)` })
        .from(knowledgeNodes)
        .where(sql`data->>'source' = 'system_introspection'`);

    console.log("Total system_introspection nodes:", count[0].count);

    // Group by label for system_introspection nodes
    const byLabel = await db.select({
        label: knowledgeNodes.label,
        count: sql<number>`count(*)`
    })
        .from(knowledgeNodes)
        .where(sql`data->>'source' = 'system_introspection'`)
        .groupBy(knowledgeNodes.label);

    console.table(byLabel);

    process.exit(0);
}

debug().catch(console.error);
