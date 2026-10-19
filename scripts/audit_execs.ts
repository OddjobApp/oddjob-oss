import 'dotenv/config';
import { db } from "../server/db/index.js";
import { pipelineExecutions, pipelineStepExecutions } from '@shared/schema/index.js';
import { desc, eq } from 'drizzle-orm';

async function main() {
    const execs = await db.select().from(pipelineExecutions).orderBy(desc(pipelineExecutions.id)).limit(5);
    for (const exec of execs) {
        console.log(`\n=== EXECUTION ${exec.id} (${exec.status}) ===`);
        const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, exec.id));
        steps.forEach(s => {
            console.log(`  Step ${s.stepOrder} (${s.status})`);
            if (s.output && s.output.length > 10) {
                try {
                    const plan = JSON.parse(s.output);
                    plan.tasks?.forEach((t: any) => {
                        console.log(`    TASK: ${t.name} | STATUS: ${t.status}`);
                    });
                } catch (e) {
                    console.log(`    OUTPUT: ${s.output.substring(0, 100)}...`);
                }
            }
        });
    }
    process.exit(0);
}

main().catch(console.error);
