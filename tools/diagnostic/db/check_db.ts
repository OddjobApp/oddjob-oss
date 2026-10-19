
import { db } from "./server/db/index.js";
import { pipelines, pipelineInputParams } from "./shared/schema/index.js";
import { eq, like, desc } from "drizzle-orm";

async function run() {
    console.log("Checking all [Agent Proxy] pipelines for parameters...");
    const results = await db.select({
        pipelineId: pipelines.id,
        pipelineName: pipelines.name,
        paramName: pipelineInputParams.name,
        paramType: pipelineInputParams.dataType
    })
    .from(pipelineInputParams)
    .innerJoin(pipelines, eq(pipelineInputParams.pipelineId, pipelines.id))
    .where(like(pipelines.name, "[Agent Proxy]%"))
    .orderBy(desc(pipelines.id));

    if (results.length === 0) {
        console.log("No proxy pipelines found WITH parameters.");
    } else {
        console.log(`Found ${results.length} parameters across proxy pipelines:`);
        results.forEach(r => {
            console.log(`- Pipeline ${r.pipelineId} (${r.pipelineName}): ${r.paramName} (${r.paramType})`);
        });
    }

    // Also check for the total count of proxy pipelines
    const proxyCount = await db.select({ count: pipelines.id }).from(pipelines).where(like(pipelines.name, "[Agent Proxy]%"));
    console.log(`Total [Agent Proxy] pipelines discovered: ${proxyCount.length}`);

    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
