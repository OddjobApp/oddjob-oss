
import 'dotenv/config';
import { db } from "../../server/database_service.js";
import { jobs, knowledgeTopics, knowledgeNodes, jobOutputKnowledge, datasets } from "../../shared/schema/index.js";
import { eq, count, and } from "drizzle-orm";

async function main() {
    console.log("=== Knowledge Graph Status Check ===");

    // 1. Job 20 Status
    const [job] = await db.select().from(jobs).where(eq(jobs.id, 20)).limit(1);
    if (job) {
        console.log(`Job 20:`);
        console.log(`  enableKnowledgeStore: ${job.enableKnowledgeStore}`);
        console.log(`  outputKnowledgeTopicId: ${job.outputKnowledgeTopicId}`);
        // console.log(`  outputTags: ${JSON.stringify(job.outputTags)}`);
    } else {
        console.log("Job 20 NOT FOUND");
    }

    // 2. Topics
    const topics = await db.select().from(knowledgeTopics);
    console.log(`Knowledge Topics Count: ${topics.length}`);
    topics.forEach((t: any) => console.log(`  - [${t.id}] ${t.name} (Org: ${t.organizationId})`));

    // 3. Job Output Knowledge (Raw stored output)
    const jobOutputs = await db.select({ count: count() })
        .from(jobOutputKnowledge)
        .where(eq(jobOutputKnowledge.jobId, 20));

    console.log(`Job Output Knowledge Items: ${jobOutputs[0].count}`);

    // 4. Knowledge Nodes (Extracted entities)
    // Nodes might be linked via pipelineExecutionId or extractionSources?
    // Using a broader check or just count total
    const nodes = await db.select({ count: count() }).from(knowledgeNodes);
    console.log(`Total Knowledge Nodes: ${nodes[0].count}`);

    // 5. Datasets
    const dsets = await db.select().from(datasets);
    console.log(`Datasets Count: ${dsets.length}`);

    process.exit(0);
}

main();
