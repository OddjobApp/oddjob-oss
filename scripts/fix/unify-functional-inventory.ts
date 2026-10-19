
import { db } from "../../server/database_service.js";
import { jobs, pipelines, agentDeployments } from "../../shared/schema/index.js";
import { isNull, eq } from "drizzle-orm";

async function unifyFunctionalInventory() {
    console.log("Unifying functional inventory into Organization 1...");
    
    // 1. Jobs
    const jobsResult = await db.update(jobs)
        .set({ organizationId: 1 })
        .where(isNull(jobs.organizationId));
    console.log(`- Jobs updated: ${jobsResult.rowCount}`);
    
    // 2. Pipelines
    const pipeResult = await db.update(pipelines)
        .set({ organizationId: 1 })
        .where(isNull(pipelines.organizationId));
    console.log(`- Pipelines updated: ${pipeResult.rowCount}`);

    // 3. Agent Deployments
    const deployResult = await db.update(agentDeployments)
        .set({ organizationId: 1 })
        .where(isNull(agentDeployments.organizationId));
    console.log(`- Agent Deployments updated: ${deployResult.rowCount}`);
    
    console.log("Success! Functional inventory recovered.");
    process.exit(0);
}

unifyFunctionalInventory().catch(err => {
    console.error(err);
    process.exit(1);
});
