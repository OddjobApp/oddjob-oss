
import { db } from "../../server/database_service.js";
import { jobs, pipelines, pipelineSteps, pipelineExecutions, pipelineStepExecutions, systemSettings } from '../../shared/schema/index.js';
import { eq, desc } from 'drizzle-orm';

async function debugTriage() {
    const orgId = 1;

    console.log("--- System Settings ---");
    const [settings] = await db.select().from(systemSettings).where(eq(systemSettings.key, "global")).limit(1);
    console.log(JSON.stringify(settings?.settingsData, null, 2));

    console.log("\n--- Pipelines for Org 1 ---");
    const pals = await db.select().from(pipelines).where(eq(pipelines.organizationId, orgId));
    console.log(pals.map((p: any) => ({ id: p.id, name: p.name, labels: p.labels })));

    console.log("\n--- Jobs for Org 1 ---");
    const jbs = await db.select().from(jobs).where(eq(jobs.organizationId, orgId));
    console.log(jbs.map((j: any) => ({ id: j.id, name: j.name, type: j.type, credentialId: (j.config as any)?.credentialId })));

    const masterJob = jbs.find((j: any) => j.id === 27);
    if (masterJob) {
        console.log("\n--- Job 27 Config ---");
        console.log(JSON.stringify(masterJob.config, null, 2));
    }

    console.log("\n--- Worker Pipelines (23, 24) ---");
    for (const id of [23, 24]) {
        const [pal] = pals.filter((p: any) => p.id === id);
        if (pal) {
            const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, id));
            console.log(`Pipeline ${id} (${pal.name}) Steps:`, steps.map((s: any) => s.jobId));
            for (const step of steps) {
                const [job] = await db.select().from(jobs).where(eq(jobs.id, step.jobId as number));
                console.log(`  Job ${job.id} (${job.name}) Config:`, JSON.stringify(job.config, null, 2));
            }
        }
    }

    console.log("\n--- Steps for Master Pipeline (25) ---");
    const master = pals.find((p: any) => p.id === 25);
    if (master) {
        const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, master.id));
        console.log("Steps for 25:", steps);

        for (const step of steps) {
            const [job] = await db.select().from(jobs).where(eq(jobs.id, step.jobId as number));
            console.log(`Job ${job.id} (${job.name}) Config:`, JSON.stringify(job.config, null, 2));
        }
    }

    console.log("\n--- Specific Execution (34) ---");
    const [exec34] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, 34));
    if (exec34) {
        console.log(`Execution ID: ${exec34.id}, Pipeline ID: ${exec34.pipelineId}, Status: ${exec34.status}, Error: ${exec34.error}`);
        const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, exec34.id));
        console.log("Step Executions for 34:", steps.map((s: any) => ({ id: s.id, jobId: s.jobId, status: s.status, error: s.error })));
    }

    console.log("\n--- Specific Execution (33) ---");
    const [exec33] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, 33));
    if (exec33) {
        console.log(`Execution ID: ${exec33.id}, Pipeline ID: ${exec33.pipelineId}, Status: ${exec33.status}, Error: ${exec33.error}`);
        const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, exec33.id));
        console.log("Step Executions for 33:", steps.map((s: any) => ({ id: s.id, jobId: s.jobId, status: s.status, error: s.error, output: s.output?.substring(0, 200) })));
    }
}

debugTriage().catch(console.error);
