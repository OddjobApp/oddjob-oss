import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeNodes, knowledgeTopics } from "@shared/schema/index.js";
import { eq, and, sql, ilike } from "drizzle-orm";

async function main() {
    console.log("Linking Nodes to Topics based on metadata...");
    const orgId = 1;

    // Fetch all topics for this org
    const topics = await db.select().from(knowledgeTopics).where(eq(knowledgeTopics.organizationId, orgId));
    const topicMap = new Map(topics.map(t => [t.name.toLowerCase(), t.id]));

    // Fetch nodes that have topics in metadata but no knowledge_topic_id
    const nodes = await db.select().from(knowledgeNodes).where(
        and(
            eq(knowledgeNodes.organizationId, orgId),
            sql`${knowledgeNodes.data}->'topics' IS NOT NULL`,
            sql`jsonb_array_length(${knowledgeNodes.data}->'topics') > 0`
        )
    );

    console.log(`Found ${nodes.length} nodes with topics in metadata.`);

    let linkedCount = 0;
    for (const node of nodes) {
        const metadataTopics = (node.data as any).topics as string[];
        // Pick the first matching topic
        let matchedTopicId: number | null = null;
        for (const tName of metadataTopics) {
            const normalized = tName.toLowerCase();
            if (topicMap.has(normalized)) {
                matchedTopicId = topicMap.get(normalized)!;
                break;
            }
        }

        if (matchedTopicId) {
            await db.update(knowledgeNodes)
                .set({ knowledgeTopicId: matchedTopicId })
                .where(eq(knowledgeNodes.id, node.id));
            linkedCount++;
        }
    }

    console.log(`Linked ${linkedCount} nodes to topics.`);
    process.exit(0);
}

main().catch(console.error);

