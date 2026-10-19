
import { db } from "../server/db/index.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import { inArray } from "drizzle-orm";

async function auditEdges() {
    const edges = await db.select().from(knowledgeEdges);
    const nodeIds = new Set((await db.select({ id: knowledgeNodes.id }).from(knowledgeNodes)).map(n => n.id));

    const invalidEdges = edges.filter(e => !nodeIds.has(e.sourceId) || !nodeIds.has(e.targetId));

    if (invalidEdges.length > 0) {
        console.log(`Found ${invalidEdges.length} invalid edges:`);
        invalidEdges.forEach(e => {
            const sourceExists = nodeIds.has(e.sourceId);
            const targetExists = nodeIds.has(e.targetId);
            console.log(`Edge ${e.id}: Source ${e.sourceId} (${sourceExists ? 'exists' : 'MISSING'}), Target ${e.targetId} (${targetExists ? 'exists' : 'MISSING'})`);
        });
    } else {
        console.log("All edges point to existing nodes.");
    }

    process.exit(0);
}

auditEdges();
