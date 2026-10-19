
import { db } from "../server/db/index.js";
import { pipelines, pipelineInputParams } from "../shared/schema/index";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Listing all pipelines and their parameters...");
    const allPipelines = await db.select().from(pipelines);

    for (const p of allPipelines) {
        console.log(`\nPipeline: ${p.name} (ID: ${p.id})`);
        const params = await db.select().from(pipelineInputParams).where(eq(pipelineInputParams.pipelineId, p.id));
        if (params.length === 0) {
            console.log("  No explicit parameters.");
        } else {
            params.forEach(param => {
                console.log(`  - Param: ${param.name}, Type: ${param.dataType}, Required: ${param.isRequired}`);
            });
        }
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
