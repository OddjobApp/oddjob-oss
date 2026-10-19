// @ts-nocheck
import { db } from "@server/database_service.js";
import { pipelineStepExecutions } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function main() {
    const [step] = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, 285)).limit(1);
    if (!step) return;

    const plan = JSON.parse(step.output);
    const task = plan.tasks.find((t: any) => t.id === 'task_1');
    console.log('Task 1 Output:', JSON.stringify(task.output || {}, null, 2));
    console.log('Task 1 Assigned Agent Feedback:', task.assignedAgentFeedback);
    process.exit(0);
}

main().catch(console.error);
