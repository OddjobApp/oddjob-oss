import { db } from "../server/db/index.js";
import { pipelineStepExecutions } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function main() {
    const [step] = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, 280)).limit(1);
    if (!step) {
        console.error('No step found');
        return;
    }

    try {
        if (!step.output) {
            console.error('Step output is empty');
            return;
        }
        const plan = JSON.parse(step.output);
        console.log('PLAN TASKS:');
        plan.tasks.forEach((t: any) => {
            console.log(`- ID: ${t.id}, Type: ${t.type}, Name: ${t.name}, Agent: ${t.assignedAgent}, Status: ${t.status}`);
            if (t.output?.error) console.log(`  ERROR: ${t.output.error}`);
        });
        console.log('REASONING:', plan.thought_process);
    } catch (e) {
        console.log('Raw Output:', step.output);
    }
    process.exit(0);
}

main().catch(console.error);
