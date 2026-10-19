import { db } from "../server/db/index.js";
import { 
    missions, 
    missionRuns, 
    pipelines, 
    pipelineSteps, 
    jobs, 
    pipelineExecutions, 
    pipelineStepExecutions, 
    missionDeliverables, 
    agentDeployments 
} from '@shared/schema/index.js';
import { sql } from 'drizzle-orm';

async function clean() {
    console.log('Cleaning up data...');
    try {
        // 1. Step Executions
        await db.delete(pipelineStepExecutions).where(sql`1=1`);
        console.log('Deleted step executions');

        // 2. Executions (Soft Delete)
        await db.update(pipelineExecutions).set({ deletedAt: new Date() }).where(sql`1=1`);
        console.log('Soft-deleted executions');

        // 3. Deliverables
        await db.delete(missionDeliverables).where(sql`1=1`);
        console.log('Deleted deliverables');

        // 4. Mission Runs (Soft Delete)
        await db.update(missionRuns).set({ deletedAt: new Date() }).where(sql`1=1`);
        console.log('Soft-deleted mission runs');

        // 5. Missions (IDs > 100 were today's)
        await db.delete(missions).where(sql`id > 100`);
        console.log('Deleted missions');

        // 6. Pipeline Steps
        await db.delete(pipelineSteps).where(sql`id > 150`);
        console.log('Deleted pipeline steps');

        // 7. Pipelines
        await db.delete(pipelines).where(sql`id > 150`);
        console.log('Deleted pipelines');

        // 8. Jobs
        await db.delete(jobs).where(sql`id > 200`);
        console.log('Deleted jobs');

        // 9. Agent Deployments
        await db.delete(agentDeployments).where(sql`id > 50`);
        console.log('Deleted deployments');

        console.log('Cleanup successful.');
    } catch (error) {
        console.error('Cleanup failed:', error);
    }
    process.exit(0);
}

clean();
