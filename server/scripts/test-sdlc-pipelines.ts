import "dotenv/config";
import { appRegistryService } from "../../server/domain/apps/app-registry.service.js";
import { db } from "../../server/database_service.js";
import { pipelines, pipelineSteps, jobs } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
const ORG = 106, APP = 73;
await appRegistryService.installApp(APP, ORG);
const pipes = await db.select().from(pipelines).where(and(eq(pipelines.organizationId, ORG), sql`labels->>'cycleApp' = 'Oddjob Enterprise Hybrid AI SDLC'`));
console.log(`\nPipelines provisioned: ${pipes.length}`);
for (const p of pipes) {
    const steps = await db.select({
        order: pipelineSteps.order,
        jobName: jobs.name,
        toolName: pipelineSteps.toolName,
        args: pipelineSteps.toolArguments,
    }).from(pipelineSteps).leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id)).where(eq(pipelineSteps.pipelineId, p.id)).orderBy(pipelineSteps.order);
    console.log(`  [${p.id}] "${p.name}"  trigger=${p.triggerType}  steps=${steps.length}`);
    steps.slice(0, 3).forEach(s => console.log(`    step ${s.order}: agent=${s.jobName ?? '∅'} tool=${s.toolName ?? '∅'} action=${(s.args as any)?.action ?? '∅'}`));
}
process.exit(0);
