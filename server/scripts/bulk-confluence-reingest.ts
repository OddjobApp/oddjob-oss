import 'dotenv/config';
import { db } from "../database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { ConfluenceSyncExecutor } from "../domain/jobs/core/executors/confluence-sync-executor.js";
import { execSync } from 'child_process';

async function main() {
    console.log(">>> STARTING BULK CONFLUENCE REINGESTION <<<");

    // Fetch all confluence_sync jobs
    const confluenceJobs = await db.select().from(jobs).where(eq(jobs.type, "confluence_sync"));
    console.log(`Found ${confluenceJobs.length} Confluence sync jobs.`);

    const executor = new ConfluenceSyncExecutor();

    for (const job of confluenceJobs) {
        console.log(`\n---------------------------------------------------------`);
        console.log(`Processing Job ID: ${job.id} | Name: ${job.name} | Org: ${job.organizationId}`);

        const config = typeof job.config === 'string' ? JSON.parse(job.config) : job.config;

        try {
            // Context provided for executor
            const context = {
                organizationId: job.organizationId,
                userId: "SYSTEM_REINGEST",
                data: {}
            } as any;

            const result = await executor.execute(job, config, {} as any, context);
            console.log(`Status: ${result.status}`);
            const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
            console.log(`Message: ${output.message}`);
        } catch (err: any) {
            console.error(`❌ Failed to execute job ${job.id}:`, err.message);
        }
    }

    console.log("\n>>> STARTING SEMANTIC ENRICHMENT PIPELINE <<<");
    const enrichmentScripts = [
        "server/scripts/seed-concepts.ts",
        "server/scripts/link-nodes-to-topics.ts",
        "server/scripts/propagate-topics-to-nodes.ts"
    ];

    for (const script of enrichmentScripts) {
        console.log(`\nRunning script: ${script}`);
        try {
            execSync(`npx tsx ${script}`, {
                stdio: 'inherit',
                env: { ...process.env }
            });
            console.log(`✅ SUCCESS: ${script}`);
        } catch (e: any) {
            console.warn(`⚠️ FAILED: ${script} (continuing anyway)`);
        }
    }

    console.log("\n>>> BULK REINGESTION & ENRICHMENT COMPLETE <<<");
    process.exit(0);
}

main().catch(err => {
    console.error("\nFATAL ERROR DURING BULK OPERATION:");
    console.error(err);
    process.exit(1);
});

