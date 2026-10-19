import { db } from "../server/db/index.js";
import { sql } from 'drizzle-orm';

async function check() {
    try {
        const nodesCount = await db.execute(sql`SELECT count(*) FROM knowledge_nodes`);
        const edgesCount = await db.execute(sql`SELECT count(*) FROM knowledge_edges`);
        console.log('Knowledge Nodes Count:', nodesCount.rows[0].count);
        console.log('Knowledge Edges Count:', edgesCount.rows[0].count);

        const sampleNodes = await db.execute(sql`SELECT id, label, type, metadata FROM knowledge_nodes LIMIT 5`);
        console.log('Sample Nodes:', JSON.stringify(sampleNodes.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

check();
