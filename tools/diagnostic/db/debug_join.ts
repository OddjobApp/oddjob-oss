
import "dotenv/config";
import { db } from "./server/db.js";
import { knowledgeNodes, knowledgeTopics, knowledgeTopicConcepts, knowledgeConcepts } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function debugJoin() {
    try {
        const rows = await db
            .select({
                nodeId: knowledgeNodes.id,
                nodeLabel: knowledgeNodes.label,
                nodeName: knowledgeNodes.name,
                orgId: knowledgeNodes.organizationId,
                topicId: knowledgeNodes.knowledgeTopicId,
                conceptId: knowledgeConcepts.id,
                conceptName: knowledgeConcepts.name
            })
            .from(knowledgeNodes)
            .leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
            .leftJoin(knowledgeTopicConcepts, eq(knowledgeTopics.id, knowledgeTopicConcepts.topicId))
            .leftJoin(knowledgeConcepts, eq(knowledgeTopicConcepts.conceptId, knowledgeConcepts.id))
            .where(eq(knowledgeNodes.organizationId, 1))
            .limit(10);
        
        console.log(`Join Results for Org 1 (${rows.length} rows):`);
        console.log(JSON.stringify(rows, null, 2));
    } catch (error: any) {
        console.error("Error:", error.message);
    } finally {
        process.exit(0);
    }
}

debugJoin();
